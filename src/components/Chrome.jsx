// Desk chrome: banner, header, seat cards.
import { fmtUsd, fmtPct, fmtClock } from '../lib/paper.js';

export function Banner() {
  return (
    <div className="paper-banner">
      Paper trading · fake money · real signals · not financial advice
    </div>
  );
}

export function Header({ equity, pnlPct, openCount, paused, onTogglePaused, onOpenSettings, now, eliteOn }) {
  const pnlCls = pnlPct == null ? 'mag' : pnlPct >= 0 ? 'grn' : 'red';
  return (
    <header className="hdr">
      <div className="hdr-in">
        <div className="wordmark">ALPHABOT<small>TOKEN DESK</small></div>
        <div className="hdr-stats">
          <div className="hstat"><div className="k">Equity</div><div className="v mag">{fmtUsd(equity)}</div></div>
          <div className="hstat"><div className="k">P&amp;L</div><div className={`v ${pnlCls}`}>{fmtPct(pnlPct)}</div></div>
          <div className="hstat"><div className="k">Open</div><div className="v">{openCount}</div></div>
          <div className="hstat"><div className="k">Elite intel</div><div className={`v ${eliteOn ? 'grn' : ''}`} style={eliteOn ? {} : { color: 'var(--faint)' }}>{eliteOn ? 'ON' : 'OFF'}</div></div>
          <div className="clock">{fmtClock(now)}</div>
          <button className={'btn' + (paused ? ' on' : '')} onClick={onTogglePaused}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>
          <button className="btn" onClick={onOpenSettings}>⚙ Settings</button>
        </div>
      </div>
    </header>
  );
}

const SEAT_DEFS = [
  { id: 'scan', name: 'SCAN' },
  { id: 'vet', name: 'VET' },
  { id: 'research', name: 'RESEARCH' },
  { id: 'score', name: 'SCORE' },
  { id: 'trade', name: 'TRADE' },
  { id: 'risk', name: 'RISK' },
];

export function Seats({ seats }) {
  return (
    <div className="seats">
      {SEAT_DEFS.map(d => {
        const s = seats[d.id] || {};
        const cls = 'seat' + (s.working ? ' working' : s.live ? ' live' : '');
        return (
          <div key={d.id} className={cls}>
            <span className="dot" />
            <div className="name">{d.name}</div>
            <div className="val">{s.val || '—'}</div>
            <div className="sub">{s.sub || 'standby'}</div>
          </div>
        );
      })}
    </div>
  );
}
