// ALPHABOT v3.3 — FEED ENGINE. Replicates the Trending/Movers/New feed logic
// from CORS-friendly sources (Axiom has no public API; pump.fun's
// frontend-api-v3 is CORS-blocked — verified). Three feeds:
//   NEW      — RugCheck new_tokens firehose (pump.fun launches; existing).
//   TRENDING — DexScreener boosts/profiles ranked by vol24h x txns (existing
//              data, formalized with a trend score).
//   MOVERS   — computed LOCALLY: rolling localStorage snapshots per mint
//              (mcap + volume sampled each scan cycle, 24h window), ranked by
//              % mcap change and volume acceleration. Capped at 300 mints,
//              stale entries pruned. No new API keys, fail-open everywhere.
//
// "Even if launched on another chain": TRENDING/MOVERS are chain-agnostic
// within Solana (graduated Raydium coins eligible); only NEW keeps the
// pump-mint preference.

const LS_KEY = 'alphabot_movers_v1';
const MAX_MINTS = 300;
const WINDOW_MS = 24 * 3600 * 1000;
const MIN_WINDOW_H = 0.5; // need >=30min between first/last snapshot

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- snapshots
function loadStore() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch { return {}; }
}
function saveStore(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* full/blocked */ }
}

// Record one sample per enriched candidate. Call once per scan cycle.
export function recordSnapshots(cands) {
  try {
    const s = loadStore();
    const now = Date.now();
    for (const t of cands) {
      if (!t || !t.address || !(t.mc > 0)) continue;
      const e = s[t.address] || {};
      e.prev = e.last || null;
      e.last = { mc: t.mc, vol: t.vol24h || 0, ts: now };
      if (!e.first) e.first = e.last;
      s[t.address] = e;
    }
    // Prune: drop entries older than the window, then cap by oldest-first.
    for (const k of Object.keys(s)) {
      if (now - ((s[k].last && s[k].last.ts) || 0) > WINDOW_MS) delete s[k];
    }
    const keys = Object.keys(s);
    if (keys.length > MAX_MINTS) {
      keys.sort((a, b) => ((s[a].last && s[a].last.ts) || 0) - ((s[b].last && s[b].last.ts) || 0));
      for (const k of keys.slice(0, keys.length - MAX_MINTS)) delete s[k];
    }
    saveStore(s);
  } catch { /* fail-open */ }
}

// Ranked movers from the snapshot store. Pure read.
export function computeMovers(limit = 40) {
  try {
    const s = loadStore();
    const now = Date.now();
    const out = [];
    for (const [mint, e] of Object.entries(s)) {
      if (!e.first || !e.last || !(e.first.mc > 0)) continue;
      const ageH = (now - e.first.ts) / 3600000;
      if (ageH < MIN_WINDOW_H) continue;
      const moverPct = ((e.last.mc - e.first.mc) / e.first.mc) * 100;
      const volAccel = e.prev && e.prev.vol > 0 && e.last.vol != null
        ? e.last.vol / e.prev.vol : null;
      out.push({ mint, moverPct, volAccel, firstTs: e.first.ts, lastTs: e.last.ts });
    }
    // Momentum rank: % mcap change primary, volume acceleration tiebreak.
    out.sort((a, b) =>
      (b.moverPct - a.moverPct) ||
      ((b.volAccel || 0) - (a.volAccel || 0)));
    return out.slice(0, limit);
  } catch { return []; }
}

// ------------------------------------------------------------- feed tagging
// Build per-mint feed tags + raw UI rows from one cycle's inputs.
//   fresh    — RugCheck firehose items [{address, createdAt, ...}]
//   profiles/boosts — DexScreener discovery items [{address, ...}]
//   enriched — Map(address -> tokenView + chainId + url)
// Returns { tags: Map(mint -> ['new','trending','movers']),
//           rows: { new: [...], trending: [...], movers: [...] } }
export function buildFeeds({ fresh, profiles, boosts, enriched, ppMints }) {
  const tags = new Map();
  const tag = (mint, f) => {
    if (!mint) return;
    if (!tags.has(mint)) tags.set(mint, []);
    const arr = tags.get(mint);
    if (!arr.includes(f)) arr.push(f);
  };
  // NEW = RugCheck firehose + PumpPortal WS stream (when the socket is live).
  const newSet = new Set(
    [...(fresh || []).map(f => f.address), ...((ppMints || []))].filter(Boolean)
  );
  const trendSet = new Set();
  for (const s of [...(profiles || []), ...(boosts || [])]) {
    if (s && s.address) trendSet.add(s.address);
  }

  // Record this cycle's samples BEFORE computing movers, so fresh data lands.
  const cands = [...(enriched || new Map()).values()];
  recordSnapshots(cands);
  const movers = computeMovers();
  const moverMap = new Map(movers.map(m => [m.mint, m]));

  for (const m of newSet) tag(m, 'new');
  for (const m of trendSet) tag(m, 'trending');
  for (const m of moverMap.keys()) tag(m, 'movers');

  const row = (t) => ({
    mint: t.address, symbol: t.symbol, name: t.name,
    mc: t.mc, vol24h: t.vol24h,
    txns: (t.buys24h || 0) + (t.sells24h || 0),
    createdAt: t.createdAt, url: t.url || null,
    tags: tags.get(t.address) || [],
  });

  const newRows = [];
  for (const m of newSet) {
    const t = enriched.get(m);
    if (t) newRows.push(row(t));
  }
  newRows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const trendRows = [];
  for (const m of trendSet) {
    const t = enriched.get(m);
    if (!t) continue;
    const r = row(t);
    r.trendScore = (t.vol24h || 0) * ((t.buys24h || 0) + (t.sells24h || 0));
    trendRows.push(r);
  }
  trendRows.sort((a, b) => (b.trendScore || 0) - (a.trendScore || 0));

  const moverRows = [];
  for (const m of movers) {
    const t = enriched.get(m.mint);
    if (!t) continue;
    const r = row(t);
    r.moverPct = m.moverPct;
    r.volAccel = m.volAccel;
    moverRows.push(r);
  }

  return {
    tags,
    movers: moverMap,
    rows: {
      new: newRows.slice(0, 25),
      trending: trendRows.slice(0, 25),
      movers: moverRows.slice(0, 25),
    },
  };
}

// Momentum score 0–100 from feed tags. Modest by design.
export function momentumScore(t) {
  if (t.moverPct != null && isFinite(t.moverPct)) {
    // +100% move over the window -> ~75; +400% -> 100.
    return clamp(50 + t.moverPct * 0.25, 0, 100);
  }
  if (t.feeds && t.feeds.includes('trending')) return 55; // mild, data-light
  return null; // unknown -> renormalizes out
}
