// ALPHABOT v3.1 — FLOOR COMMAND CENTER. Visualization layer ONLY.
// Layout: tight header → seat strip → THE FLOOR (isometric room) →
// bottom telemetry → dense LIVE ACTIVITY. Backend/pipeline/event bus:
// ZERO changes. Subscribe-only. Numbers are real or real idle — never faked.

import { useEffect, useRef, useState } from 'react';
import { subscribeFloor } from '../lib/floorBus.js';
import { subscribeResearch } from '../lib/research.js';
import { SCORE_WEIGHTS } from '../lib/pipeline.js';
import { fmtUsd, fmtClock } from '../lib/paper.js';
import MiniBrowser from './MiniBrowser.jsx';
import FeedsPanel from './FeedsPanel.jsx';
import BrainPanel from './BrainPanel.jsx';
import { useDeskStats, SeatStrip, TheFloor, BottomPanels } from './Floor.jsx';

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

// ------------------------------------------------------------ header (tight)
function CommandHeader({ stats, equityArr, openCount, scanned, signalCount, now, paused, onTogglePaused, onOpenSettings, flowOn }) {
  const today = todayPnl(equityArr, now);
  const tCls = !today ? '' : today.usd >= 0 ? 'grn' : 'red';
  return (
    <header className="cc-hdr">
      <div className="cc-top">
        <div className="cc-word">ALPHABOT</div>
        <div className="cc-hero-inline">
          <span className="cc-hero-val2">{fmtUsd(stats.equity)}</span>
          <span className={'cc-hero-today2 ' + tCls}>
            {today == null ? '' : `${today.usd >= 0 ? '+' : ''}${fmtUsd(today.usd)} (${(today.pct * 100).toFixed(1)}%)`}
          </span>
          <span className="cc-sub2">{openCount} OPEN · {scanned} SCANNED · {signalCount} SIGNALS</span>
        </div>
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
    </header>
  );
}

// ------------------------------------------------------------ live activity
// Compact dense event stream. TAP a row → expands full detail.
const BRK_LABELS = { liquidity: 'LIQ', holders: 'HOLD', buyPressure: 'BUY', curve: 'CURVE', age: 'AGE', momentum: 'MOM' };

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
        {s.adapted && <span className="adapt-tag" title="score weights adapted from the trade journal">adapted</span>}
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
      {!killed && s.calloutLine && <div className="la-drow dim">📣 {s.calloutLine}</div>}
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
    setItems(prev => [{ ...it, id, ts: Date.now() }, ...prev].slice(0, 80));
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
  const d = useDeskStats();
  const signals = portfolio.signals || [];
  const scanned = Math.max(counts.scanned, d.scanned);
  return (
    <>
      <CommandHeader
        stats={stats}
        equityArr={portfolio.equity}
        openCount={stats.openCount}
        scanned={scanned}
        signalCount={counts.signals}
        now={now}
        paused={paused}
        onTogglePaused={onTogglePaused}
        onOpenSettings={onOpenSettings}
        flowOn={flowOn}
      />
      <main className="wrap cc-main">
        <SeatStrip d={d} openCount={stats.openCount} />
        <TheFloor
          d={d}
          equityArr={portfolio.equity}
          bankroll0={portfolio.bankroll0}
          positions={portfolio.positions}
          priceMap={priceMap}
          stats={stats}
          now={now}
        />
        <BottomPanels d={d} equityArr={portfolio.equity} bankroll0={portfolio.bankroll0} />
        <FeedsPanel />
        <BrainPanel />
        <LiveActivity signals={signals} onStats={setCounts} />
      </main>
    </>
  );
}
