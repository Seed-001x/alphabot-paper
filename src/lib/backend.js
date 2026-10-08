// v3.8 — BACKEND MODE client. Read-only bridge to the server-side desk.
// The backend runs the same pipeline on a server (no CORS there, direct
// pump.fun API, durable Postgres ledgers). This module only READS:
//   /health      → liveness + cycle freshness
//   /api/state   → full snapshot (portfolio, stats, feeds, brain, events)
//   /api/events  → recent pipeline events (translated into floorBus shapes)
// Fail-open everywhere: any failure → local mode, never a blank screen.
// The free tier sleeps when idle — that is WHY the < 3 min freshness gate
// exists. One /health per 30s is plenty; never wake it aggressively.

export const DEFAULT_BACKEND_URL = 'https://alphabot-backend-k6kn.onrender.com';
const URL_KEY = 'alphabot_backend_url_v1';
// Backend data must be fresher than this to enter/stay in server mode.
export const FRESH_MS = 3 * 60 * 1000;

export function getBackendUrl() {
  try {
    const v = localStorage.getItem(URL_KEY);
    if (v === '') return null; // explicitly disabled by the user
    if (v && /^https?:\/\//.test(v)) return v.replace(/\/+$/, '');
  } catch { /* private mode */ }
  return DEFAULT_BACKEND_URL;
}

export function backendEnabled() {
  try {
    return localStorage.getItem(URL_KEY) !== '';
  } catch {
    return true;
  }
}

export function setBackendUrl(u) {
  try {
    // '' = disabled (stays disabled until a URL is saved again)
    localStorage.setItem(URL_KEY, (u || '').trim().replace(/\/+$/, ''));
  } catch { /* private mode */ }
}

async function getJson(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchHealth(base) {
  const h = await getJson(`${base}/health`, 10000);
  if (!h || h.ok !== true) throw new Error('bad health payload');
  return h;
}

export async function fetchState(base) {
  const s = await getJson(`${base}/api/state`, 15000);
  if (!s || !s.portfolio) throw new Error('bad state payload');
  return s;
}

export async function fetchEvents(base, limit = 80) {
  const e = await getJson(`${base}/api/events?limit=${limit}`, 10000);
  return (e && Array.isArray(e.events)) ? e.events : [];
}

// Fresh = the server ran a pipeline cycle within the last FRESH_MS.
// A sleeping free-tier service fails this → local mode takes over.
export function isFresh(health, now = Date.now()) {
  return !!(
    health &&
    health.ok === true &&
    health.lastCycleTs &&
    (now - health.lastCycleTs) < FRESH_MS
  );
}

export function cycleAgeMs(health, now = Date.now()) {
  if (!health || !health.lastCycleTs) return null;
  return Math.max(0, now - health.lastCycleTs);
}
