// ALPHABOT v3.4 — CALLOUT DETECTION as a research signal.
// "call outs should also be taken into consideration for research."
//
// Source: public Telegram callout channels via their no-login web previews
// (https://t.me/s/<channel>) fetched through the r.jina.ai reader proxy
// (CORS-open, already used by the site-read/hunt features).
//
// Channels below were VERIFIED live on 2026-10-06 (direct t.me/s fetch from
// a probe): each returned ~20 posts within the last 48h containing real
// contract addresses / $tickers. Dead/empty/private candidates probed and
// dropped: solana_millionaires, tigercrypt0calls, solanatokensnew,
// DSNewPairsSolana, NewSolPairs, pumpfun_calls (empty), dextoolspumps
// (chat, no calls), solanaalpha, solsignals, memecalls, + a dozen 404s.
// NOTE: r.jina.ai currently 401-blocks anonymous queries from some networks
// (bad-reputation ASNs) — the whole module is fail-open: a blocked/failed
// fetch contributes 0 ("no data"), never an error, never a verdict.
//
// Design:
//  - Once per scan cycle, each channel preview is fetched ONCE and cached
//    (5-min TTL); all survivors match against the cached texts.
//  - Match: token symbol (word-boundary, case-insensitive) OR mint prefix
//    (first 8 chars). Bare symbols need length >= 3 to avoid noise; $SYM
//    matches at any length.
//  - Signal: +3 per distinct channel, max +6. Own breakdown line, marked
//    "callout mention (unverified)" — a mention is NOT an endorsement and
//    channel quality varies. Stays inside the ±10 research budget (the
//    research clamp applies after this is added).
//  - Budgets: <=5 channels, 10s timeout each, staggered (~0.8s gaps).
//  - Never kills, never gates — additive only.

// Verified-live channel handles (public, no login, recent posts w/ calls).
export const CALLOUT_CHANNELS = ['repotrenches', 'solanacallspumps'];

const FETCH_MS = 10000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const STAGGER_MS = 800;
const MAX_POINTS = 6;
const PTS_PER_CHANNEL = 3;

let cache = null;    // { ts, channels: { name: { text, fetchedAt } } }
let inflight = null; // in-flight fetch promise (one per cycle burst)

async function fetchChannel(name) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const r = await fetch(`https://r.jina.ai/https://t.me/s/${name}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const text = await r.text();
    // A real preview is multi-KB of post markdown; anything smaller is a
    // block page / error / empty channel.
    if (!text || text.length < 1500) return null;
    return { name, text, fetchedAt: Date.now() };
  } catch {
    return null; // fail-open
  } finally {
    clearTimeout(to);
  }
}

// Fetch every channel preview ONCE per cycle window. Concurrent callers
// share the in-flight request; results cached for CACHE_TTL_MS.
export function getCalloutCache() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Promise.resolve(cache.channels);
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const channels = {};
    for (const name of CALLOUT_CHANNELS.slice(0, 5)) {
      const c = await fetchChannel(name);
      if (c) channels[name] = c;
      await new Promise(r => setTimeout(r, STAGGER_MS));
    }
    cache = { ts: Date.now(), channels };
    inflight = null;
    return channels;
  })();
  return inflight;
}

// Fire-and-forget warmup, called once per scan cycle before research runs.
export function warmCalloutCache() {
  try { getCalloutCache().catch(() => {}); } catch { /* noop */ }
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Scan cached channel texts for one candidate. Returns hits:
// [{ channel, at }] — `at` is the preview fetch time (posts in the preview
// are the channel's latest; shown honestly as "preview Xm ago").
export function matchCallouts(t, channels) {
  const hits = [];
  const sym = (t.symbol || '').trim();
  const mint8 = (t.address || '').slice(0, 8);
  for (const [name, ch] of Object.entries(channels || {})) {
    const text = ch.text || '';
    let hit = false;
    if (mint8.length >= 8 && text.includes(mint8)) hit = true;
    if (!hit && sym) {
      const re = sym.length >= 3
        ? new RegExp(`\\b${escRe(sym)}\\b`, 'i')
        : new RegExp(`\\$${escRe(sym)}\\b`, 'i');
      if (re.test(text)) hit = true;
    }
    if (hit) hits.push({ channel: name, at: ch.fetchedAt || Date.now() });
  }
  return hits;
}

// calloutCheck(t) -> { points, hits, line, calloutLine }. Always resolves.
export async function calloutCheck(t) {
  const none = { points: 0, hits: [], line: null, calloutLine: null };
  try {
    const channels = await getCalloutCache();
    const hits = matchCallouts(t, channels);
    if (!hits.length) return none;
    const points = Math.min(MAX_POINTS, hits.length * PTS_PER_CHANNEL);
    const names = hits.map(h => h.channel).join(', ');
    const newest = Math.max(...hits.map(h => h.at));
    return {
      points,
      hits,
      line: `callouts +${points} — mentioned in ${hits.length} channel${hits.length > 1 ? 's' : ''} (${names}) · unverified`,
      // Dedicated display line for the crawler-wall / detail view.
      // Names only, no invites/links, read-only.
      calloutLine: `mentioned in ${names} · preview ${fmtAgoShort(newest)} · callout mention (unverified)`,
    };
  } catch {
    return none;
  }
}

function fmtAgoShort(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
