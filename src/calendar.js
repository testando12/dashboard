// ==================== GOOGLE CALENDAR INTEGRATION ====================
// Uses Google Identity Services (GIS) + Calendar API v3
// Works entirely in the browser — no backend needed

const GCAL_CONFIG = {
    clientId: '422689196931-1c3jgr9j2ldq8fodrdffbi1cs6prg1so.apps.googleusercontent.com',
    scopes: 'https://www.googleapis.com/auth/calendar.readonly',
    discoveryDoc: 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
};

let gcalTokenClient = null;
let gcalAccessToken = null;

// ========== Clock (live) ==========
function updateClock() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const el = document.getElementById('cal-time');
    if (el) el.textContent = `${h}:${m}`;
}

function updateDate() {
    const now = new Date();
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const el = document.getElementById('cal-date');
    if (el) el.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
}

function updateWeekDays() {
    const now = new Date();
    const today = now.getDate();
    const dayOfWeek = now.getDay(); // 0=Sun

    // Build 7-day row starting from Sunday of this week
    const sunday = new Date(now);
    sunday.setDate(today - dayOfWeek);

    const daysEl = document.getElementById('cal-days');
    if (!daysEl) return;

    daysEl.innerHTML = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(sunday);
        d.setDate(sunday.getDate() + i);
        const span = document.createElement('span');
        span.textContent = d.getDate();
        if (d.getDate() === today && d.getMonth() === now.getMonth()) {
            span.classList.add('active');
        }
        // Add dot if there's an event (populated later)
        span.dataset.date = d.toISOString().split('T')[0];
        daysEl.appendChild(span);
    }
}

// ========== Google API Load ==========
function loadGoogleScripts() {
    return new Promise((resolve) => {
        if (window.google && window.google.accounts) { resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = resolve;
        document.head.appendChild(script);
    });
}

function loadGapiScript() {
    return new Promise((resolve) => {
        if (window.gapi) { resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = resolve;
        document.head.appendChild(script);
    });
}

async function initGoogleClients() {
    await Promise.all([loadGoogleScripts(), loadGapiScript()]);

    // Load GAPI client
    await new Promise((resolve) => gapi.load('client', resolve));
    await gapi.client.init({ discoveryDocs: [GCAL_CONFIG.discoveryDoc] });

    // Init token client
    gcalTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GCAL_CONFIG.clientId,
        scope: GCAL_CONFIG.scopes,
        callback: async (resp) => {
            if (resp.error) {
                console.error('Google auth error:', resp.error);
                return;
            }
            gcalAccessToken = resp.access_token;
            localStorage.setItem('gcal_access_token', resp.access_token);
            localStorage.setItem('gcal_token_expiry', Date.now() + (3600 * 1000));
            await fetchAndRenderEvents();
        }
    });
}

// ========== Auth ==========
function gcalLogin() {
    gcalTokenClient.requestAccessToken({ prompt: 'consent' });
}

function gcalLogout() {
    const token = localStorage.getItem('gcal_access_token');
    if (token) google.accounts.oauth2.revoke(token);
    localStorage.removeItem('gcal_access_token');
    localStorage.removeItem('gcal_token_expiry');
    gcalAccessToken = null;
    renderCalendarLogin();
}

function getStoredToken() {
    const expiry = localStorage.getItem('gcal_token_expiry');
    const token = localStorage.getItem('gcal_access_token');
    if (token && expiry && Date.now() < parseInt(expiry)) {
        return token;
    }
    return null;
}

// ========== Fetch Events ==========
async function fetchAndRenderEvents() {
    const token = gcalAccessToken || getStoredToken();
    if (!token) return;

    gapi.client.setToken({ access_token: token });

    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // Next 7 days
    const nextWeek = new Date(now);
    nextWeek.setDate(now.getDate() + 7);

    try {
        const response = await gapi.client.calendar.events.list({
            calendarId: 'primary',
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            showDeleted: false,
            singleEvents: true,
            maxResults: 10,
            orderBy: 'startTime'
        });

        const events = response.result.items || [];
        renderEvents(events);
        markEventDots(events);
    } catch (err) {
        console.error('Calendar fetch error:', err);
        if (err.status === 401) {
            localStorage.removeItem('gcal_access_token');
            renderCalendarLogin();
        }
    }
}

// ========== Render Events ==========
function formatEventTime(event) {
    if (event.start.dateTime) {
        const d = new Date(event.start.dateTime);
        return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }
    return 'All day';
}

function isToday(event) {
    const now = new Date();
    const start = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date);
    return start.toDateString() === now.toDateString();
}

function renderEvents(events) {
    const container = document.getElementById('cal-events');
    if (!container) return;

    if (events.length === 0) {
        container.innerHTML = `
            <div class="calendar-event">
                <span class="event-label">No upcoming events</span>
            </div>`;
        return;
    }

    // Show next 2 events
    const toShow = events.slice(0, 2);
    container.innerHTML = toShow.map(ev => `
        <div class="calendar-event">
            <span class="event-label">${isToday(ev) ? 'Today' : 'Next event'}</span>
            <div class="event-detail">
                <span>${ev.summary || '(no title)'}</span>
                <span class="event-time">${formatEventTime(ev)}</span>
            </div>
        </div>
    `).join('');
}

function markEventDots(events) {
    const daysEl = document.getElementById('cal-days');
    if (!daysEl) return;
    events.forEach(ev => {
        const dateStr = ev.start.dateTime
            ? ev.start.dateTime.split('T')[0]
            : ev.start.date;
        const span = daysEl.querySelector(`[data-date="${dateStr}"]`);
        if (span && !span.querySelector('.event-dot')) {
            const dot = document.createElement('span');
            dot.className = 'event-dot';
            span.appendChild(dot);
        }
    });
}

// ========== Login UI ==========
function renderCalendarLogin() {
    const container = document.getElementById('cal-events');
    if (!container) return;
    container.innerHTML = `
        <div class="gcal-login">
            <button class="gcal-login-btn" onclick="gcalLogin()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Conectar Google Calendar
            </button>
        </div>
    `;
}

// ========== Init ==========
async function initCalendarWidget() {
    // Start clock immediately
    updateClock();
    updateDate();
    updateWeekDays();
    setInterval(updateClock, 1000);
    setInterval(() => { updateDate(); updateWeekDays(); }, 60000);

    try {
        await initGoogleClients();

        const token = getStoredToken();
        if (token) {
            gcalAccessToken = token;
            await fetchAndRenderEvents();
            // Refresh every 5 minutes
            setInterval(fetchAndRenderEvents, 5 * 60 * 1000);
        } else {
            renderCalendarLogin();
        }
    } catch (err) {
        console.error('Calendar init error:', err);
        renderCalendarLogin();
    }
}

document.addEventListener('DOMContentLoaded', initCalendarWidget);
