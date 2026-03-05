// ==================== SPOTIFY NOW PLAYING ====================
// Uses Spotify Web API with Authorization Code + PKCE flow
// Works entirely in the browser — no backend needed

const SPOTIFY_CONFIG = {
    clientId: 'ad8a488ee068482498e651d5f849946b',
    redirectUri: 'https://testando12.github.io/dashboard/src/index.html',
    scopes: 'user-read-currently-playing user-read-playback-state user-modify-playback-state',
    tokenEndpoint: 'https://accounts.spotify.com/api/token',
    authEndpoint: 'https://accounts.spotify.com/authorize',
    apiBase: 'https://api.spotify.com/v1'
};

// ========== PKCE Helpers ==========
function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const values = crypto.getRandomValues(new Uint8Array(length));
    for (let i = 0; i < length; i++) {
        result += chars[values[i] % chars.length];
    }
    return result;
}

async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
}

function base64urlencode(arrayBuffer) {
    let str = '';
    const bytes = new Uint8Array(arrayBuffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(codeVerifier) {
    const hashed = await sha256(codeVerifier);
    return base64urlencode(hashed);
}

// ========== Auth Flow ==========
async function spotifyLogin() {
    const codeVerifier = generateRandomString(64);
    localStorage.setItem('spotify_code_verifier', codeVerifier);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
        client_id: SPOTIFY_CONFIG.clientId,
        response_type: 'code',
        redirect_uri: SPOTIFY_CONFIG.redirectUri,
        scope: SPOTIFY_CONFIG.scopes,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        show_dialog: 'true'
    });

    window.location.href = `${SPOTIFY_CONFIG.authEndpoint}?${params.toString()}`;
}

async function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (!code) return false;

    const codeVerifier = localStorage.getItem('spotify_code_verifier');
    if (!codeVerifier) return false;

    try {
        const response = await fetch(SPOTIFY_CONFIG.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: SPOTIFY_CONFIG.clientId,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: SPOTIFY_CONFIG.redirectUri,
                code_verifier: codeVerifier
            })
        });

        const data = await response.json();
        if (data.access_token) {
            localStorage.setItem('spotify_access_token', data.access_token);
            localStorage.setItem('spotify_refresh_token', data.refresh_token);
            localStorage.setItem('spotify_token_expiry', Date.now() + (data.expires_in * 1000));
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        }
    } catch (err) {
        console.error('Spotify auth error:', err);
    }
    return false;
}

async function refreshAccessToken() {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) return false;

    try {
        const response = await fetch(SPOTIFY_CONFIG.tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: SPOTIFY_CONFIG.clientId,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        });

        const data = await response.json();
        if (data.access_token) {
            localStorage.setItem('spotify_access_token', data.access_token);
            localStorage.setItem('spotify_token_expiry', Date.now() + (data.expires_in * 1000));
            if (data.refresh_token) {
                localStorage.setItem('spotify_refresh_token', data.refresh_token);
            }
            return true;
        }
    } catch (err) {
        console.error('Token refresh error:', err);
    }
    return false;
}

async function getValidToken() {
    const expiry = localStorage.getItem('spotify_token_expiry');
    if (expiry && Date.now() > parseInt(expiry) - 60000) {
        await refreshAccessToken();
    }
    return localStorage.getItem('spotify_access_token');
}

// ========== API Calls ==========
async function getCurrentlyPlaying() {
    const token = await getValidToken();
    if (!token) return null;

    try {
        const response = await fetch(`${SPOTIFY_CONFIG.apiBase}/me/player/currently-playing`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 204) return null; // Nothing playing
        if (!response.ok) {
            if (response.status === 401) {
                await refreshAccessToken();
                return getCurrentlyPlaying();
            }
            return null;
        }
        return await response.json();
    } catch (err) {
        console.error('Fetch now playing error:', err);
        return null;
    }
}

