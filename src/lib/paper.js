// Paper trading engine v2 — token-first. Fake money, real signals.
// Entries come from token SCORES (0–100), not copy signals. Nothing here
// touches real funds: every number is virtual USD held in localStorage.
// Never promises profit. Not financial advice.

import { STABLE_MINTS } from './helius.js';
import { floorEmit } from './floorBus.js';

// ------------------------------------------------------------ portfolio

const PKEY = 'alphabot_portfolio_v2';
const PAUSED_KEY = 'alphabot_paused_v2';

export function freshPortfolio(bankroll0) {
  return {
    bankroll0, cash: bankroll0,
    equity: [{ ts: Date.now(), v: bankroll0 }],
    positions: [],   // open: {mint,symbol,name,entryMc,entryPrice,entryTs,sizeUsd,tokens,peakMultiple,score,eliteHit}
    closed: [],      // newest first
    signals: [],     // newest first, capped — KILLED + SCORED verdicts
    cooldowns: {},   // mint -> ts
    createdAt: Date.now(),
    version: 2,
  };
}
export function loadPortfolio(cfg) {
  try {
    const raw = localStorage.getItem(PKEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.positions) && p.version === 2) return p;
    }
  } catch {}
  return freshPortfolio(cfg.bankroll0);
}
export function savePortfolio(p) { try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch {} }
export function resetPortfolio(bankroll0) {
  const p = freshPortfolio(bankroll0);
  savePortfolio(p);
  return p;
}
export function isPaused() { try { return localStorage.getItem(PAUSED_KEY) === '1'; } catch { return false; } }
export function setPaused(v) { try { localStorage.setItem(PAUSED_KEY, v ? '1' : '0'); } catch {} }

// ------------------------------------------------------------ formatting

