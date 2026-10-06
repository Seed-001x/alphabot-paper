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
      // v3.8: rolling history for the accumulation detector — last 12
      // samples inside the window (monotonic volume-climb detection).
      e.hist = e.hist || [];
      e.hist.push({ mc: t.mc, vol: t.vol24h || 0, ts: now });
      e.hist = e.hist.filter(p => now - p.ts <= WINDOW_MS).slice(-12);
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

// ------------------------------------------------------- accumulation probe
// v3.8 — ACCUMULATION DETECTOR (user's own trading insight: the money is in
// buying the slow volume crawl BEFORE the boom, not chasing the pump).
// From the rolling per-mint snapshot history (mcap + vol per scan cycle):
//   volGrowth    = vol_now / vol_oldest
//   volMonotonic = consecutive snapshot-to-snapshot volume increases
//   mcapChange   = (mc_now - mc_oldest) / mc_oldest
// Signature: volGrowth >= 1.5 AND volMonotonic >= 3 AND mcapChange < 0.5
//   → the crawl before the boom: +4 ("ACC +4").
// Chase guard: mcapChange >= 1.0 (already doubled inside the window)
//   → −3 ("CHASE −3"), UNLESS buyPressure >= 80 (sustained genuine demand,
//   not a spike) — then no penalty. <4 snapshots → null (fail-open).
// Returns { modifier, label } or null. Pure read.
export function accumulationSignal(t) {
  try {
    if (!t || !t.address) return null;
    const s = loadStore();
    const e = s[t.address];
    if (!e || !e.hist || e.hist.length < 4) return null;
    const h = e.hist;
    const oldest = h[0];
    const now = h[h.length - 1];
    if (!(oldest.mc > 0) || !(oldest.vol > 0) || !(now.vol >= 0)) return null;
    const volGrowth = now.vol / oldest.vol;
    let volMonotonic = 0;
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i].vol > h[i - 1].vol) volMonotonic++;
      else break;
    }
    const mcapChange = (now.mc - oldest.mc) / oldest.mc;
    // ACCUMULATION: steady volume crawl, price hasn't boomed yet.
    if (volGrowth >= 1.5 && volMonotonic >= 3 && mcapChange < 0.5) {
      return {
        modifier: 4,
        label: `ACC +4 · vol climbing ${volGrowth.toFixed(1)}x, mc +${(mcapChange * 100).toFixed(0)}% — accumulation, not yet boomed`,
      };
    }
    // CHASE GUARD: already doubled in-window — don't chase, unless
    // buyPressure >= 80 signals sustained genuine demand.
    if (mcapChange >= 1.0) {
      let bp = null;
      if (t.buys24h != null && t.sells24h != null && t.buys24h + t.sells24h > 0) {
        bp = clamp((t.buys24h / (t.buys24h + t.sells24h)) * 160 - 30, 0, 100);
      }
      if (!(bp != null && bp >= 80)) {
        return {
          modifier: -3,
          label: `CHASE −3 · already boomed +${(mcapChange * 100).toFixed(0)}% in window — don't chase`,
        };
      }
    }
    return null;
  } catch { return null; }
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
