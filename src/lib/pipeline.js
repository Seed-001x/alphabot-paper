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
import { buildFeeds, momentumScore } from './feeds.js';
import { getAdaptiveWeights } from './learning.js';
import { getPumpPortalMints, probePumpPortal } from './pumpportal.js';
import { STABLE_MINTS } from './helius.js';
import { fmtUsd } from './paper.js';
import { floorEmit } from './floorBus.js';

export const SCORE_WEIGHTS = { liquidity: 15, holders: 25, buyPressure: 30, curve: 15, age: 15, momentum: 10 };

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
  probePumpPortal(); // in-browser WS probe; no-op when live/probing/in backoff
  const [fresh, profiles, boosts] = await Promise.all([
    fetchFreshPumpCoins(40),
    fetchLatestProfiles(60),
    fetchLatestBoosts(60),
  ]);
  const meta = new Map(); // address -> pump metadata
  for (const f of fresh) meta.set(f.address, f);
  // PumpPortal WS mints — additional NEW-feed source once the socket is live.
  let ppMints = [];
  try { ppMints = getPumpPortalMints(); } catch { ppMints = []; }
  for (const m of ppMints) {
    if (m.mint && !meta.has(m.mint)) {
      meta.set(m.mint, { source: 'pumpportal', creator: m.creator || null, createdAt: m.ts });
    }
  }
  const addrs = [...meta.keys()];
  for (const s of [...profiles, ...boosts]) {
    if (s.address && !meta.has(s.address)) { meta.set(s.address, { source: s.source }); addrs.push(s.address); }
  }
  const batch = addrs.slice(0, 100);
  if (!batch.length) return { candidates: [], discovered: 0 };

  const raw = await fetchTokens(batch);
  // Enriched view per address (tokenView + chain for the feed engine).
  const enriched = new Map();
  for (const a of batch) {
    const pair = raw[a];
    if (!pair) continue;
    const t = tokenView(pair);
    if (t) enriched.set(a, { ...t, chainId: pair.chainId || null });
  }
  // v3.3 feed engine: NEW / TRENDING / MOVERS tags + raw UI rows (additive).
  // MOVERS snapshots record this cycle's mc/vol into the local rolling store.
  const { tags, movers, rows } = buildFeeds({
    fresh, profiles, boosts, enriched,
    ppMints: ppMints.map(m => m.mint).filter(Boolean),
  });
  try { floorEmit('feeds.ready', rows); } catch { /* fail-open */ }
  const candidates = [];
  for (const a of batch) {
    const pair = raw[a];
    const tagList = tags.get(a) || [];
    const fromFeed = tagList.includes('trending') || tagList.includes('movers');
    const chainOk = !pair || !pair.chainId || pair.chainId === 'solana';
    // NEW keeps the pump-mint preference; TRENDING/MOVERS are chain-agnostic
    // within Solana (graduated / non-pump coins eligible).
    if (!isPumpOrigin(a, pair) && !(fromFeed && chainOk)) continue;
    if (STABLE_MINTS.has(a)) continue;
    const t = enriched.get(a);
    if (!t || !t.price || !t.mc) continue;
    const m = meta.get(a) || {};
    const graduated = !isOnCurve(pair);
    const turnover = t.vol24h && t.mc ? t.vol24h / t.mc : 0;
    const mv = movers.get(a);
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
      feeds: tagList,                                   // v3.3: feed tags
      trendScore: tagList.includes('trending')
        ? (t.vol24h || 0) * ((t.buys24h || 0) + (t.sells24h || 0)) : null,
      moverPct: mv ? mv.moverPct : null,                // v3.3: local momentum
      volAccel: mv ? mv.volAccel : null,
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
  // v3.9: NO age floor (user's directive) — a $20k coin in its first minute
  // with volume is volatility/opportunity, not a rug signal. The $20k MC
  // floor (pumpMinMc) IS the newness filter. Only kill for youth when
  // minAgeMin > 0 (i.e. the operator explicitly re-enables it).
  if (cfg.minAgeMin > 0 && ageMs < cfg.minAgeMin * 60000) return `age ${Math.max(1, Math.round(ageMs / 60000))}m < ${cfg.minAgeMin}m floor`;
  const maxAgeMs = t.graduated ? cfg.maxAgeDays * 864e5 : cfg.maxPumpAgeHrs * 3600000;
  if (ageMs > maxAgeMs) return t.graduated
    ? `age ${(ageMs / 864e5).toFixed(1)}d > ${cfg.maxAgeDays}d max`
    : `age ${(ageMs / 3600000).toFixed(1)}h > ${cfg.maxPumpAgeHrs}h pump max`;
  // Authorities come free from the RugCheck firehose — a clean pump.fun
  // launch has both revoked.
  if (t.mintAuthOpen === true) return 'mint authority OPEN · dev can mint';
  if (t.freezeAuthOpen === true) return 'freeze authority OPEN · dev can freeze';
  const liq = t.liquidity || 0;
  // On-curve pump.fun coins report $0 DEX liquidity — the bonding curve IS
  // their liquidity (always sellable into the curve). Gate those on volume
  // instead; keep the LP floor for graduated coins with real DEX pools.
  if (t.graduated && !(liq >= cfg.minLiquidityUsd)) return `liq ${fmtUsd(liq)} < ${fmtUsd(cfg.minLiquidityUsd)} floor`;
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
// v3.10 WIDER NET: unknown trade counts are NOT a kill — the score's
// buyPressure component goes null and renormalizes out. Only kill when we
// positively see too few buys.
export function tradeKill(t, cfg) {
  const buys = t.buys24h, sells = t.sells24h;
  if (buys != null && !(buys >= cfg.minBuys24h)) return `buys24h ${buys} < ${cfg.minBuys24h} floor`;
  if (cfg.requireSells && sells != null && !(sells > 0)) return 'sells24h = 0 · no exit evidence';
  return null;
}

// ---------------------------------------------------------- VET: rug kill
// RugCheck holder dossier: dev share, concentration, holder count, rug flags.
// This is the expensive pass — only the top of the queue reaches it.
// v3.10 WIDER NET: hard kills ONLY for true rug vectors. A failed dossier
// fetch is not a kill (scoring renormalizes over known components), and the
// holder-count floor is dropped — concentration is already punished in the
// score's holders component, and thin-but-real markets deserve a vetting.
export async function rugKill(t, cfg) {
  const dossier = await fetchRugReport(t.address);
  if (!dossier) return { reason: null, dossier: null };
  if (dossier.rugged) return { reason: 'RugCheck flags RUGGED', dossier };
  if (dossier.devPct != null && dossier.devPct > cfg.maxDevPct)
    return { reason: `dev holds ${dossier.devPct.toFixed(1)}% > ${cfg.maxDevPct}% cap`, dossier };
  if (dossier.topPct != null && dossier.topPct > cfg.maxTopHolderPct)
    return { reason: `top holder ${dossier.topPct.toFixed(1)}% > ${cfg.maxTopHolderPct}% cap`, dossier };
  if (dossier.top10Pct != null && dossier.top10Pct > cfg.maxTop10Pct)
    return { reason: `top-10 ${dossier.top10Pct.toFixed(1)}% > ${cfg.maxTop10Pct}% cap`, dossier };
  return { reason: null, dossier };
}

// ---------------------------------------------------------- SCORE
// 0–100, transparent weights. Components with unknown inputs stay null and the
// total renormalizes over the known ones. The breakdown ships with the signal.

// Heat triage (v3.11 sniper playbook) — how "alive" a candidate is right now,
// from data already in hand (no API calls). Drives research-queue order: hot
// coins get the expensive research first, cold ones wait at the back. Cold
// coins are never killed for being cold — they just wait.
export function heatOf(t) {
  let h = 0;
  const turnover = (t.vol24h && t.mc) ? t.vol24h / t.mc : 0;
  h += Math.min(turnover * 10, 30);
  if (t.buys24h != null && t.sells24h != null && t.buys24h + t.sells24h > 0) {
    h += (t.buys24h / (t.buys24h + t.sells24h)) * 30;
  }
  if (t.mc < 200000 && turnover >= 1) h += 20;   // low-MC high-turnover = hot
  return h;
}

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

  // v3.3: feed momentum — movers-tagged candidates carry their locally
  // computed % mcap change; trending-tagged get a mild bump. Null when the
  // token carries no feed tag (renormalizes out, like every other unknown).
  const momentum = momentumScore(t);

  // v3.5: adaptive weights — journal-proven nudges toward predictive
  // components, bounded ±15%/day, hard floor/ceiling. Cold start → defaults.
  // Never overrides kill-chain hard kills (score weights only).
  const { weights: W, adapted } = getAdaptiveWeights(SCORE_WEIGHTS);

  const parts = { liquidity, holders, buyPressure, curve, age, momentum };
  let num = 0, den = 0;
  for (const k of Object.keys(W)) {
    if (parts[k] != null) { num += W[k] * parts[k]; den += W[k]; }
  }
  const score = den > 0 ? Math.round(num / den) : 0;
  return { score, breakdown: parts, adapted, weights: W };
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
  // Crawler-wall DOSSIER window feed (additive — return values unchanged).
  if (dossier) floorEmit('dossier.ready', {
    mint: t.address, symbol: t.symbol, name: t.name,
    devPct: dossier.devPct, topPct: dossier.topPct, top10Pct: dossier.top10Pct,
    holderCount: dossier.holderCount, rugged: dossier.rugged, risks: dossier.risks || [],
  });
  if (reason) {
    floorEmit('vet.kill', { mint: t.address, symbol: t.symbol, name: t.name, killPass: 'rug', killReason: reason });
    return { verdict: 'KILLED', killReason: reason, killPass: 'rug', dossier };
  }
  const { score, breakdown, adapted, weights } = scoreToken(t, dossier, cfg);
  floorEmit('vet.scored', {
    mint: t.address, symbol: t.symbol, name: t.name, score, breakdown,
    adapted: !!adapted,
    holderCount: dossier && dossier.holderCount != null ? dossier.holderCount : null,
    buys24h: t.buys24h != null ? t.buys24h : null,
    sells24h: t.sells24h != null ? t.sells24h : null,
    vol24h: t.vol24h != null ? t.vol24h : null,
  });
  return { verdict: 'SCORED', score, breakdown, dossier, adapted: !!adapted, weights };
}
