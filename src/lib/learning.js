// ALPHABOT v3.5 — LEARNING FLOOR: ledgers + adaptive scoring.
// The floor records what it does (kills, trades, creator outcomes) in
// local-only, bounded ledgers, then — only after cold-start minimums —
// nudges score-component weights toward what the journal proves predictive.
// HARD RULES: adaptive weights NEVER override kill-chain hard kills; every
// adaptation is logged with before/after; empty/corrupt ledgers → defaults.
// Fail-open everywhere. Pipeline logic untouched (this module only records
// outcomes and suggests weight nudges).

import { fetchRugReport } from './pumpfun.js';
import { fetchTokens } from './dexscreener.js';

const KILL_KEY = 'alphabot_kill_ledger_v1';
const TRADE_KEY = 'alphabot_trade_journal_v1';
const LEARN_KEY = 'alphabot_learn_state_v1';
const CREATOR_KEY = 'alphabot_creator_ledger_v1'; // shared with research.js
const CAP = 500;
export const MIN_KILLS = 30;    // confirmed kills before any adaptation
export const MIN_TRADES = 10;   // closed trades before any adaptation
const MAX_SHIFT_DAY = 0.15;     // ±15% weight shift per 24h, max
const W_FLOOR = 5, W_CEIL = 40; // hard floor/ceiling per weight
const CONFIRM_BATCH = 3;        // RugCheck re-checks per cycle (slow pass)
const KILL_DEDUP_MS = 30 * 60 * 1000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const loadArr = (k) => { const v = load(k); return Array.isArray(v) ? v : []; };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nicety */ } };
const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : (a || '?'));

// ------------------------------------------------------------ kill ledger
// Every kill logged: { mint, symbol, pass, fam, reason, creator, mc, ts,
// status: 'open'|'confirmed'|'escaped', checkedTs }. Background pass re-checks
// a few per cycle: rugged/dead/dumped/no-pump-48h → CONFIRMED; 3x+ since
// kill → ESCAPED (the kill was wrong — honest data).
export function reasonFamily(reason) {
  const r = String(reason || '');
  if (/^age /.test(r)) return 'age';
  if (/authority/i.test(r)) return 'authority';
  if (/^liq /.test(r)) return 'liq';
  if (/^vol24h /.test(r)) return 'vol';
  if (/^MC /.test(r)) return 'mc-band';
  if (/^buys24h/.test(r)) return 'buys';
  if (/sells24h/.test(r)) return 'sells';
  if (/trade counts unknown/.test(r)) return 'trade-unknown';
  if (/RUGGED/.test(r)) return 'rugged';
  if (/^dev holds/.test(r)) return 'dev%';
  if (/^top holder/.test(r)) return 'top%';
  if (/^top-10/.test(r)) return 'top10%';
  if (/^holders /.test(r)) return 'holders';
  if (/dossier unavailable/.test(r)) return 'dossier-unknown';
  return 'other';
}

export function logKill(t, killPass, killReason) {
  try {
    const L = loadArr(KILL_KEY);
    const now = Date.now();
    // dedupe: same mint killed recently → don't double-log
    if (L.some(e => e.mint === t.address && now - e.ts < KILL_DEDUP_MS)) return;
    L.push({
      mint: t.address, symbol: t.symbol || '???', pass: killPass,
      fam: reasonFamily(killReason), reason: String(killReason || '').slice(0, 120),
      creator: t.creator || null, mc: t.mc || null, ts: now,
      status: 'open', checkedTs: 0,
    });
    while (L.length > CAP) L.shift();
    save(KILL_KEY, L);
  } catch { /* fail-open */ }
}

// Slow background pass: confirm a few open kills per cycle. Returns count checked.
export async function confirmKills() {
  try {
    const L = loadArr(KILL_KEY);
    const now = Date.now();
    const open = L.filter(e => e.status === 'open' && now - (e.checkedTs || 0) > 6 * 3600e3)
      .sort((a, b) => a.ts - b.ts).slice(0, CONFIRM_BATCH);
    if (!open.length) return 0;
    let pairs = {};
    try { pairs = await fetchTokens(open.map(e => e.mint)); } catch { /* price check optional */ }
    for (const e of open) {
      e.checkedTs = now;
      let verdict = null;
      try {
        const d = await fetchRugReport(e.mint);
        if (d && d.rugged) verdict = 'confirmed';
      } catch { /* dossier check optional */ }
      if (!verdict) {
        const pair = pairs[e.mint];
        const mc = pair ? (+(pair.marketCap || 0) || +(pair.fdv || 0) || null) : null;
        const ageH = (now - e.ts) / 3600e3;
        if (mc == null) verdict = 'confirmed';                        // untradable
        else if (e.mc > 0 && mc < e.mc * 0.5) verdict = 'confirmed';   // dumped
        else if (e.mc > 0 && mc > e.mc * 3) verdict = 'escaped';       // kill was wrong
        else if (ageH > 48 && mc < e.mc * 1.5) verdict = 'confirmed';  // never pumped
      }
      if (verdict) {
        e.status = verdict;
        if (verdict === 'confirmed') noteCreatorOutcome(e.creator, 'rugged');
      }
    }
    save(KILL_KEY, L);
    return open.length;
  } catch { return 0; }
}

