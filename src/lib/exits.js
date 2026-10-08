// ALPHABOT v3.6 — ADAPTIVE EXITS. exitPolicy() replaces fixed thresholds.
// The RISK stage learns when to break its own TP/SL rules, from the trade
// journal only. Base params (scalp): TP +30%, SL −15%, trail −12% arms +10%,
// 90-min max hold.
//
// Learned deviations (each cold-start gated: ≥10 closed trades globally):
//  1. RUNNER EXTENSION (≥5 examples): profile = movers tag + buyPressure ≥70
//     and past same-profile winners ran ≥2x past base TP. On hitting base TP
//     → DON'T hard-exit: switch to trailing-stop-only. Hard cap: 3x base TP.
//  2. DEAD-MONEY CUT (≥5 examples): held ≥20min, pnl in [−8%,+5%], volume
//     decaying (cur vol < 0.7x entry vol) → exit early instead of waiting for
//     SL / max hold.
//  3. STOP PROFILING (≥5 trades/bucket): per (feed tag, score band) bucket
//     win-rate → SL/TP nudge. HARD BOUNDS: SL never wider than −25%, never
//     tighter than −8%; TP never below +15%.
// Every learned deviation is logged in the trade record with a reason tag.
// Journal empty/corrupt → pure base parameters. Fail-open.

import { readJournal } from './learning.js';

export const EXIT_MIN_TRADES = 10;
const RUNNER_MIN = 5;
const DEADCUT_MIN = 5;
const BUCKET_MIN = 5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function feedOf(j) {
  const f = j.feeds || [];
  if (f.includes('movers')) return 'movers';
  if (f.includes('trending')) return 'trending';
  if (f.includes('new')) return 'new';
  return 'none';
}

function bandOf(score) {
  const s = score || 0;
  return s < 70 ? '<70' : s < 80 ? '70-80' : '80+';
}

export function bucketKeyFor(j) {
  return `${feedOf(j)}/${bandOf(j.score)}`;
}

const isRunnerProfile = (j) =>
  feedOf(j) === 'movers' && ((j.buyPressure ?? j.breakdown?.buyPressure) || 0) >= 70;

// getExitRules(cfg) -> { ready, n, runner, deadCut, buckets }.
// Computed fresh from the journal each call (cheap: ≤500 rows).
export function getExitRules(cfg) {
  const J = readJournal().filter(t => t.exitTs != null && t.pnlPct != null);
  const baseTP = cfg.takeProfit, baseSL = cfg.stopLoss;
  const rules = {
    ready: J.length >= EXIT_MIN_TRADES, n: J.length,
    runner: { active: false, n: 0 },
    deadCut: { active: false, n: 0, avg: null },
    buckets: {},
  };
  if (!rules.ready) return rules;
  try {
    // 1. runners: same-profile winners that ran ≥2x past base TP
    const runnerWins = J.filter(j => isRunnerProfile(j) && j.pnlPct >= 2 * baseTP * 100);
    rules.runner = { active: runnerWins.length >= RUNNER_MIN, n: runnerWins.length };
    // 2. dead money: held ≥20min, died flat in [−15%,+5%], lost on average
    const dead = J.filter(j => (j.holdMs || 0) >= 20 * 60e3 && j.pnlPct >= -15 && j.pnlPct <= 5);
    const avg = dead.length ? dead.reduce((a, j) => a + j.pnlPct, 0) / dead.length : null;
    rules.deadCut = { active: dead.length >= DEADCUT_MIN && avg != null && avg < -2, n: dead.length, avg };
    // 3. buckets: per-profile win-rate → bounded SL/TP nudge
    const by = {};
    for (const j of J) {
      const k = bucketKeyFor(j);
      const e = by[k] || (by[k] = { key: k, n: 0, wins: 0 });
      e.n++;
      if (j.pnlPct > 0) e.wins++;
    }
    for (const k of Object.keys(by)) {
      const e = by[k];
      if (e.n < BUCKET_MIN) continue;
      const winRate = e.wins / e.n;
      let sl = baseSL, tp = baseTP;
      if (winRate >= 0.6) { sl = baseSL * 1.33; tp = baseTP * 1.33; }        // proven: room to run
      else if (winRate < 0.4) { sl = baseSL * 0.67; tp = baseTP * 0.67; }    // weak: cut fast
      sl = clamp(sl, 0.08, 0.25);   // HARD: never tighter than −8%, never wider than −25%
      tp = Math.max(0.15, tp);      // HARD: TP never below +15%
      rules.buckets[k] = {
        ...e, winRate,
        sl: Math.round(sl * 1000) / 1000, tp: Math.round(tp * 1000) / 1000,
        adjusted: Math.abs(sl - baseSL) > 0.001 || Math.abs(tp - baseTP) > 0.001,
      };
    }
  } catch { /* journal corrupt → base params */ }
  return rules;
}