// ========== Playback Controls ==========
async function spotifyControl(action) {
    const token = await getValidToken();
    if (!token) return;

    const endpoints = {
        play:     { method: 'PUT',  url: `${SPOTIFY_CONFIG.apiBase}/me/player/play` },
        pause:    { method: 'PUT',  url: `${SPOTIFY_CONFIG.apiBase}/me/player/pause` },
        next:     { method: 'POST', url: `${SPOTIFY_CONFIG.apiBase}/me/player/next` },
        previous: { method: 'POST', url: `${SPOTIFY_CONFIG.apiBase}/me/player/previous` }
    };

    const ep = endpoints[action];
    if (!ep) return;

    try {
        await fetch(ep.url, {
            method: ep.method,
            headers: { 'Authorization': `Bearer ${token}` }
        });
        // Refresh UI after short delay
        setTimeout(async () => {
            const data = await getCurrentlyPlaying();
            updateNowPlaying(data);
        }, 300);
    } catch (err) {
        console.error('Playback control error:', err);
    }
}

// ========== UI Update ==========
function formatMs(ms) {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateNowPlaying(data) {
    const container = document.getElementById('spotify-now-playing');
    if (!container) return;

    if (!data || !data.item) {
        container.innerHTML = `
            <div class="sp-idle">
                <i class="fas fa-music"></i>
                <span>Nenhuma música tocando</span>
                <span class="sp-idle-sub">Abra o Spotify e toque algo</span>
            </div>
        `;
        return;
    }

    const track = data.item;
    const artist = track.artists.map(a => a.name).join(', ');
    const album = track.album.name;
    const albumArt = track.album.images[0]?.url || '';
    const progress = data.progress_ms || 0;
    const duration = track.duration_ms;
    const progressPct = (progress / duration) * 100;
    const isPlaying = data.is_playing;

    container.innerHTML = `
        <div class="sp-cover-area">
            <img class="sp-album-art" src="${albumArt}" alt="${album}">
            <div class="sp-track-details">
                <span class="sp-track-name">${track.name}</span>
                <span class="sp-track-artist">${artist}</span>
                <div class="sp-controls-area">
                    <div class="sp-progress-bar">
                        <div class="sp-progress-fill" style="width: ${progressPct}%"></div>
                    </div>
                    <div class="sp-times">
                        <span>${formatMs(progress)}</span>
                        <span>${formatMs(duration)}</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="sp-controls-bar">
            <button class="sp-ctrl-btn" onclick="spotifyControl('previous')" title="Anterior">
                <i class="fas fa-backward-step"></i>
            </button>
            <button class="sp-ctrl-btn play-pause" onclick="spotifyControl('${isPlaying ? 'pause' : 'play'}')" title="${isPlaying ? 'Pausar' : 'Tocar'}">
                <i class="fas ${isPlaying ? 'fa-pause' : 'fa-play'}"></i>
            </button>
            <button class="sp-ctrl-btn" onclick="spotifyControl('next')" title="Próxima">
                <i class="fas fa-forward-step"></i>
            </button>
        </div>
    `;
}

// ========== Polling Loop ==========
let pollInterval = null;

function startPolling() {
    async function poll() {
        const data = await getCurrentlyPlaying();
        updateNowPlaying(data);
    }
    poll(); // immediate
    pollInterval = setInterval(poll, 3000); // every 3 seconds
}

function stopPolling() {
    if (pollInterval) clearInterval(pollInterval);
}

// ========== Logout ==========
function spotifyLogout() {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_token_expiry');
    localStorage.removeItem('spotify_code_verifier');
    stopPolling();
    initSpotifyWidget();
}

// ========== Init ==========
async function initSpotifyWidget() {
    const container = document.getElementById('spotify-now-playing');
    if (!container) return;

    // Check if returning from auth callback
    const hasCode = new URLSearchParams(window.location.search).has('code');
    if (hasCode) {
        const success = await handleCallback();
        if (success) {
            startPolling();
            return;
        }
    }

    // Check if already authenticated
    const token = localStorage.getItem('spotify_access_token');
    if (token) {
        startPolling();
        return;
    }

    // Show login button
    container.innerHTML = `
        <div class="sp-login">
            <i class="fab fa-spotify sp-login-icon"></i>
            <span class="sp-login-text">Conectar ao Spotify</span>
            <button class="sp-login-btn" onclick="spotifyLogin()">
                <i class="fab fa-spotify"></i> Login com Spotify
            </button>
        </div>
    `;
}

// Start when page loads
document.addEventListener('DOMContentLoaded', initSpotifyWidget);