export function killHitRates() {
  try {
    const L = loadArr(KILL_KEY);
    const by = {};
    for (const e of L) {
      if (e.status !== 'confirmed' && e.status !== 'escaped') continue;
      const b = by[e.fam] || (by[e.fam] = { fam: e.fam, confirmed: 0, n: 0 });
      b.n++;
      if (e.status === 'confirmed') b.confirmed++;
    }
    return Object.values(by)
      .map(b => ({ ...b, rate: b.n ? b.confirmed / b.n : 0 }))
      .sort((a, b) => b.n - a.n);
  } catch { return []; }
}

// ---------------------------------------------------------- trade journal
// Entry snapshot at paper BUY; outcome appended at exit. Correlates score
// components with realized P&L.
export function logTradeEntry(snap) {
  try {
    const J = loadArr(TRADE_KEY);
    J.push({ ...snap, entryTs: Date.now(), exitTs: null, pnlPct: null });
    while (J.length > CAP) J.shift();
    save(TRADE_KEY, J);
  } catch { /* fail-open */ }
}

export function logTradeExit(trade) {
  try {
    const J = loadArr(TRADE_KEY);
    const pnlPct = trade.multiple != null ? (trade.multiple - 1) * 100 : null;
    // match latest open entry for this mint (entryTs within 1h if given)
    let best = null;
    for (const e of J) {
      if (e.exitTs != null || e.mint !== trade.mint) continue;
      if (trade.entryTs && e.entryTs && Math.abs(e.entryTs - trade.entryTs) > 3600e3) continue;
      if (!best || e.entryTs > best.entryTs) best = e;
    }
    if (best) {
      best.exitTs = Date.now();
      best.exitMc = trade.exitMc ?? null;
      best.pnlPct = pnlPct;
      best.exitReason = trade.exitReason || null;
      best.holdMs = trade.holdMs ?? null;
      if (best.creator && pnlPct != null && pnlPct >= 100) noteCreatorOutcome(best.creator, 'moon2x');
    }
    save(TRADE_KEY, J);
  } catch { /* fail-open */ }
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (!(dx > 0 && dy > 0)) return null;
  return num / Math.sqrt(dx * dy);
}

// Per-component Pearson r vs realized P&L% over closed trades.
export function componentCorrelations() {
  try {
    const closed = loadArr(TRADE_KEY).filter(t => t.exitTs != null && t.pnlPct != null && t.breakdown);
    const comps = ['liquidity', 'holders', 'buyPressure', 'curve', 'age', 'momentum'];
    return comps.map(c => {
      const pairs = closed
        .filter(t => t.breakdown[c] != null && isFinite(t.breakdown[c]))
        .map(t => [t.breakdown[c], t.pnlPct]);
      const r = pairs.length >= 4
        ? pearson(pairs.map(p => p[0]), pairs.map(p => p[1])) : null;
      return { comp: c, r, n: pairs.length };
    });
  } catch { return []; }
}

export function journalStats() {
  try {
    const J = loadArr(TRADE_KEY);
    const closed = J.filter(t => t.exitTs != null && t.pnlPct != null);
    const wins = closed.filter(t => t.pnlPct > 0);
    const avg = closed.length ? closed.reduce((a, t) => a + t.pnlPct, 0) / closed.length : null;
    const best = closed.length ? closed.reduce((a, t) => (t.pnlPct > (a.pnlPct ?? -Infinity) ? t : a), {}) : null;
    return {
      entries: J.length, closed: closed.length,
      wins: wins.length,
      winRate: closed.length ? wins.length / closed.length : null,
      avgPnl: avg, best,
    };
  } catch { return { entries: 0, closed: 0, wins: 0, winRate: null, avgPnl: null, best: null }; }
}

// ------------------------------------------------------- creator outcomes
function noteCreatorOutcome(creator, kind) {
  if (!creator) return;
  try {
    const l = load(CREATOR_KEY);
    const e = l[creator] || { launches: 0, seen: {} };
    e[kind === 'rugged' ? 'rugged' : 'moon2x'] = (e[kind === 'rugged' ? 'rugged' : 'moon2x'] || 0) + 1;
    l[creator] = e;
    save(CREATOR_KEY, l);
  } catch { /* fail-open */ }
}

export function creatorOutcome(creator) {
  try {
    const e = load(CREATOR_KEY)[creator];
    if (!e) return null;
    return { launches: e.launches || 0, rugged: e.rugged || 0, moon2x: e.moon2x || 0 };
  } catch { return null; }
}

// ------------------------------------------------------- adaptive scoring
// getAdaptiveWeights(defaults) -> { weights, adapted, collecting, stats, log }.
// Cold start (below minimums) → defaults, adapted=false. Otherwise nudges
// each weight toward its journal-proven target, bounded ±15%/24h, hard
// floor/ceiling. Never touches kill logic — score weights only.
function loadLearn() { return load(LEARN_KEY); }

