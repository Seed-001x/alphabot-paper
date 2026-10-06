// v3.9 — TRADE HISTORY. Clean closed-trade ledger, newest first.
// Replaces the LIVE ACTIVITY noise (user: "just taking up fucking space").
// One row per closed trade: symbol · entry→exit time · entry MC → exit MC ·
// size (SOL) · P&L $ + % · exit reason tag. Never faked: rows come only from
// the portfolio's closed ledger (server /api/state in SERVER mode, local
// journal in LOCAL mode).
import { fmtUsd, fmtClock, fmtDur } from '../lib/paper.js';

function exitTag(reason) {
  const r = (reason || '').toLowerCase();
  if (r.includes('take-profit') || r.includes('take profit')) return { t: 'TP +30%', c: 'grn' };
  if (r.includes('trailing')) return { t: 'TRAIL', c: 'amb' };
  if (r.includes('stop-loss') || r.includes('stop loss')) return { t: 'STOP', c: 'red' };
  if (r.includes('dead-money') || r.includes('dead money')) return { t: 'DEAD', c: 'red' };
  if (r.includes('max hold') || r.includes('maxhold')) return { t: 'TIME', c: 'dim' };
  if (r.includes('elite exit')) return { t: 'ELITE EXIT', c: 'mag' };
  if (r.includes('rugged') || r.includes('rug')) return { t: 'RUG', c: 'red' };
  return { t: (reason || 'exit').slice(0, 14), c: 'dim' };
}

export default function TradeHistory({ closed }) {
  const list = (closed || []).slice().sort((a, b) => (b.exitTs || 0) - (a.exitTs || 0)).slice(0, 60);
  const wins = list.filter(c => (c.pnlUsd || 0) >= 0).length;
  return (
    <section className="th-panel panel">
      <h2 className="panel-title">
        ◈ TRADE HISTORY · {list.length}
        {list.length > 0 && <span className="dim"> · {wins}/{list.length} won</span>}
      </h2>
      {list.length === 0 && (
        <div className="empty">no closed trades yet — every exit lands here with full P&amp;L</div>
      )}
      <div className="th-list">
        {list.map((c, i) => {
          const win = (c.pnlUsd || 0) >= 0;
          const pct = c.multiple != null && isFinite(c.multiple) ? (c.multiple - 1) * 100 : null;
          const tag = exitTag(c.exitReason);
          return (
            <div className="th-row" key={`${c.mint || 'x'}-${c.exitTs || i}-${i}`}>
              <div className="th-top">
                <b className="th-sym">{c.symbol || '???'}</b>
                {(c.eliteHit || c.flowTag) && <span className="th-flow" title="smart-flow confirmed">◈</span>}
                {c.learned && <span className="adapt-tag" title="exit rule learned from the trade journal">🧠</span>}
                <span className={'th-pnl ' + (win ? 'pnl-pos' : 'pnl-neg')}>
                  {fmtUsd(c.pnlUsd)}{pct != null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}
                </span>
                <span className={'th-tag ' + tag.c}>{tag.t}</span>
              </div>
              <div className="th-sub">
                <span>{fmtClock(c.entryTs)} → {fmtClock(c.exitTs)}</span>
                <span> · </span>
                <span>{c.solSize != null ? `${Number(c.solSize).toFixed(2)} SOL` : 'size —'}</span>
                <span> · </span>
                <span>{fmtUsd(c.entryMc)} → {fmtUsd(c.exitMc)} MC</span>
                <span> · </span>
                <span>held {fmtDur(c.holdMs)}</span>
              </div>
              {c.exitReason && <div className="th-why">{c.exitReason}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
