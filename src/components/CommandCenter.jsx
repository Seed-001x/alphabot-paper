// ALPHABOT v3.0 — COMMAND CENTER. Visualization layer ONLY.
// Subscribes to existing buses (floorBus, research). ZERO pipeline changes.
// Layout: clean header (portfolio hero) → BOT WORLD centerpiece → stat
// tiles → LIVE ACTIVITY stream (tap to expand detail) → positions/trades.
// RESTRAINT (per calibration): one glow at a time, few motions, lots of
// negative space. Aliveness from agents moving + chips flowing, nothing else.

import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeFloor } from '../lib/floorBus.js';
import { subscribeResearch } from '../lib/research.js';
import { SCORE_WEIGHTS } from '../lib/pipeline.js';
import { fmtUsd, fmtPct, fmtClock, fmtDur } from '../lib/paper.js';
import MiniBrowser from './MiniBrowser.jsx';
import Equity from './Equity.jsx';

const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : (a || '?'));

function todayPnl(equityArr, nowMs) {
  const eq = equityArr || [];
  if (eq.length < 2) return null;
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  const t0 = d.getTime();
  let first = null;
  for (const p of eq) { if (p.ts >= t0) { first = p; break; } }
  const last = eq[eq.length - 1];
  if (!first || !last) return null;
  const usd = last.v - first.v;
  return { usd, pct: first.v ? usd / first.v : 0 };
}

