// ALPHABOT v2 pipeline: SCAN → VET (kill chain, ascending cost) → SCORE.
// "Code fetches, the model judges, code decides." Here the score IS the judge:
// a transparent 0–100 number with a visible breakdown. Unknown data = null,
// shown as "?", never zero, never faked.
//
// v2.1: pump.fun-first universe. Discovery is a hybrid:
//   (A) RugCheck new_tokens firehose → mint ends with "pump" (fresh launches,
//       exact age + creator + authority state for free), and
//   (B) DexScreener profiles/boosts filtered to pump.fun origin
//       (mint ends with "pump" or pair dexId === "pump") — pump coins with
//       traction. DexScreener enriches both; graduated coins (Raydium etc.)
//       stay in the universe with the graduated flag.

import { fetchTokens, fetchLatestProfiles, fetchLatestBoosts, tokenView } from './dexscreener.js';
import { fetchFreshPumpCoins, fetchRugReport, curveProgress, isOnCurve, PUMP_SUFFIX } from './pumpfun.js';
import { STABLE_MINTS } from './helius.js';
import { fmtUsd } from './paper.js';
import { floorEmit } from './floorBus.js';

export const SCORE_WEIGHTS = { liquidity: 15, holders: 25, buyPressure: 30, curve: 15, age: 15 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const logScale = (v, lo, hi) => {
  if (!(v > 0)) return 0;
  const l = Math.log10(Math.max(v, 1));
  return clamp(((l - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100, 0, 100);
};

const isPumpOrigin = (address, pair) =>
  (address && address.endsWith(PUMP_SUFFIX)) || isOnCurve(pair);

// ---------------------------------------------------------- SCAN
// Hybrid pump.fun discovery → DexScreener batch enrichment → turnover-ranked
// queue. Ranking orders work, decides nothing.
export async function scanTokens() {
  const [fresh, profiles, boosts] = await Promise.all([
    fetchFreshPumpCoins(40),
    fetchLatestProfiles(60),
    fetchLatestBoosts(60),
  ]);
  const meta = new Map(); // address -> pump metadata
  for (const f of fresh) meta.set(f.address, f);
  const addrs = [...meta.keys()];
  for (const s of [...profiles, ...boosts]) {
    if (s.address && !meta.has(s.address)) { meta.set(s.address, { source: s.source }); addrs.push(s.address); }
  }
  const batch = addrs.slice(0, 100);
  if (!batch.length) return { candidates: [], discovered: 0 };

  const raw = await fetchTokens(batch);
  const candidates = [];
  for (const a of batch) {
    const pair = raw[a];
    if (!isPumpOrigin(a, pair)) continue;      // pump.fun universe only
    if (STABLE_MINTS.has(a)) continue;
    const t = tokenView(pair);
    if (!t || !t.price || !t.mc) continue;
    const m = meta.get(a) || {};
    const graduated = !isOnCurve(pair);
    const turnover = t.vol24h && t.mc ? t.vol24h / t.mc : 0;
    candidates.push({
      ...t,
      source: m.source || 'pump',
      creator: m.creator || null,
      mintAuthOpen: m.mintAuthOpen != null ? m.mintAuthOpen : null,
      freezeAuthOpen: m.freezeAuthOpen != null ? m.freezeAuthOpen : null,
      // RugCheck createAt is exact; fall back to DexScreener pair age.
      createdAt: m.createdAt || t.createdAt,
      graduated,
      curvePct: graduated ? 100 : curveProgress(t.mc),
    });
  }
  candidates.sort((a, b) => b.turnover - a.turnover);
  return { candidates, discovered: batch.length };
}

// ---------------------------------------------------------- VET: free kill
// Pure numeric checks on data we already hold — costs zero extra calls.
export function freeKill(t, cfg) {
  const ageMs = t.createdAt ? Date.now() - t.createdAt : null;
  if (ageMs == null) return 'age unknown';
  if (ageMs < cfg.minAgeMin * 60000) return `age ${Math.max(1, Math.round(ageMs / 60000))}m < ${cfg.minAgeMin}m floor`;
  const maxAgeMs = t.graduated ? cfg.maxAgeDays * 864e5 : cfg.maxPumpAgeHrs * 3600000;
  if (ageMs > maxAgeMs) return t.graduated
    ? `age ${(ageMs / 864e5).toFixed(1)}d > ${cfg.maxAgeDays}d max`
    : `age ${(ageMs / 3600000).toFixed(1)}h > ${cfg.maxPumpAgeHrs}h pump max`;
  // Authorities come free from the RugCheck firehose — a clean pump.fun
  // launch has both revoked.
  if (t.mintAuthOpen === true) return 'mint authority OPEN · dev can mint';
  if (t.freezeAuthOpen === true) return 'freeze authority OPEN · dev can freeze';
  const liq = t.liquidity || 0;
  if (!(liq >= cfg.minLiquidityUsd)) return `liq ${fmtUsd(liq)} < ${fmtUsd(cfg.minLiquidityUsd)} floor`;
  const vol = t.vol24h || 0;
  if (!(vol >= cfg.minVol24hUsd)) return `vol24h ${fmtUsd(vol)} < ${fmtUsd(cfg.minVol24hUsd)} floor`;
  const mc = t.mc || 0;
  const lo = t.graduated ? cfg.minMc : cfg.pumpMinMc;
  const hi = t.graduated ? cfg.maxMc : cfg.pumpMaxMc;
  if (mc < lo) return `MC ${fmtUsd(mc)} < ${fmtUsd(lo)} floor`;
  if (mc > hi) return `MC ${fmtUsd(mc)} > ${fmtUsd(hi)} cap`;
  return null;
}

// ---------------------------------------------------------- VET: trade kill
// DexScreener trade counts — the enrich call is already paid for.
export function tradeKill(t, cfg) {
  const buys = t.buys24h, sells = t.sells24h;
  if (buys == null || sells == null) return 'trade counts unknown';
  if (!(buys >= cfg.minBuys24h)) return `buys24h ${buys} < ${cfg.minBuys24h} floor`;
  if (cfg.requireSells && !(sells > 0)) return 'sells24h = 0 · no exit evidence';
  return null;
}

// ---------------------------------------------------------- VET: rug kill
// RugCheck holder dossier: dev share, concentration, holder count, rug flags.
// This is the expensive pass — only the top of the queue reaches it.
export async function rugKill(t, cfg) {
  const dossier = await fetchRugReport(t.address);
  if (!dossier) return { reason: 'rug dossier unavailable', dossier: null };
  if (dossier.rugged) return { reason: 'RugCheck flags RUGGED', dossier };
  if (dossier.devPct != null && dossier.devPct > cfg.maxDevPct)
    return { reason: `dev holds ${dossier.devPct.toFixed(1)}% > ${cfg.maxDevPct}% cap`, dossier };
  if (dossier.topPct != null && dossier.topPct > cfg.maxTopHolderPct)
    return { reason: `top holder ${dossier.topPct.toFixed(1)}% > ${cfg.maxTopHolderPct}% cap`, dossier };
  if (dossier.top10Pct != null && dossier.top10Pct > cfg.maxTop10Pct)
    return { reason: `top-10 ${dossier.top10Pct.toFixed(1)}% > ${cfg.maxTop10Pct}% cap`, dossier };
  if (dossier.holderCount != null && dossier.holderCount < cfg.minHolders)
    return { reason: `holders ${dossier.holderCount} < ${cfg.minHolders} floor · thin`, dossier };
  return { reason: null, dossier };
}

// ---------------------------------------------------------- SCORE
// 0–100, transparent weights. Components with unknown inputs stay null and the
// total renormalizes over the known ones. The breakdown ships with the signal.
export function scoreToken(t, dossier, cfg) {
  const ageH = t.createdAt ? (Date.now() - t.createdAt) / 3600000 : null;

  const liquidity = logScale(t.liquidity, cfg.minLiquidityUsd, 1e6);

  let holders = null;
  if (dossier && (dossier.topPct != null || dossier.top10Pct != null || dossier.devPct != null)) {
    const topS = dossier.topPct != null ? clamp(100 - (dossier.topPct / cfg.maxTopHolderPct) * 100, 0, 100) : null;
    const devS = dossier.devPct != null ? clamp(100 - (dossier.devPct / cfg.maxDevPct) * 100, 0, 100) : null;
    const parts = [topS, devS].filter(v => v != null);
    holders = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  }

  let buyPressure = null;
  if (t.buys24h != null && t.sells24h != null && t.buys24h + t.sells24h > 0) {
    const r = t.buys24h / (t.buys24h + t.sells24h);
    buyPressure = clamp(r * 160 - 30, 0, 100);
  }

  // Bonding-curve position: sweet spot is mid-curve (15–85%). Too early is
  // dust; near-graduation is snipe territory. Graduated coins skip this.
  let curve = null;
  if (t.graduated) {
    curve = 70; // graduated = curve risk gone; neutral-good
  } else if (t.curvePct != null) {
    const p = t.curvePct;
    curve = p < 15 ? (p / 15) * 60 : p <= 85 ? 60 + 40 * ((p - 15) / 70) : 100 - ((p - 85) / 15) * 50;
    curve = clamp(curve, 0, 100);
  }

  let age = null;
  if (ageH != null) {
    const maxH = t.graduated ? cfg.maxAgeDays * 24 : cfg.maxPumpAgeHrs;
    age = ageH <= 6 ? 70 + 30 * (ageH / 6) : clamp(100 - ((ageH - 6) / Math.max(maxH - 6, 1)) * 100, 0, 100);
  }

  const parts = { liquidity, holders, buyPressure, curve, age };
  let num = 0, den = 0;
  for (const k of Object.keys(SCORE_WEIGHTS)) {
    if (parts[k] != null) { num += SCORE_WEIGHTS[k] * parts[k]; den += SCORE_WEIGHTS[k]; }
  }
  const score = den > 0 ? Math.round(num / den) : 0;
  return { score, breakdown: parts };
}

// Full VET+SCORE for one candidate. Returns { verdict, score, breakdown, dossier, killReason }.
// Emits floor events (additive — the return values are the contract).
export async function vetToken(t, cfg) {
  const fk = freeKill(t, cfg);
  if (fk) {
    floorEmit('vet.kill', { mint: t.address, symbol: t.symbol, name: t.name, killPass: 'free', killReason: fk });
    return { verdict: 'KILLED', killReason: fk, killPass: 'free' };
  }
  const tk = tradeKill(t, cfg);
  if (tk) {
    floorEmit('vet.kill', { mint: t.address, symbol: t.symbol, name: t.name, killPass: 'trade', killReason: tk });
    return { verdict: 'KILLED', killReason: tk, killPass: 'trade' };
  }
  const { reason, dossier } = await rugKill(t, cfg);
  if (reason) {
    floorEmit('vet.kill', { mint: t.address, symbol: t.symbol, name: t.name, killPass: 'rug', killReason: reason });
    return { verdict: 'KILLED', killReason: reason, killPass: 'rug', dossier };
  }
  const { score, breakdown } = scoreToken(t, dossier, cfg);
  floorEmit('vet.scored', {
    mint: t.address, symbol: t.symbol, name: t.name, score, breakdown,
    holderCount: dossier && dossier.holderCount != null ? dossier.holderCount : null,
  });
  return { verdict: 'SCORED', score, breakdown, dossier };
}
