// ALPHABOT v2 pipeline: SCAN → VET (kill chain, ascending cost) → SCORE.
// "Code fetches, the model judges, code decides." Here the score IS the judge:
// a transparent 0–100 number with a visible breakdown. Unknown data = null,
// shown as "?", never zero, never faked.

import { fetchTokens, fetchLatestProfiles, fetchLatestBoosts, tokenView } from './dexscreener.js';
import { holderConcentration, mintAuthorities } from './chain.js';
import { STABLE_MINTS } from './helius.js';
import { fmtUsd } from './paper.js';

export const SCORE_WEIGHTS = { liquidity: 25, holders: 25, buyPressure: 20, volume: 15, age: 15 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const logScale = (v, lo, hi) => {
  if (!(v > 0)) return 0;
  const l = Math.log10(Math.max(v, 1));
  return clamp(((l - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100, 0, 100);
};

// ---------------------------------------------------------- SCAN
// Pull fresh Solana tokens from DexScreener discovery feeds, enrich in batches,
// rank the queue by turnover (volume/MC) — ranking orders work, decides nothing.
export async function scanTokens() {
  const [profiles, boosts] = await Promise.all([fetchLatestProfiles(60), fetchLatestBoosts(60)]);
  const seen = new Map();
  for (const s of [...profiles, ...boosts]) {
    if (!seen.has(s.address)) seen.set(s.address, s.source);
  }
  const addrs = [...seen.keys()].slice(0, 80);
  if (!addrs.length) return { candidates: [], discovered: 0 };

  const raw = await fetchTokens(addrs);
  const candidates = [];
  for (const a of addrs) {
    const t = tokenView(raw[a]);
    if (!t || !t.price || !t.mc) continue;
    if (STABLE_MINTS.has(a)) continue;
    const turnover = t.vol24h && t.mc ? t.vol24h / t.mc : 0;
    candidates.push({ ...t, source: seen.get(a), turnover });
  }
  candidates.sort((a, b) => b.turnover - a.turnover);
  return { candidates, discovered: addrs.length };
}

// ---------------------------------------------------------- VET: free kill
// Pure numeric checks on data we already have — costs zero extra calls.
export function freeKill(t, cfg) {
  const ageMs = t.createdAt ? Date.now() - t.createdAt : null;
  if (ageMs == null) return 'age unknown';
  if (ageMs < cfg.minAgeMin * 60000) return `age ${Math.max(1, Math.round(ageMs / 60000))}m < ${cfg.minAgeMin}m floor`;
  if (ageMs > cfg.maxAgeDays * 864e5) return `age ${(ageMs / 864e5).toFixed(1)}d > ${cfg.maxAgeDays}d max`;
  const liq = t.liquidity || 0;
  if (!(liq >= cfg.minLiquidityUsd)) return `liq ${fmtUsd(liq)} < ${fmtUsd(cfg.minLiquidityUsd)} floor`;
  const vol = t.vol24h || 0;
  if (!(vol >= cfg.minVol24hUsd)) return `vol24h ${fmtUsd(vol)} < ${fmtUsd(cfg.minVol24hUsd)} floor`;
  const mc = t.mc || 0;
  if (mc < cfg.minMc) return `MC ${fmtUsd(mc)} < ${fmtUsd(cfg.minMc)} floor`;
  if (mc > cfg.maxMc) return `MC ${fmtUsd(mc)} > ${fmtUsd(cfg.maxMc)} cap`;
  return null;
}

// ---------------------------------------------------------- VET: trade kill
// DexScreener trade counts — one enrich call already paid for.
export function tradeKill(t, cfg) {
  const buys = t.buys24h, sells = t.sells24h;
  if (buys == null || sells == null) return 'trade counts unknown';
  if (!(buys >= cfg.minBuys24h)) return `buys24h ${buys} < ${cfg.minBuys24h} floor`;
  if (cfg.requireSells && !(sells > 0)) return 'sells24h = 0 · no exit evidence';
  return null;
}

// ---------------------------------------------------------- VET: chain kill
// On-chain facts via public RPC: authorities + holder concentration.
export async function chainKill(t, cfg) {
  const [conc, auth] = await Promise.all([
    holderConcentration(t.address),
    mintAuthorities(t.address),
  ]);
  const dossier = { ...conc, ...auth };
  if (dossier.mintAuthOpen === true) return { reason: 'mint authority OPEN · dev can mint', dossier };
  if (dossier.freezeAuthOpen === true) return { reason: 'freeze authority OPEN · dev can freeze', dossier };
  if (dossier.topPct != null && dossier.topPct > cfg.maxTopHolderPct)
    return { reason: `top holder ${dossier.topPct.toFixed(1)}% > ${cfg.maxTopHolderPct}% cap`, dossier };
  if (dossier.top10Pct != null && dossier.top10Pct > cfg.maxTop10Pct)
    return { reason: `top-10 ${dossier.top10Pct.toFixed(1)}% > ${cfg.maxTop10Pct}% cap`, dossier };
  return { reason: null, dossier };
}

// ---------------------------------------------------------- SCORE
// 0–100, transparent weights. Components with unknown inputs stay null and the
// total renormalizes over the known ones. The breakdown ships with the signal.
export function scoreToken(t, dossier, cfg) {
  const ageH = t.createdAt ? (Date.now() - t.createdAt) / 3600000 : null;

  const liquidity = logScale(t.liquidity, cfg.minLiquidityUsd, 1e6);

  let holders = null;
  if (dossier && (dossier.topPct != null || dossier.top10Pct != null)) {
    const topS = dossier.topPct != null ? clamp(100 - (dossier.topPct / cfg.maxTopHolderPct) * 100, 0, 100) : null;
    const t10S = dossier.top10Pct != null ? clamp(100 - (dossier.top10Pct / cfg.maxTop10Pct) * 100, 0, 100) : null;
    holders = topS != null && t10S != null ? (topS * 0.6 + t10S * 0.4) : (topS != null ? topS : t10S);
  }

  let buyPressure = null;
  if (t.buys24h != null && t.sells24h != null && t.buys24h + t.sells24h > 0) {
    const r = t.buys24h / (t.buys24h + t.sells24h);
    buyPressure = clamp(r * 160 - 30, 0, 100);
  }

  const volume = logScale(t.vol24h, cfg.minVol24hUsd, 2e6);

  let age = null;
  if (ageH != null) {
    age = ageH <= 12 ? 60 + 40 * (ageH / 12) : clamp(100 - ((ageH - 12) / (cfg.maxAgeDays * 24 - 12)) * 100, 0, 100);
  }

  const parts = { liquidity, holders, buyPressure, volume, age };
  let num = 0, den = 0;
  for (const k of Object.keys(SCORE_WEIGHTS)) {
    if (parts[k] != null) { num += SCORE_WEIGHTS[k] * parts[k]; den += SCORE_WEIGHTS[k]; }
  }
  const score = den > 0 ? Math.round(num / den) : 0;
  return { score, breakdown: parts };
}

// Full VET+SCORE for one candidate. Returns { verdict, score, breakdown, dossier, killReason }.
export async function vetToken(t, cfg) {
  const fk = freeKill(t, cfg);
  if (fk) return { verdict: 'KILLED', killReason: fk, killPass: 'free' };
  const tk = tradeKill(t, cfg);
  if (tk) return { verdict: 'KILLED', killReason: tk, killPass: 'trade' };
  const { reason, dossier } = await chainKill(t, cfg);
  if (reason) return { verdict: 'KILLED', killReason: reason, killPass: 'chain', dossier };
  const { score, breakdown } = scoreToken(t, dossier, cfg);
  return { verdict: 'SCORED', score, breakdown, dossier };
}
