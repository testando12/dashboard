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
let calLastEvents = [];
let calExpandedYear = new Date().getFullYear();
let calExpandedMonth = new Date().getMonth();
let calSelectedDate = new Date().toISOString().split('T')[0];

// ========== Local Events (localStorage) ==========
function loadLocalEvents() {
    try { return JSON.parse(localStorage.getItem('cal_local_events') || '[]'); }
    catch(e) { return []; }
}
function saveLocalEvents(evs) {
    localStorage.setItem('cal_local_events', JSON.stringify(evs));
}
function getAllEvents() {
    return [...calLastEvents, ...loadLocalEvents()];
}

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
    if (el) el.innerHTML = `<span style="display:block">${days[now.getDay()]},</span><span style="display:block">${now.getDate()} ${months[now.getMonth()]}</span>`;
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

        // Outer cell
        const cell = document.createElement('span');
        cell.className = 'cal-day-cell';
        cell.dataset.date = d.toISOString().split('T')[0];
        if (d.getDate() === today && d.getMonth() === now.getMonth()) {
            cell.classList.add('active');
        }

        // Inner number circle
        const num = document.createElement('span');
        num.className = 'cal-day-num';
        num.textContent = d.getDate();
        cell.appendChild(num);

        daysEl.appendChild(cell);
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

    // Next 30 days
    const nextWeek = new Date(now);
    nextWeek.setDate(now.getDate() + 30);

    try {
        const response = await gapi.client.calendar.events.list({
            calendarId: 'primary',
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            showDeleted: false,
            singleEvents: true,
            maxResults: 50,
            orderBy: 'startTime'
        });

        const events = response.result.items || [];
        calLastEvents = events;
        const isExpanded = document.querySelector('.calendar-widget.cal-expanded');
        if (isExpanded) {
            window.renderExpandedCalendar(events);
        } else {
            renderEvents(events);
            markEventDots(events);
        }
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

    // Show only the next 1 event
    const ev = events[0];
    container.innerHTML = `
        <div class="calendar-event">
            <span class="event-label">${isToday(ev) ? 'Hoje' : 'Próximo evento'}</span>
            <div class="event-detail">
                <span class="event-name">${ev.summary || '(sem título)'}</span>
                <span class="event-time">${formatEventTime(ev)}</span>
            </div>
        </div>
    `;
}

