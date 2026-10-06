// Signal feed (kill feed), open positions, closed-trades ledger.
import { fmtUsd, fmtPct, fmtAgo, fmtDur, fmtClock } from '../lib/paper.js';
import { SCORE_WEIGHTS } from '../lib/pipeline.js';

const BRK_LABELS = {
  liquidity: 'LIQ', holders: 'HOLD', buyPressure: 'BUY', volume: 'VOL', age: 'AGE',
};

function Breakdown({ breakdown }) {
  if (!breakdown) return null;
  return (
    <div className="brk">
      {Object.keys(SCORE_WEIGHTS).map(k => {
        const v = breakdown[k];
        const unk = v == null;
        return (
          <span key={k} className={'b' + (unk ? ' unk' : '')}>
            {BRK_LABELS[k]} <i>{unk ? '?' : Math.round(v)}</i>
            {!unk && <span className="meter"><span style={{ width: `${Math.round(v)}%` }} /></span>}
          </span>
        );
      })}
    </div>
  );
}

function SignalRow({ s }) {
  const killed = s.verdict === 'KILLED';
  const badge = killed
    ? <span className="badge kill">KILLED</span>
    : s.taken
      ? <span className="badge enter">ENTER</span>
      : <span className="badge score">SCORED</span>;
  return (
    <div className={'sig' + (killed ? ' killed' : '')}>
      <div className="ts">{fmtClock(s.ts)}</div>
      <div>{badge}</div>
      <div className="body">
        <span className="sym">{s.symbol}</span>
        {!killed && s.score != null && <> · <span className="score-num">{s.score}</span></>}
        <div className="rsn">{s.reason}</div>
        {!killed && <Breakdown breakdown={s.breakdown} />}
        <div className="meta">
          {s.killPass ? `[${s.killPass} pass] · ` : ''}
          {s.dossier && s.dossier.topPct != null ? `top ${s.dossier.topPct.toFixed(1)}% · top10 ${s.dossier.top10Pct != null ? s.dossier.top10Pct.toFixed(1) : '?'}% · ` : ''}
          {s.eliteHit && <span className="elite-tag">⚡ elite: {(s.eliteLabels || []).join(', ')}</span>}
          {s.mint ? <span> · <a href={`https://dexscreener.com/solana/${s.mint}`} target="_blank" rel="noreferrer">chart</a></span> : null}
        </div>
      </div>
    </div>
  );
}

export function SignalFeed({ signals }) {
  const list = signals || [];
  return (
    <div className="panel">
      <h2 className="panel-title">◈ Signal feed — every candidate, judged</h2>
      <div className="feed">
        {list.length === 0 && <div className="empty">desk is warming up — first scan lands in seconds</div>}
        {list.map(s => <SignalRow key={s.id} s={s} />)}
      </div>
    </div>
  );
}

export function Positions({ positions, priceMap }) {
  const list = positions || [];
  return (
    <div className="panel">
      <h2 className="panel-title">◈ Open positions · {list.length}</h2>
      {list.length === 0 && <div className="empty">flat — the desk only holds what clears the bar</div>}
      <div className="pos-grid">
        {list.map(p => {
          const t = priceMap[p.mint];
          const mult = t && t.mc ? t.mc / p.entryMc : 1;
          const up = mult >= 1;
          const cur = t && t.price ? p.tokens * t.price : p.sizeUsd;
          return (
            <div key={p.mint} className="pos">
              <div className="top">
                <span className="sym">{p.symbol}</span>
                <span className={'mult' + (up ? ' up' : ' dn')}>{mult.toFixed(2)}x</span>
              </div>
              <div className="row"><span>entry MC</span><b>{fmtUsd(p.entryMc)}</b></div>
              <div className="row"><span>size</span><b>{fmtUsd(p.sizeUsd)}</b></div>
              <div className="row"><span>value now</span><b>{fmtUsd(cur)}</b></div>
              <div className="row"><span>unrealized</span><b className={cur - p.sizeUsd >= 0 ? 'pnl-pos' : 'pnl-neg'}>{fmtUsd(cur - p.sizeUsd)}</b></div>
              <div className="row"><span>score @ entry</span><b className="score-num">{p.score ?? '?'}{p.eliteHit ? ' ⚡' : ''}</b></div>
              <div className="row"><span>held</span><b>{fmtDur(Date.now() - p.entryTs)}</b></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Trades({ closed }) {
  const list = closed || [];
  return (
    <div className="panel">
      <h2 className="panel-title">◈ Closed trades · {list.length}</h2>
      {list.length === 0 && <div className="empty">no closed trades yet — exits land here with the reason</div>}
      {list.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="ledger">
            <thead>
              <tr><th>Token</th><th>P&amp;L</th><th>Mult</th><th>Exit reason</th><th>Held</th></tr>
            </thead>
            <tbody>
              {list.slice(0, 60).map((c, i) => (
                <tr key={c.mint + c.exitTs + i}>
                  <td><b>{c.symbol}</b>{c.eliteHit ? ' ⚡' : ''}</td>
                  <td className={c.pnlUsd >= 0 ? 'pnl-pos' : 'pnl-neg'}>{fmtUsd(c.pnlUsd)}</td>
                  <td>{(c.multiple || 1).toFixed(2)}x</td>
                  <td style={{ color: 'var(--dim)' }}>{c.exitReason}</td>
                  <td style={{ color: 'var(--faint)' }}>{fmtDur(c.holdMs)} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
