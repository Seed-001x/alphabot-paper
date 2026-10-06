// v3.5 — BRAIN panel. What the floor has learned, from real ledgers only.
// Kill hit-rates, per-component win correlations, adaptive weight state.
// "collecting data" until cold-start minimums (30 confirmed kills, 10 closed
// trades). Denser command-center styling, small technical type.
import { useEffect, useState } from 'react';
import { getBrainStats, getAdaptiveWeights, MIN_KILLS, MIN_TRADES } from '../lib/learning.js';
import { getExitRules, EXIT_MIN_TRADES } from '../lib/exits.js';
import { SCORE_WEIGHTS } from '../lib/pipeline.js';
import { loadConfig } from '../lib/config.js';
import { fmtUsd } from '../lib/paper.js';

const COMP_LABELS = { liquidity: 'LIQ', holders: 'HOLD', buyPressure: 'BUY', curve: 'CURVE', age: 'AGE', momentum: 'MOM' };

function useBrain() {
  const [b, setB] = useState(() => getBrainStats());
  const [w, setW] = useState(() => getAdaptiveWeights(SCORE_WEIGHTS));
  const [x, setX] = useState(() => { try { return getExitRules(loadConfig()); } catch { return null; } });
  useEffect(() => {
    const t = setInterval(() => {
      try {
        setB(getBrainStats());
        setW(getAdaptiveWeights(SCORE_WEIGHTS));
        setX(getExitRules(loadConfig()));
      } catch { /* fail-open */ }
    }, 10000);
    return () => clearInterval(t);
  }, []);
  return { b, w, x };
}

export function useBrainStats() {
  const { b } = useBrain();
  return b;
}

