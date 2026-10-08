// ALPHABOT real-only frontend — backend API layer.
// All data comes from the server. No paper trading, no local pipeline.

const URL_KEY = 'alphabot_backend_url_v1';
export const DEFAULT_BACKEND_URL = 'https://alphabot-backend-k6kn.onrender.com';

export function getBackendUrl() {
  try {
    const v = localStorage.getItem(URL_KEY);
    if (v === '') return null;
    if (v && /^https?:\/\//.test(v)) return v.replace(/\/+$/, '');
  } catch { /* private mode */ }
  return DEFAULT_BACKEND_URL;
}

export function setBackendUrl(u) {
  try {
    localStorage.setItem(URL_KEY, (u || '').trim().replace(/\/+$/, ''));
  } catch { /* private mode */ }
}

async function getJson(url, timeoutMs = 12000) {
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

async function postJson(url, body, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---- real book ----
export async function fetchRealBook(base) {
  const d = await getJson(`${base}/api/realbook`);
  if (!d || d.ok !== true) throw new Error('bad realbook payload');
  return d;
}

export async function sellPosition(base, mint) {
  const d = await postJson(`${base}/api/admin/sell-position`, { mint });
  if (!d || d.ok !== true) throw new Error((d && d.error) || 'sell failed');
  return d;
}

// ---- tuning / control ----
export async function fetchTuning(base) {
  const d = await getJson(`${base}/api/tuning`);
  return (d && d.tuning) || {};
}

export async function patchTuning(base, patch) {
  const d = await postJson(`${base}/api/tuning`, { patch });
  return (d && d.tuning) || {};
}

export async function setAggressive(base, on) {
  return postJson(`${base}/api/mode`, { on });
}

export async function setRugShield(base, on) {
  return postJson(`${base}/api/rugshield`, { on });
}

export async function trySynthesize(base) {
  try {
    return await postJson(`${base}/api/synthesize`, {});
  } catch (e) {
    return { ok: false, error: e.message || 'unavailable' };
  }
}

// ---- whale watch (Research Center — real data) ----
export async function fetchWhales(base) {
  const d = await getJson(`${base}/api/whales`, 30000);
  if (!d || d.ok !== true) throw new Error('bad whales payload');
  return d;
}

export async function fetchWhaleBuys(base, address) {
  const d = await getJson(`${base}/api/whales/${encodeURIComponent(address)}/buys`, 30000);
  if (!d || d.ok !== true) throw new Error('bad whale buys payload');
  return d;
}

// ---- formatters ----
export function fmtUsd(n) {
  if (n == null || !isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1000) return sign + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return sign + '$' + a.toFixed(2);
}

export function fmtUsdSigned(n) {
  if (n == null || !isFinite(n)) return '—';
  return (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
}

export function fmtPct(n) {
  if (n == null || !isFinite(n)) return '—';
  return (n >= 0 ? '+' : '−') + (Math.abs(n) * 100).toFixed(1) + '%';
}

export function fmtSol(n, digits = 4) {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(digits) + ' SOL';
}

export function fmtMc(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

export function fmtDur(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

export function fmtClock(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function shortMint(mint) {
  if (!mint) return '—';
  return mint.slice(0, 4) + '…' + mint.slice(-4);
}