function markEventDots(events) {
    const daysEl = document.getElementById('cal-days');
    if (!daysEl) return;
    events.forEach(ev => {
        const dateStr = ev.start.dateTime
            ? ev.start.dateTime.split('T')[0]
            : ev.start.date;
        const cell = daysEl.querySelector(`[data-date="${dateStr}"]`);
        if (cell && !cell.querySelector('.event-dot')) {
            const dot = document.createElement('span');
            dot.className = 'event-dot';
            cell.appendChild(dot);  // appends below .cal-day-num inside the flex-column cell
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

// ========== Expanded Calendar View ==========
function buildEventsSection(dateStr) {
    const fmt = dt => new Date(dt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true});
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const d = new Date(dateStr + 'T12:00:00');
    const now = new Date();
    const isToday = dateStr === now.toISOString().split('T')[0];
    const label = isToday ? 'TODAY' : `${dayNames[d.getDay()].toUpperCase()}, ${d.getDate()} ${months[d.getMonth()].toUpperCase().slice(0,3)}`;

    const allEvs = getAllEvents();
    const dayEvs = allEvs.filter(ev => {
        const s = (ev.start.dateTime || ev.start.date || '').split('T')[0];
        return s === dateStr;
    }).sort((a,b) => {
        const ta = a.start.dateTime || a.start.date;
        const tb = b.start.dateTime || b.start.date;
        return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    const evItems = dayEvs.length === 0
        ? '<div class="cal-exp-no-events">No activities this day</div>'
        : dayEvs.map(ev => {
            const isLocal = !!ev._local;
            const start = ev.start.dateTime ? fmt(ev.start.dateTime) : 'All day';
            const end   = ev.end && ev.end.dateTime ? fmt(ev.end.dateTime) : '';
            const loc   = ev.location || '';
            const delBtn = isLocal ? `<button class="cal-ev-del" onclick="calDeleteLocalEvent('${ev._localId}')" title="Remove"><i class="fas fa-times"></i></button>` : '';
            return `<div class="cal-exp-event-item${isLocal ? ' cal-ev-local' : ''}">
                <div class="cal-exp-time-col"><span>${start}</span>${end?`<span>${end}</span>`:''}</div>
                <div class="cal-exp-event-bar${isLocal ? ' cal-ev-local-bar' : ''}"></div>
                <div class="cal-exp-event-info">
                    <span class="cal-exp-event-title">${ev.summary||'(no title)'}</span>
                    ${loc?`<span class="cal-exp-event-sub">${loc}</span>`:''}
                </div>${delBtn}</div>`;
        }).join('');

    return { label, count: dayEvs.length, evItems };
}

window.calSelectDay = function(dateStr) {
    calSelectedDate = dateStr;
    const grid = document.querySelector('.cal-exp-grid');
    if (grid) {
        grid.querySelectorAll('span.cal-day-selected').forEach(s => s.classList.remove('cal-day-selected'));
        const target = grid.querySelector(`[data-date="${dateStr}"]`);
        if (target) target.classList.add('cal-day-selected');
    }
    const section = document.querySelector('.cal-exp-today-section');
    if (!section) return;
    const { label, count, evItems } = buildEventsSection(dateStr);
    section.querySelector('.cal-exp-today-label').textContent = label;
    section.querySelector('.cal-exp-today-count').textContent = `${count} ${count === 1 ? 'Activity' : 'Activities'}`;
    section.querySelector('.cal-exp-events-list').innerHTML = evItems;
};

window.calDeleteLocalEvent = function(id) {
    const evs = loadLocalEvents().filter(e => e._localId !== id);
    saveLocalEvents(evs);
    window.calSelectDay(calSelectedDate);
    // refresh dots
    window.renderExpandedCalendar();
};

window.calOpenAddModal = function() {
    let modal = document.getElementById('cal-add-modal');
    if (!modal) {
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const d = new Date(calSelectedDate + 'T12:00:00');
        modal = document.createElement('div');
        modal.id = 'cal-add-modal';
        modal.innerHTML = `
            <div id="cal-modal-backdrop"></div>
            <div id="cal-modal-sheet">
                <div class="cal-modal-handle"></div>
                <div class="cal-modal-title">New Event</div>
                <div class="cal-modal-date-label">${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}</div>
                <div class="cal-modal-field">
                    <label>Title</label>
                    <input id="cal-input-title" type="text" placeholder="Event title" autocomplete="off" />
                </div>
                <div class="cal-modal-row">
                    <div class="cal-modal-field">
                        <label>Start time</label>
                        <input id="cal-input-start" type="time" value="09:00" />
                    </div>
                    <div class="cal-modal-field">
                        <label>End time</label>
                        <input id="cal-input-end" type="time" value="10:00" />
                    </div>
                </div>
                <div class="cal-modal-field">
                    <label>Location <span style="opacity:.4">(optional)</span></label>
                    <input id="cal-input-loc" type="text" placeholder="Room, address..." autocomplete="off" />
                </div>
                <div class="cal-modal-actions">
                    <button class="cal-modal-cancel" onclick="calCloseAddModal()">Cancel</button>
                    <button class="cal-modal-save" onclick="calSaveLocalEvent()">Add Event</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('cal-modal-backdrop').addEventListener('click', window.calCloseAddModal);
    }
    requestAnimationFrame(() => {
        modal.classList.add('cal-modal-open');
        setTimeout(() => document.getElementById('cal-input-title').focus(), 320);
    });
};

window.calCloseAddModal = function() {
    const modal = document.getElementById('cal-add-modal');
    if (modal) {
        modal.classList.remove('cal-modal-open');
        setTimeout(() => modal.remove(), 350);
    }
};

window.calSaveLocalEvent = function() {
    const title = document.getElementById('cal-input-title').value.trim();
    if (!title) { document.getElementById('cal-input-title').focus(); return; }
    const startT = document.getElementById('cal-input-start').value;
    const endT   = document.getElementById('cal-input-end').value;
    const loc    = document.getElementById('cal-input-loc').value.trim();
    const ev = {
        _local: true,
        _localId: Date.now().toString(36) + Math.random().toString(36).slice(2),
        summary: title,
        location: loc || undefined,
        start: { dateTime: `${calSelectedDate}T${startT}:00` },
        end:   { dateTime: `${calSelectedDate}T${endT}:00` }
    };
    const evs = loadLocalEvents();
    evs.push(ev);
    saveLocalEvents(evs);
    window.calCloseAddModal();
    window.renderExpandedCalendar();
    setTimeout(() => window.calSelectDay(calSelectedDate), 50);
};

window.renderExpandedCalendar = function(eventsOverride) {
    if (eventsOverride) calLastEvents = eventsOverride;
    const monthNames = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
        'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    const now = new Date();
    const todayD = now.getDate(), todayM = now.getMonth(), todayY = now.getFullYear();
    if (!calSelectedDate) calSelectedDate = now.toISOString().split('T')[0];

    const firstDow = new Date(calExpandedYear, calExpandedMonth, 1).getDay();
    const daysInMonth = new Date(calExpandedYear, calExpandedMonth + 1, 0).getDate();
    const daysInPrev = new Date(calExpandedYear, calExpandedMonth, 0).getDate();

    let cells = '';
    for (let i = firstDow - 1; i >= 0; i--)
        cells += `<span class="cal-other-month">${daysInPrev - i}</span>`;

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calExpandedYear}-${String(calExpandedMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday = d === todayD && calExpandedMonth === todayM && calExpandedYear === todayY;
        const isSelected = dateStr === calSelectedDate;
    const hasEv = getAllEvents().some(ev => (ev.start.dateTime || ev.start.date || '').split('T')[0] === dateStr);
        const classes = [isToday ? 'cal-today-day' : '', isSelected ? 'cal-day-selected' : ''].filter(Boolean).join(' ');
        cells += `<span class="${classes}" data-date="${dateStr}">${d}${hasEv ? '<em class="cal-exp-dot"></em>' : ''}</span>`;
    }
    const trailing = 7 - ((firstDow + daysInMonth) % 7 || 7);
    if (trailing < 7) for (let d = 1; d <= trailing; d++)
        cells += `<span class="cal-other-month">${d}</span>`;

    const { label: selLabel, count: selCount, evItems } = buildEventsSection(calSelectedDate);

    const widget = document.querySelector('.calendar-widget');
    widget.innerHTML = `
        <div class="cal-exp-wrap">
            <div class="cal-exp-header">
                <button class="cal-nav-btn" onclick="calNavMonth(-1)">&#8249;</button>
                <span class="cal-exp-month-title">${monthNames[calExpandedMonth]} ${calExpandedYear}</span>
                <button class="cal-nav-btn" onclick="calNavMonth(1)">&#8250;</button>
                <i class="fas fa-times cal-exp-close" style="margin-left:auto;cursor:pointer;color:rgba(255,255,255,0.4);font-size:13px;"></i>
            </div>
            <div class="cal-exp-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
            <div class="cal-exp-grid">${cells}</div>
            <div class="cal-exp-today-section">
                <div class="cal-exp-today-header">
                    <span class="cal-exp-today-label">${selLabel}</span>
                    <span class="cal-exp-today-count">${selCount} ${selCount === 1 ? 'Activity' : 'Activities'}</span>
                    <span class="cal-exp-see-all">See all ›</span>
                </div>
                <div class="cal-exp-events-list">${evItems}</div>
            </div>
            <div class="cal-exp-bottom-bar">
                <button class="cal-bb-btn" onclick="calSelectDay('${new Date().toISOString().split('T')[0]}')"><i class="fas fa-sun"></i><span>Today</span></button>
                <button class="cal-bb-btn"><i class="fas fa-calendar"></i><span>Calendar</span></button>
                <button class="cal-bb-add" onclick="calOpenAddModal()"><i class="fas fa-plus"></i></button>
                <button class="cal-bb-btn"><i class="fas fa-inbox"></i><span>Inbox</span></button>
                <button class="cal-bb-btn"><i class="fas fa-share-alt"></i><span>Share</span></button>
            </div>
        </div>`;

    // Click delegation on grid days
    const grid = widget.querySelector('.cal-exp-grid');
    if (grid) {
        grid.addEventListener('click', (e) => {
            const span = e.target.closest('[data-date]');
            if (!span || span.classList.contains('cal-other-month')) return;
            window.calSelectDay(span.dataset.date);
        });
    }
};

window.calNavMonth = function(dir) {
    calExpandedMonth += dir;
    if (calExpandedMonth < 0)  { calExpandedMonth = 11; calExpandedYear--; }
    if (calExpandedMonth > 11) { calExpandedMonth = 0;  calExpandedYear++; }
    window.renderExpandedCalendar();
};

window.restoreCompactCalendar = function() {
    calExpandedYear = new Date().getFullYear();
    calExpandedMonth = new Date().getMonth();
    calSelectedDate = new Date().toISOString().split('T')[0];
    const widget = document.querySelector('.calendar-widget');
    widget.innerHTML = `
        <div class="widget-header">
            <span class="widget-title">Calendar</span>
            <i class="fas fa-plus widget-link"></i>
        </div>
        <div id="cal-time" class="calendar-time">--:--</div>
        <div id="cal-date" class="calendar-date">...</div>
        <div class="calendar-week">
            <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
        </div>
        <div id="cal-days" class="calendar-days"></div>
        <div id="cal-events"></div>`;
    updateClock(); updateDate(); updateWeekDays();
    if (calLastEvents.length > 0) { renderEvents(calLastEvents); markEventDots(calLastEvents); }
    else if (gcalAccessToken || getStoredToken()) fetchAndRenderEvents();
    else renderCalendarLogin();
};

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