// ------------------------------------------------------------ robot
// Same SVG design language as the Agent Floor bots.
function Robot({ color, small }) {
  return (
    <svg viewBox="0 0 60 78" width={small ? 30 : 40} height={small ? 39 : 52} className="bw-svg">
      <line x1="30" y1="12" x2="30" y2="4" stroke={color} strokeWidth="2" />
      <circle cx="30" cy="4" r="2.6" fill={color} className="bw-ant" />
      <rect x="14" y="12" width="32" height="22" rx="7" fill="#0a0a10" stroke={color} strokeWidth="2" />
      <circle cx="24" cy="23" r="3" fill={color} className="bw-eye" />
      <circle cx="36" cy="23" r="3" fill={color} className="bw-eye" />
      <rect x="18" y="38" width="24" height="22" rx="6" fill="#0a0a10" stroke={color} strokeWidth="2" />
      <circle cx="30" cy="49" r="4" fill="none" stroke={color} strokeWidth="2" />
      <line x1="18" y1="44" x2="10" y2="52" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="42" y1="44" x2="50" y2="52" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="24" y1="60" x2="24" y2="72" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="36" y1="60" x2="36" y2="72" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ------------------------------------------------------------ header
function CommandHeader({ stats, equityArr, bankroll0, openCount, scanned, signalCount, now, paused, onTogglePaused, onOpenSettings, flowOn }) {
  const [eqOpen, setEqOpen] = useState(false);
  const today = todayPnl(equityArr, now);
  const tCls = !today ? '' : today.usd >= 0 ? 'grn' : 'red';
  return (
    <header className="cc-hdr">
      <div className="cc-top">
        <div className="cc-word">ALPHABOT</div>
        <div className="cc-right">
          <span className={'cc-live' + (paused ? ' paused' : '')}>
            <i className="cc-pulse" />{paused ? 'PAUSED' : 'ONLINE'}
          </span>
          {flowOn && <span className="cc-flowtag" title="smart-flow watcher active">◈</span>}
          <span className="cc-clock">{fmtClock(now)}</span>
          <button className="cc-btn" onClick={onTogglePaused} title={paused ? 'Resume' : 'Pause'}>{paused ? '▶' : '❚❚'}</button>
          <button className="cc-btn" onClick={onOpenSettings} title="Settings">⚙</button>
        </div>
      </div>
      <div className="cc-hero" onClick={() => setEqOpen(o => !o)} title="tap for equity curve">
        <div className="cc-hero-label">Portfolio · paper</div>
        <div className="cc-hero-val">{fmtUsd(stats.equity)}</div>
        <div className={'cc-hero-today ' + tCls}>
          {today == null ? '— today'
            : `${today.usd >= 0 ? '+' : ''}${fmtUsd(today.usd)} TODAY (${(today.pct * 100).toFixed(1)}%)`}
        </div>
      </div>
      {eqOpen && (
        <div className="cc-eq">
          <Equity points={equityArr} bankroll0={bankroll0} />
        </div>
      )}
      <div className="cc-sub">{openCount} OPEN · {scanned} SCANNED · {signalCount} SIGNALS</div>
    </header>
  );
}

// ------------------------------------------------------------ bot world
// ONE living environment: 4 stations (SCANNER → READER → ANALYZER → TRADER).
// Two agents glide between stations on real floorBus events; token chips
// flow along the line. Only the active station glows — restraint.
const ST = [
  { id: 'scanner', name: 'SCANNER', glyph: '◉' },
  { id: 'reader', name: 'READER', glyph: '▤' },
  { id: 'analyzer', name: 'ANALYZER', glyph: '◈' },
  { id: 'trader', name: 'TRADER', glyph: '⚡' },
];
const STX = [10, 37, 63, 90]; // % left positions
const EV_ST = {
  'cycle.start': 0, 'scan.token': 0, 'flow.inject': 0,
  'research.start': 1, 'bread-start': 1, 'bread-done': 1, 'bread-fail': 1,
  'hunt.start': 1, 'hunt.done': 1,
  'vet.scored': 2, 'dossier.ready': 2, 'ledger.check': 2, 'judge.done': 2,
  'research.done': 2, 'vet.kill': 2,
  'trade.enter': 3, 'trade.skip': 3, 'risk.exit': 3,
};
const ACTIVE_MS = 4500;
const MAX_CHIPS = 10;

function BotWorld() {
  const [worker, setWorker] = useState(0);
  const [scout, setScout] = useState(2);
  const [active, setActive] = useState({ st: -1, ts: 0, exit: false });
  const [chips, setChips] = useState([]);
  const [now, setNow] = useState(Date.now());
  const chipTimers = useRef(new Map());

  const advanceChip = (mint, toSt) => {
    setChips(prev => prev.map(c => c.mint === mint && c.state === 'run' ? { ...c, st: Math.max(c.st, toSt) } : c));
  };
  const finishChip = (mint, ok) => {
    setChips(prev => prev.map(c => c.mint === mint ? { ...c, st: 3, state: ok ? 'done' : 'gone' } : c));
    const t = setTimeout(() => {
      setChips(prev => prev.filter(c => c.mint !== mint));
      chipTimers.current.delete(mint);
    }, ok ? 2000 : 900);
    chipTimers.current.set(mint, t);
  };
  const dropChip = (mint) => {
    setChips(prev => prev.map(c => c.mint === mint ? { ...c, state: 'dying' } : c));
    const t = setTimeout(() => {
      setChips(prev => prev.filter(c => c.mint !== mint));
      chipTimers.current.delete(mint);
    }, 1400);
    chipTimers.current.set(mint, t);
  };
  const addChip = (mint, symbol, flow) => {
    setChips(prev => {
      if (prev.some(c => c.mint === mint)) return prev;
      const chip = { mint, symbol: (symbol || '???').slice(0, 6), st: 0, state: 'run', flow: !!flow };
      return [...prev, chip].slice(-MAX_CHIPS);
    });
  };

  useEffect(() => {
    const onEv = (ev) => {
      const st = EV_ST[ev.type];
      if (st != null) {
        setWorker(st);
        setActive({ st, ts: Date.now(), exit: ev.type === 'risk.exit' });
      }
      const mint = ev.mint;
      switch (ev.type) {
        case 'scan.token': if (mint) addChip(mint, ev.symbol, ev.flow); break;
        case 'flow.inject': if (mint) addChip(mint, ev.symbol, true); break;
        case 'research.start': case 'bread-start': case 'hunt.start':
          if (mint) advanceChip(mint, 1); break;
        case 'bread-done': case 'bread-fail': case 'hunt.done':
        case 'vet.scored': case 'dossier.ready': case 'judge.done': case 'research.done':
          if (mint) advanceChip(mint, 2); break;
        case 'vet.kill': if (mint) dropChip(mint); break;
        case 'trade.enter': if (mint) finishChip(mint, true); break;
        case 'trade.skip': if (mint) finishChip(mint, false); break;
        default: break;
      }
    };
    const u1 = subscribeFloor(onEv);
    const u2 = subscribeResearch((ev) => {
      if (ev.type === 'bread-start' || ev.type === 'bread-done' || ev.type === 'bread-fail') onEv({ type: ev.type, mint: ev.mint });
    });
    // Scout drift: slow ambient patrol, never on the worker's station.
    const drift = setInterval(() => {
      setScout(prev => {
        let n = Math.floor(Math.random() * 4);
        if (n === prev) n = (n + 1) % 4;
        return n;
      });
    }, 9000);
    const tickt = setInterval(() => setNow(Date.now()), 2000);
    return () => { u1(); u2(); clearInterval(drift); clearInterval(tickt); };
  }, []);

  const activeOn = now - active.ts < ACTIVE_MS ? active.st : -1;

  return (
    <section className="bw">
      <div className="bw-head">
        <span className="bw-title">◈ BOT WORLD</span>
        <span className="bw-live"><i className="cc-pulse" />live</span>
      </div>
      <div className="bw-scene">
        {ST.map((s, i) => (
          <div key={s.id} className={'bw-st' + (activeOn === i ? ' on' : '') + (activeOn === i && active.exit ? ' exit' : '')} style={{ left: STX[i] + '%' }}>
            <div className="bw-console"><span>{s.glyph}</span></div>
            <div className="bw-plinth" />
            <div className="bw-name">{s.name}</div>
          </div>
        ))}
        <div className="bw-agent" style={{ left: STX[worker] + '%' }}>
          <Robot color="#ff2bd6" />
        </div>
        <div className="bw-agent scout" style={{ left: STX[scout] + '%' }}>
          <Robot color="#8f7bb8" small />
        </div>
        {chips.map(c => (
          <div
            key={c.mint}
            className={'bw-chip' + (c.state === 'dying' ? ' dying' : c.state === 'done' ? ' done' : c.state === 'gone' ? ' gone' : '') + (c.flow ? ' flow' : '')}
            style={{ left: STX[c.st] + '%' }}
          >
            {c.state === 'dying' ? '✕' : c.symbol}
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ stat tiles
function StatTiles({ scanned, pnlUsd, pnlPct, signalCount }) {
  const pCls = pnlUsd == null ? '' : pnlUsd >= 0 ? 'grn' : 'red';
  return (
    <section className="tiles">
      <div className="tile">
        <div className="t-val">{scanned}</div>
        <div className="t-label">CRAWLER · scanned</div>
      </div>
      <div className="tile">
        <div className={'t-val ' + pCls}>{pnlUsd == null ? '—' : (pnlUsd >= 0 ? '+' : '') + fmtUsd(pnlUsd)}</div>
        <div className="t-label">TRADES · paper P&amp;L</div>
      </div>
      <div className="tile">
        <div className="t-val">{signalCount}</div>
        <div className="t-label">SIGNALS · entries</div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ live activity
// Compact one-line event stream. TAP a row → expands the full detail
// (signal dossier, mini-browser read, research notes, holder table…).
// Simple by default, deep on tap. Subscribes only — never touches logic.
const BRK_LABELS = { liquidity: 'LIQ', holders: 'HOLD', buyPressure: 'BUY', curve: 'CURVE', age: 'AGE' };

function SignalDetail({ mint, signals }) {
  const s = (signals || []).filter(x => x.mint === mint).sort((a, b) => b.ts - a.ts)[0];
  if (!s) return <div className="la-dempty">signal not logged yet — detail lands with the feed</div>;
  const killed = s.verdict === 'KILLED';
  return (
    <div className="la-sig">
      <div className="la-drow">
        <span className={'badge ' + (killed ? 'kill' : s.taken ? 'enter' : 'score')}>
          {killed ? 'KILLED' : s.taken ? 'ENTER' : 'SCORED'}
        </span>
        <b>{s.symbol}</b>
        {!killed && s.score != null && <span className="score-num">{s.score}</span>}
        <span className="dim">{short(s.mint)}</span>
      </div>
      {s.reason && <div className="la-drow dim">{s.reason}</div>}
      {!killed && s.breakdown && (
        <div className="la-brk">
          {Object.keys(SCORE_WEIGHTS).map(k => {
            const v = s.breakdown[k];
            return <span key={k} className="la-b">{BRK_LABELS[k]} <b>{v == null ? '?' : Math.round(v)}</b></span>;
          })}
        </div>
      )}
      {!killed && s.researchLine && <div className="la-drow dim">⟁ research {s.researchMod >= 0 ? '+' : ''}{s.researchMod} — {s.researchLine}</div>}
      {!killed && s.judgeLine && s.judgeLine !== 'no key' && <div className="la-drow dim">⚖ judge {s.judgeMod >= 0 ? '+' : ''}{s.judgeMod} — {s.judgeLine}</div>}
      {s.dossier && s.dossier.topPct != null && (
        <div className="la-drow dim">top {s.dossier.topPct.toFixed(1)}% · top10 {s.dossier.top10Pct != null ? s.dossier.top10Pct.toFixed(1) : '?'}%</div>
      )}
      {s.mint && <div className="la-drow"><a href={`https://dexscreener.com/solana/${s.mint}`} target="_blank" rel="noreferrer">open chart ↗</a></div>}
    </div>
  );
}

function DossierDetail({ d }) {
  if (!d) return <div className="la-dempty">no dossier captured</div>;
  const row = (k, v, bad) => (
    <div className="la-drow" key={k}><span className="dim">{k}</span><b className={bad ? 'red' : ''}>{v}</b></div>
  );
  return (
    <div>
      {row('dev share', d.devPct == null ? '?' : d.devPct.toFixed(1) + '%', d.devPct > 25)}
      {row('top holder', d.topPct == null ? '?' : d.topPct.toFixed(1) + '%', d.topPct > 35)}
      {row('top 10', d.top10Pct == null ? '?' : d.top10Pct.toFixed(1) + '%', d.top10Pct > 70)}
      {row('holders', d.holderCount ?? '?')}
      {row('rugged flag', d.rugged ? 'YES' : 'no', !!d.rugged)}
      {(d.risks || []).length > 0 && <div className="la-drow red">⚠ {(d.risks || []).join(' · ')}</div>}
    </div>
  );
}

function DetailBody({ item, signals }) {
  switch (item.detail) {
    case 'reader':
      return <MiniBrowser focusMint={item.mint} />;
    case 'signal':
      return <SignalDetail mint={item.mint} signals={signals} />;
    case 'research':
      return (
        <div>
          <div className="la-drow"><b>{item.symbol}</b> <span className={item.modifier >= 0 ? 'grn' : 'red'}>{item.modifier >= 0 ? '+' : ''}{item.modifier}</span></div>
          <div className="la-drow dim">{item.line2 || item.line}</div>
        </div>
      );
    case 'dossier':
      return <DossierDetail d={item.dossier} />;
    case 'judge':
      return (
        <div>
          <div className="la-drow"><b>⚖ JUDGE {item.legitimacy}/10</b> <span className="dim">· {item.symbol}</span></div>
          {item.one_liner && <div className="la-drow">“{item.one_liner}”</div>}
          {item.risk_flags && item.risk_flags.length > 0 && <div className="la-drow red">⚠ {item.risk_flags.join(' · ')}</div>}
        </div>
      );
    case 'hunt':
      return <div className="la-drow dim">{item.line}</div>;
    case 'exit':
      return (
        <div>
          <div className="la-drow"><b>{item.symbol}</b> <span className={item.pnlUsd >= 0 ? 'grn' : 'red'}>{item.pnlUsd >= 0 ? '+' : ''}{fmtUsd(item.pnlUsd)}</span></div>
          <div className="la-drow dim">{item.exitReason}</div>
        </div>
      );
    default:
      return null;
  }
}

let laId = 0;

function LiveActivity({ signals, onStats }) {
  const [items, setItems] = useState([]);
  const [openId, setOpenId] = useState(null);
  const scanRef = useRef({ cid: null, n: 0 });
  const counts = useRef({ scanned: 0, signals: 0 });

  const push = (it) => {
    const id = ++laId;
    setItems(prev => [{ ...it, id, ts: Date.now() }, ...prev].slice(0, 60));
    return id;
  };
  const bump = (k) => {
    counts.current[k] += 1;
    if (onStats) onStats({ ...counts.current });
  };

  useEffect(() => {
    const u1 = subscribeFloor((ev) => {
      const sym = ev.symbol || '???';
      switch (ev.type) {
        case 'cycle.start': {
          const cid = push({ kind: 'crawl', dot: 'cyn', line: 'scan cycle started', detail: null });
          scanRef.current = { cid, n: 0 };
          break;
        }
        case 'scan.token': {
          const s = scanRef.current;
          s.n += 1;
          bump('scanned');
          if (s.cid != null) {
            const n = s.n;
            setItems(prev => prev.map(it => it.id === s.cid ? { ...it, line: `scanned ${n} token${n === 1 ? '' : 's'}` } : it));
          }
          break;
        }
        case 'vet.kill':
          push({ kind: 'kill', dot: 'red', line: `${sym} · ${ev.killReason || 'killed'}`, mint: ev.mint, symbol: sym, detail: 'signal' });
          break;
        case 'vet.scored':
          push({ kind: 'analyzer', dot: 'amb', line: `${sym} scored ${ev.score ?? '?'}`, mint: ev.mint, symbol: sym, detail: 'signal' });
          break;
        case 'research.done':
          push({ kind: 'analyzer', dot: 'grn', line: `${sym} research ${ev.modifier >= 0 ? '+' : ''}${ev.modifier ?? 0}`, mint: ev.mint, symbol: sym, detail: 'research', modifier: ev.modifier ?? 0, line2: ev.line });
          break;
        case 'dossier.ready':
          push({ kind: 'analyzer', dot: 'amb', line: `${sym} dossier scanned`, mint: ev.mint, symbol: sym, detail: 'dossier', dossier: ev });
          break;
        case 'judge.done':
          push({ kind: 'analyzer', dot: 'mag', line: `judge · ${sym} ${ev.legitimacy ?? '?'}/10`, mint: ev.mint, symbol: sym, detail: 'judge', legitimacy: ev.legitimacy, one_liner: ev.one_liner, risk_flags: ev.risk_flags });
          break;
        case 'hunt.done':
          if (ev.found) push({ kind: 'reader', dot: 'amb', line: `hunt · ${ev.line || sym}`, mint: ev.mint, symbol: sym, detail: 'hunt', line2: ev.line });
          break;
        case 'trade.enter':
          bump('signals');
          push({ kind: 'signal', dot: 'grn', line: `${sym} → paper BUY`, mint: ev.mint, symbol: sym, detail: 'signal' });
          break;
        case 'trade.skip':
          push({ kind: 'dim', dot: '', line: `${sym} skipped`, mint: ev.mint, symbol: sym, detail: 'signal' });
          break;
        case 'risk.exit':
          push({ kind: 'exit', dot: 'red', line: `${sym} exit`, mint: ev.mint, symbol: sym, detail: 'exit', exitReason: ev.exitReason, pnlUsd: ev.pnlUsd });
          break;
        case 'flow.inject':
          push({ kind: 'flow', dot: 'mag', line: `smart flow → coin entered DD`, mint: ev.mint, symbol: sym, detail: 'signal' });
          break;
        default: break;
      }
    });
    const u2 = subscribeResearch((ev) => {
      if (ev.type === 'bread-start') {
        push({ kind: 'reader', dot: 'cyn', line: `reading ${ev.domain || 'page'}…`, mint: ev.mint, symbol: ev.symbol || '???', detail: 'reader' });
      } else if (ev.type === 'bread-done') {
        push({ kind: 'reader', dot: 'grn', line: `read ${ev.domain || 'page'} · ${ev.verdict || 'done'}`, mint: ev.mint, symbol: ev.symbol || '???', detail: 'reader' });
      }
    });
    return () => { u1(); u2(); };
  }, []);

  return (
    <section className="la">
      <div className="la-head"><span className="la-title">◈ LIVE ACTIVITY</span><span className="la-hint">tap a row for detail</span></div>
      <div className="la-list">
        {items.length === 0 && <div className="la-empty">desk is warming up — events land here</div>}
        {items.map(it => {
          const open = openId === it.id;
          return (
            <div key={it.id}>
              <div className={'la-row' + (it.detail ? ' tappable' : '')} onClick={() => it.detail && setOpenId(open ? null : it.id)}>
                <span className="la-ts">{fmtClock(it.ts)}</span>
                {it.dot && <span className={'la-dot ' + it.dot} />}
                <span className="la-line">{it.line}</span>
                {it.detail && <span className="la-caret">{open ? '▾' : '▸'}</span>}
              </div>
              {open && it.detail && (
                <div className="la-detail">
                  <DetailBody item={it} signals={signals} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ command center
export default function CommandCenter({ portfolio, priceMap, stats, now, paused, onTogglePaused, onOpenSettings, flowOn }) {
  const [counts, setCounts] = useState({ scanned: 0, signals: 0 });
  const signals = portfolio.signals || [];
  return (
    <>
      <CommandHeader
        stats={stats}
        equityArr={portfolio.equity}
        bankroll0={portfolio.bankroll0}
        openCount={stats.openCount}
        scanned={counts.scanned}
        signalCount={counts.signals}
        now={now}
        paused={paused}
        onTogglePaused={onTogglePaused}
        onOpenSettings={onOpenSettings}
        flowOn={flowOn}
      />
      <main className="wrap cc-main">
        <BotWorld />
        <StatTiles scanned={counts.scanned} pnlUsd={stats.totalPnl} pnlPct={stats.totalPnlPct} signalCount={counts.signals} />
        <LiveActivity signals={signals} onStats={setCounts} />
      </main>
    </>
  );
}