export function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—';
  const sign = v < 0 ? '-' : v > 0 ? '+' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(a < 100 ? 2 : 0)}`;
}
export function fmtPct(v) {
  if (v == null || isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
export function fmtAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
export function fmtClock(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return ''; }
}

// ------------------------------------------------------------ signals

const MAX_SIGNALS = 400;

export function logSignal(p, s) {
  p.signals = [s, ...(p.signals || [])].slice(0, MAX_SIGNALS);
}

// Process one vet result into a signal record, opening a paper position when
// the score clears the bar and the risk gates pass. Mutates portfolio.
// When opts.silent, the signal is returned but NOT logged (caller dedups).
export function processResult(p, r, cfg, opts = {}) {
  const now = Date.now();
  const t = r.t;
  const base = {
    id: `${t.address}-${Math.floor(now / 1000)}`,
    ts: now, mint: t.address,
    symbol: t.symbol, name: t.name,
    taken: false, reason: '',
  };
  const done = (sig, entered) => {
    if (!opts.silent) logSignal(p, sig);
    return { signal: sig, entered };
  };

  if (r.verdict === 'KILLED') {
    const sig = { ...base, verdict: 'KILLED', killPass: r.killPass, killReason: r.killReason, reason: `KILLED [${r.killPass}] · ${r.killReason}` };
    return done(sig, false);
  }

  // SCORED — apply research nudge, then elite boost, then entry gates.
  // (research only ever nudges ±10; it cannot kill or clear gates by itself)
  let score = r.score;
  const researchMod = r.researchMod || 0;
  score = Math.max(0, Math.min(100, score + researchMod));
  const boost = r.eliteHit ? cfg.eliteBoost : 0;
  const finalScore = Math.min(100, score + boost);
  const sig = {
    ...base, verdict: 'SCORED',
    score: finalScore, rawScore: r.score,
    researchMod, researchLine: r.researchLine || null,
    calloutLine: r.calloutLine || null,
    judgeMod: r.judgeMod || 0, judgeLine: r.judgeLine || null,
    breakdown: r.breakdown, dossier: r.dossier || null,
    adapted: !!r.adapted,
    eliteHit: !!r.eliteHit,
    flowTag: !!r.flowTag,
    entryMc: t.mc,
  };

  const gate = (why) => {
    sig.reason = `SCORED ${finalScore} · no entry: ${why}`;
    floorEmit('trade.skip', { mint: t.address, symbol: t.symbol, name: t.name, score: finalScore, reason: why });
    return done(sig, false);
  };

  if (STABLE_MINTS.has(t.address)) return gate('stablecoin excluded');
  if (!(finalScore >= cfg.minTokenScore)) return gate(`score ${finalScore} < ${cfg.minTokenScore} bar`);
  if ((p.positions || []).length >= cfg.maxPositions) return gate(`max ${cfg.maxPositions} positions open`);
  if ((p.positions || []).some(x => x.mint === t.address)) return gate(`already holding ${t.symbol}`);
  const cd = (p.cooldowns || {})[t.address];
  if (cd && now - cd < cfg.cooldownMin * 60000)
    return gate(`cooldown — ${fmtDur(cfg.cooldownMin * 60000 - (now - cd))} left`);

  const sizeUsd = Math.min(p.cash, p.cash * cfg.positionPct);
  if (!(sizeUsd > 1)) return gate(`cash too low (${fmtUsd(p.cash)})`);
  if (!(t.price > 0)) return gate('no price');

  const entryPrice = t.price * (1 + cfg.slippage);
  const entryMc = (t.mc || 0) * (1 + cfg.slippage);
  const tokens = sizeUsd / entryPrice;
  p.cash = Math.max(0, p.cash - sizeUsd);
  p.positions.push({
    mint: t.address, symbol: t.symbol, name: t.name,
    entryMc, entryPrice, entryTs: now,
    sizeUsd, tokens, peakMultiple: 1,
    score: finalScore, eliteHit: !!r.eliteHit, flowTag: !!r.flowTag,
  });
  sig.taken = true;
  sig.reason = `ENTER ${t.symbol} · score ${finalScore}${researchMod ? ` (${researchMod >= 0 ? '+' : ''}${researchMod} research)` : ''}${r.eliteHit ? ` (+${boost} smart flow)` : ''} · ${fmtUsd(sizeUsd)} @ ${fmtUsd(entryMc)} MC`;
  floorEmit('trade.enter', {
    mint: t.address, symbol: t.symbol, name: t.name,
    score: finalScore, sizeUsd, entryMc, researchMod,
  });
  return done(sig, true);
}

// ------------------------------------------------------------ exits

// Evaluate exit triggers for every open position. Mutates portfolio.
// eliteSwaps: { addr: { sells: [{mint, ts}] } } — optional, needs Helius key.
export function tick(p, priceMap, eliteSwaps, cfg) {
  const now = Date.now();
  const closed = [];
  const keep = [];
  for (const pos of (p.positions || [])) {
    const t = priceMap[pos.mint];
    if (!t || !t.price || !t.mc) { keep.push(pos); continue; } // no quote — hold
    const midMultiple = t.mc / pos.entryMc;
    if (midMultiple > pos.peakMultiple) pos.peakMultiple = midMultiple;

    let reason = null;
    if (midMultiple >= 1 + cfg.takeProfit) {
      reason = `take-profit +${Math.round(cfg.takeProfit * 100)}%`;
    } else if (midMultiple <= 1 - cfg.stopLoss) {
      reason = `stop-loss −${Math.round(cfg.stopLoss * 100)}%`;
    } else if (pos.peakMultiple >= 1 + cfg.trailingArmAt && midMultiple <= pos.peakMultiple * (1 - cfg.trailingStop)) {
      reason = `trailing stop −${Math.round(cfg.trailingStop * 100)}% from peak`;
    } else if (now - pos.entryTs >= cfg.maxHoldHours * 3600e3) {
      reason = `max hold ${cfg.maxHoldHours}h reached`;
    } else if (eliteSwaps) {
      // Smart-flow exit: ≥2 sells seen this token since entry.
      let sellers = 0;
      const names = [];
      for (const addr of Object.keys(eliteSwaps)) {
        const sells = (eliteSwaps[addr].sells || []).filter(s => s.mint === pos.mint && s.ts >= pos.entryTs);
        if (sells.length) { sellers++; if (names.length < 3) names.push(eliteSwaps[addr].label || 'elite'); }
      }
      if (sellers >= 2) reason = `elite exit: ${sellers} elite sellers (${names.join(', ')})`;
    }

    if (!reason) { keep.push(pos); continue; }

    const exitMc = t.mc * (1 - cfg.slippage);
    const proceeds = pos.tokens * t.price * (1 - cfg.slippage);
    const pnl = proceeds - pos.sizeUsd;
    p.cash += proceeds;
    p.cooldowns = { ...(p.cooldowns || {}), [pos.mint]: now };
    const trade = {
      mint: pos.mint, symbol: pos.symbol, name: pos.name,
      entryMc: pos.entryMc, exitMc,
      multiple: pos.sizeUsd > 0 ? proceeds / pos.sizeUsd : 1,
      pnlUsd: pnl,
      holdMs: now - pos.entryTs,
      exitReason: reason,
      entryTs: pos.entryTs, exitTs: now,
      score: pos.score, eliteHit: pos.eliteHit,
    };
    p.closed = [trade, ...(p.closed || [])];
    closed.push(trade);
    floorEmit('risk.exit', {
      mint: pos.mint, symbol: pos.symbol, name: pos.name,
      exitReason: reason, pnlUsd: pnl, multiple: pos.sizeUsd > 0 ? proceeds / pos.sizeUsd : 1,
    });
  }
  p.positions = keep;
  if (closed.length) snapshotEquity(p, priceMap);
  return closed;
}

// ------------------------------------------------------------ equity + stats

export function equityValue(p, priceMap) {
  let v = p.cash || 0;
  for (const pos of (p.positions || [])) {
    const t = priceMap[pos.mint];
    if (t && t.price) v += pos.tokens * t.price;
  }
  return v;
}

export function snapshotEquity(p, priceMap) {
  const v = equityValue(p, priceMap);
  const eq = p.equity || [];
  if (!eq.length || eq[eq.length - 1].v !== v || Date.now() - eq[eq.length - 1].ts > 60000) {
    p.equity = [...eq, { ts: Date.now(), v }].slice(-2000);
  }
}

export function statsFor(p, priceMap) {
  const closed = p.closed || [];
  const wins = closed.filter(c => c.pnlUsd > 0);
  const losses = closed.filter(c => c.pnlUsd <= 0);
  const realized = closed.reduce((s, c) => s + (c.pnlUsd || 0), 0);
  let unrealized = 0;
  for (const pos of (p.positions || [])) {
    const t = priceMap[pos.mint];
    const cur = t && t.price ? pos.tokens * t.price : pos.sizeUsd;
    unrealized += cur - pos.sizeUsd;
  }
  const total = realized + unrealized;
  const avgMult = closed.length ? closed.reduce((s, c) => s + (c.multiple || 1), 0) / closed.length : null;
  return {
    cash: p.cash || 0,
    equity: equityValue(p, priceMap),
    totalPnl: total,
    totalPnlPct: p.bankroll0 ? total / p.bankroll0 : null,
    winRate: closed.length ? wins.length / closed.length : null,
    wins: wins.length, losses: losses.length,
    avgMultiple: avgMult,
    openCount: (p.positions || []).length,
    totalTrades: closed.length,
  };
}
