// PumpPortal free websocket feed — wss://pumpportal.fun/api/data.
// WebSockets are NOT subject to CORS preflight, so this can work straight
// from the browser where pump.fun's HTTPS API is CORS-blocked.
// Free streams (no key): subscribeNewToken, subscribeMigration.
// Protocol: send {"method":"subscribeNewToken"} → receive
// { txType:"create", mint, name, symbol, traderPublicKey, ... }.
//
// In-browser probe: connect (10s timeout) → subscribe → listen 20s for a
// real create event. Live → buffer mints into the NEW feed (dedupe +
// fail-open like everything else). Dead → exponential backoff retry, never
// crashes the pipeline. State is inspectable for the UI.

const WS_URL = 'wss://pumpportal.fun/api/data';
const CONNECT_MS = 10000;
const LISTEN_MS = 20000;
const BUF_CAP = 60;
const RETRY_BASE = 30000;
const RETRY_MAX = 10 * 60 * 1000;

let ws = null;
let state = 'idle'; // idle | probing | live | dead
let retryAt = 0;
let backoffMs = RETRY_BASE;
const buf = []; // [{ mint, symbol, name, creator, ts }]
const seen = new Set();

export function pumpPortalState() { return state; }

// Recent buffered mints (for the NEW feed). Prunes older than 15 min.
export function getPumpPortalMints() {
  const now = Date.now();
  while (buf.length && now - buf[0].ts > 15 * 60 * 1000) {
    const old = buf.shift();
    seen.delete(old.mint);
  }
  return buf.slice();
}

function note(mint, symbol, name, creator) {
  if (!mint || typeof mint !== 'string' || mint.length < 32 || seen.has(mint)) return;
  seen.add(mint);
  buf.push({ mint, symbol: symbol || null, name: name || null, creator: creator || null, ts: Date.now() });
  if (buf.length > BUF_CAP) {
    const old = buf.shift();
    seen.delete(old.mint);
  }
}

function scheduleRetry() {
  state = 'dead';
  try { ws && ws.close(); } catch { /* noop */ }
  ws = null;
  retryAt = Date.now() + backoffMs;
  backoffMs = Math.min(backoffMs * 2, RETRY_MAX);
}

// Attempt the connection. No-ops when live/probing or inside backoff.
export function probePumpPortal() {
  if (state === 'live' || state === 'probing') return;
  if (Date.now() < retryAt) return;
  if (typeof WebSocket === 'undefined') return;
  state = 'probing';
  let settled = false;
  let gotEvent = false;
  const to = setTimeout(() => finish(false), CONNECT_MS + LISTEN_MS);
  const finish = (ok) => {
    if (settled) return;
    settled = true;
    clearTimeout(to);
    if (ok) {
      state = 'live';
      backoffMs = RETRY_BASE;
    } else {
      scheduleRetry();
    }
  };
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    finish(false);
    return;
  }
  ws.onopen = () => {
    try { ws.send(JSON.stringify({ method: 'subscribeNewToken' })); }
    catch { finish(false); }
  };
  ws.onmessage = (ev) => {
    let d = null;
    try { d = JSON.parse(ev.data); } catch { return; }
    if (!d || d.txType !== 'create' || !d.mint) return;
    gotEvent = true;
    note(d.mint, d.symbol, d.name, d.traderPublicKey);
    finish(true); // real token event → probe succeeded; stay connected
  };
  ws.onerror = () => finish(false);
  ws.onclose = () => {
    // If we were live and the socket dropped, back off and retry later.
    if (!settled) finish(false);
    else if (state === 'live') scheduleRetry();
  };
}