// exitPolicy(pos, quote, cfg, rules) -> { reason, learned } | null.
// quote = { price, mc, vol24h }. Mutates pos.runnerMode when extension arms.
export function exitPolicy(pos, q, cfg, rules) {
  const midMultiple = q.mc / pos.entryMc;
  if (!(midMultiple > 0)) return null;
  const pnlPct = (midMultiple - 1) * 100;
  const holdMs = Date.now() - pos.entryTs;
  const tag = (n) => `(learned, n=${n})`;

  // Profiled thresholds for this trade (rule 3).
  const bkt = rules.buckets[bucketKeyFor(pos)];
  const sl = bkt ? bkt.sl : cfg.stopLoss;
  const tp = bkt ? bkt.tp : cfg.takeProfit;
  const profLearned = !!(bkt && bkt.adjusted);
  const profNote = profLearned ? ` (profiled ${bucketKeyFor(pos)}, n=${bkt.n})` : '';

  // Rule 1 — RUNNER EXTENSION: past same-profile winners ran; don't hard-exit
  // at TP, switch to trailing-only. Hard cap at 3x base TP no matter what.
  if (rules.runner.active && isRunnerProfile(pos)) {
    const n = rules.runner.n;
    if (midMultiple >= 1 + 3 * cfg.takeProfit) {
      return { reason: `runner cap 3x TP ${tag(n)}`, learned: true };
    }
    if (pos.runnerMode) {
      if (pos.peakMultiple >= 1 + cfg.trailingArmAt &&
          midMultiple <= pos.peakMultiple * (1 - cfg.trailingStop)) {
        return { reason: `runner trail −${Math.round(cfg.trailingStop * 100)}% from peak ${tag(n)}`, learned: true };
      }
      return null; // trailing-only: ignore SL/TP/max-hold while running
    }
    if (midMultiple >= 1 + tp) {
      pos.runnerMode = true; // arm extension — no exit this tick
      return null;
    }
  }

  // Base exits (with profiled thresholds when the bucket earned them).
  if (midMultiple >= 1 + tp) return { reason: `take-profit +${Math.round(tp * 100)}%${profNote}`, learned: profLearned };
  if (midMultiple <= 1 - sl) return { reason: `stop-loss −${Math.round(sl * 100)}%${profNote}`, learned: profLearned };
  if (pos.peakMultiple >= 1 + cfg.trailingArmAt &&
      midMultiple <= pos.peakMultiple * (1 - cfg.trailingStop)) {
    return { reason: `trailing stop −${Math.round(cfg.trailingStop * 100)}% from peak`, learned: false };
  }
  if (holdMs >= cfg.maxHoldHours * 3600e3) {
    return { reason: `max hold ${cfg.maxHoldHours}h reached`, learned: false };
  }

  // SNIPER PLAYBOOK (v3.11, baked, ungated): memecoin exits are about speed.
  // Order-flow death — track buys/sells flow SINCE ENTRY (24h aggregates move
  // too slowly tick-to-tick). If sell flow dominates buy flow 1.5x with
  // meaningful volume, it's distribution: get out before the floor falls out.
  const b = q.buys24h, s = q.sells24h;
  if (b != null && s != null) {
    if (pos.flowB0 == null) { pos.flowB0 = b; pos.flowS0 = s; }
    const dB = Math.max(0, b - pos.flowB0), dS = Math.max(0, s - pos.flowS0);
    if (dB + dS >= 10 && dS > dB * 1.5 && pnlPct < 15) {
      return { reason: `flow dead · +${dB} buys vs +${dS} sells since entry — distribution`, learned: false };
    }
  }
  // Stall — 20 minutes in and it hasn't moved: it's not going to. Rotate.
  // (Doesn't touch runners: TP/trailing/runner-extension all returned above.)
  if (holdMs >= 20 * 60e3 && pnlPct > -5 && pnlPct < 10) {
    return { reason: `stalled ${Math.round(holdMs / 60000)}m · flat ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(0)}% — rotating`, learned: false };
  }

  // Rule 2 — DEAD-MONEY CUT: flat and volume dying → exit early.
  if (rules.deadCut.active && holdMs >= 20 * 60e3 && pnlPct >= -8 && pnlPct <= 5) {
    const ev = pos.entryVol || null;
    const cv = q.vol24h || null;
    if (ev && cv && cv < ev * 0.7) {
      return { reason: `dead-money cut (flat ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(0)}%, vol decaying) ${tag(rules.deadCut.n)}`, learned: true };
    }
  }
  return null;
}