export function getAdaptiveWeights(defaults) {
  const fresh = { weights: { ...defaults }, adapted: false, collecting: true, stats: { kills: 0, trades: 0 }, log: [] };
  try {
    const st = loadLearn();
    const weights = { ...defaults, ...(st.weights || {}) };
    const kills = loadArr(KILL_KEY).filter(e => e.status === 'confirmed').length;
    const trades = loadArr(TRADE_KEY).filter(t => t.exitTs != null).length;
    const out = { weights, adapted: false, collecting: true, stats: { kills, trades }, log: st.adaptLog || [] };
    out.adapted = Object.keys(defaults).some(k => Math.abs((weights[k] ?? defaults[k]) - defaults[k]) > 0.01);
    if (kills < MIN_KILLS || trades < MIN_TRADES) return out; // cold start: nothing
    out.collecting = false;
    // At most one adaptation per 24h.
    if (Date.now() - (st.lastAdaptTs || 0) < 24 * 3600e3) return out;
    const corrs = componentCorrelations().filter(c => c.r != null && c.n >= MIN_TRADES);
    if (!corrs.length) return out;
    const before = { ...weights };
    let changed = false;
    for (const { comp, r } of corrs) {
      if (!(comp in defaults)) continue;
      const target = clamp(defaults[comp] * (1 + clamp(r, -0.5, 0.5) * 0.6), W_FLOOR, W_CEIL);
      const cur = weights[comp];
      const maxDelta = cur * MAX_SHIFT_DAY;
      const next = Math.round(clamp(target, cur - maxDelta, cur + maxDelta) * 10) / 10;
      if (Math.abs(next - cur) > 0.01) { weights[comp] = next; changed = true; }
    }
    if (changed) {
      out.weights = weights;
      out.adapted = true;
      out.log = [{
        ts: Date.now(), before, after: { ...weights },
        nTrades: trades, nKills: kills,
        note: 'weights nudged toward journal-proven components (±15%/day cap)',
      }, ...(st.adaptLog || [])].slice(0, 50);
      save(LEARN_KEY, { weights, lastAdaptTs: Date.now(), adaptLog: out.log });
    }
    return out;
  } catch {
    return fresh;
  }
}

// ------------------------------------------------------- judge context
// Compact ledger lines prepended to the AI judge prompt. Judgment only.
export function getJudgeContext(t) {
  try {
    const lines = [];
    if (t.creator) {
      const c = creatorOutcome(t.creator);
      if (c && (c.launches || c.rugged || c.moon2x)) {
        lines.push(`creator ${short(t.creator)}: ${c.launches} launches, ${c.rugged} rugged, ${c.moon2x} 2x+ (this desk's local history)`);
      }
    }
    for (const r of killHitRates().filter(r => r.n >= 5).slice(0, 3)) {
      lines.push(`kill reason '${r.fam}' confirmed ${(r.rate * 100).toFixed(0)}% (n=${r.n})`);
    }
    for (const c of componentCorrelations().filter(c => c.r != null && c.n >= MIN_TRADES)) {
      lines.push(`score component '${c.comp}' correlates ${c.r >= 0 ? '+' : ''}${c.r.toFixed(2)} with realized P&L (n=${c.n})`);
    }
    if (!lines.length) return '';
    return 'FLOOR LEDGERS (this desk\'s own observed history — treat as weak priors, judge the token on its merits):\n'
      + lines.map(l => '- ' + l).join('\n');
  } catch { return ''; }
}

// ------------------------------------------------------- brain + reset
export function readJournal() {
  try { return loadArr(TRADE_KEY); } catch { return []; }
}

export function getBrainStats() {
  try {
    const js = journalStats();
    const rates = killHitRates();
    const corrs = componentCorrelations();
    const confirmedKills = loadArr(KILL_KEY).filter(e => e.status === 'confirmed').length;
    const totalKills = loadArr(KILL_KEY).length;
    return {
      ...js, confirmedKills, totalKills, hitRates: rates, correlations: corrs,
      collecting: js.closed < MIN_TRADES || confirmedKills < MIN_KILLS,
      minKills: MIN_KILLS, minTrades: MIN_TRADES,
    };
  } catch {
    return { entries: 0, closed: 0, wins: 0, winRate: null, avgPnl: null, best: null, confirmedKills: 0, totalKills: 0, hitRates: [], correlations: [], collecting: true, minKills: MIN_KILLS, minTrades: MIN_TRADES };
  }
}

// "Reset learning" — wipes ledgers + adaptive weights + adapt log, and
// clears creator outcome counters (launch counts kept: that's research data).
export function resetLearning() {
  try {
    localStorage.removeItem(KILL_KEY);
    localStorage.removeItem(TRADE_KEY);
    localStorage.removeItem(LEARN_KEY);
    const l = load(CREATOR_KEY);
    for (const k of Object.keys(l)) { delete l[k].rugged; delete l[k].moon2x; }
    save(CREATOR_KEY, l);
    return true;
  } catch { return false; }
}