export default function BrainPanel() {
  const { b, w, x } = useBrain();
  const collecting = b.collecting;
  const wr = b.winRate != null ? `${(b.winRate * 100).toFixed(0)}%` : '—';
  const avg = b.avgPnl != null ? `${b.avgPnl >= 0 ? '+' : ''}${b.avgPnl.toFixed(1)}%` : '—';
  const exitRows = [];
  if (x) {
    exitRows.push({
      k: 'runner-extension', label: 'runner extension',
      state: x.runner.active ? `ACTIVE · n=${x.runner.n}` : `collecting · n=${x.runner.n}/5`,
      on: x.runner.active,
    });
    exitRows.push({
      k: 'dead-cut', label: 'dead-money cut',
      state: x.deadCut.active ? `ACTIVE · n=${x.deadCut.n}` : `collecting · n=${x.deadCut.n}/5`,
      on: x.deadCut.active,
    });
    const profN = Object.values(x.buckets).filter(bk => bk.adjusted).length;
    const profTot = Object.keys(x.buckets).length;
    exitRows.push({
      k: 'stop-profile', label: 'stop profiling',
      state: profN ? `ACTIVE · ${profN} bucket${profN > 1 ? 's' : ''}` : (x.ready ? `no bucket ≥5 yet` : `collecting · n=${x.n}/${EXIT_MIN_TRADES}`),
      on: profN > 0,
    });
  }
  return (
    <section className="br-panel">
      <div className="br-head">
        <span className="br-title">BRAIN</span>
        <span className={'br-status' + (collecting ? '' : ' on')}>
          {collecting ? `collecting data · ${b.confirmedKills}/${MIN_KILLS} kills · ${b.closed}/${MIN_TRADES} trades` : 'learning live'}
        </span>
        {w.adapted && <span className="adapt-tag">weights adapted</span>}
      </div>
      <div className="br-stats">
        <span>closed <b>{b.closed}</b></span>
        <span>win <b className={b.winRate >= 0.5 ? 'grn' : ''}>{wr}</b></span>
        <span>avg P&L <b className={b.avgPnl >= 0 ? 'grn' : 'red'}>{avg}</b></span>
        <span>best <b className="grn">{b.best && b.best.pnlPct != null ? `+${b.best.pnlPct.toFixed(0)}% ${b.best.symbol || ''}` : '—'}</b></span>
        <span>kills confirmed <b>{b.confirmedKills}/{b.totalKills}</b></span>
      </div>
      {!collecting && (
        <div className="br-cols">
          <div className="br-col">
            <div className="br-sub">kill → rug hit rate</div>
            {b.hitRates.slice(0, 5).map(r => (
              <div className="br-row" key={r.fam}>
                <span>{r.fam}</span>
                <b className={r.rate >= 0.7 ? 'red' : ''}>{(r.rate * 100).toFixed(0)}%</b>
                <span className="dim">n={r.n}</span>
              </div>
            ))}
            {!b.hitRates.length && <div className="br-empty">no confirmed kills yet</div>}
          </div>
          <div className="br-col">
            <div className="br-sub">component ↔ P&L correlation</div>
            {b.correlations.filter(c => c.r != null).map(c => (
              <div className="br-row" key={c.comp}>
                <span>{COMP_LABELS[c.comp] || c.comp}</span>
                <b className={c.r > 0 ? 'grn' : 'red'}>{c.r >= 0 ? '+' : ''}{c.r.toFixed(2)}</b>
                <span className="dim">n={c.n}</span>
              </div>
            ))}
            {!b.correlations.some(c => c.r != null) && <div className="br-empty">no closed trades yet</div>}
          </div>
          <div className="br-col">
            <div className="br-sub">score weights</div>
            {Object.keys(SCORE_WEIGHTS).map(k => {
              const cur = w.weights[k];
              const dflt = SCORE_WEIGHTS[k];
              const chg = Math.abs(cur - dflt) > 0.01;
              return (
                <div className="br-row" key={k}>
                  <span>{COMP_LABELS[k] || k}</span>
                  <b>{cur}</b>
                  <span className="dim">{chg ? <span className="adapt-tag sm">adapted</span> : `base ${dflt}`}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {collecting && (
        <div className="br-empty">the floor is watching and recording. adaptations begin at {MIN_KILLS} confirmed kills + {MIN_TRADES} closed trades — nothing adapts before that.</div>
      )}
      {w.log.length > 0 && (
        <div className="br-log">
          {w.log.slice(0, 3).map((e, i) => (
            <div className="br-row dim" key={i}>
              <span>adapted {new Date(e.ts).toLocaleDateString()}</span>
              <span>n={e.nTrades}t/{e.nKills}k</span>
            </div>
          ))}
        </div>
      )}
      <div className="br-sub" style={{ padding: '8px 12px 0' }}>learned exit rules</div>
      <div style={{ padding: '0 12px 4px' }}>
        {exitRows.map(r => (
          <div className="br-row" key={r.k}>
            <span>{r.label}</span>
            <b className={r.on ? 'grn' : ''}>{r.state}</b>
          </div>
        ))}
        {x && Object.values(x.buckets).filter(bk => bk.adjusted).slice(0, 4).map(bk => (
          <div className="br-row dim" key={bk.key}>
            <span>⌞ {bk.key}</span>
            <span>SL −{Math.round(bk.sl * 100)}% · TP +{Math.round(bk.tp * 100)}% · wr {(bk.winRate * 100).toFixed(0)}% (n={bk.n})</span>
          </div>
        ))}
      </div>
      <div className="br-foot">local-only ledgers · never overrides hard kills · fail-open</div>
    </section>
  );
}

// Compact readout for the king's throne monitor: closed / win% / avg P&L.
export function BrainReadout() {
  const b = useBrainStats();
  if (!b.closed) return <div className="br-ro">BRAIN · collecting data</div>;
  const wr = b.winRate != null ? `${(b.winRate * 100).toFixed(0)}%` : '—';
  const avg = b.avgPnl != null ? `${b.avgPnl >= 0 ? '+' : ''}${b.avgPnl.toFixed(1)}%` : '—';
  return (
    <div className="br-ro">
      BRAIN · {b.closed} closed · {wr} win · {avg} avg
    </div>
  );
}
