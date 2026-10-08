// REAL-money desk — the primary view when realMode is live.
// Paper trading lives in the background; this is real funds.
import { fmtUsd, fmtPct, fmtDur, fmtClock } from '../lib/paper.js';

function fmtSol(n) {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(4) + ' SOL';
}

export function RealPaperToggle({ view, onChange, realEnabled }) {
  return (
    <div className="rp-toggle-wrap">
      <div className="rp-toggle" role="tablist" aria-label="desk mode">
        <button
          className={'rp-tab real' + (view === 'real' ? ' on' : '')}
          onClick={() => onChange('real')}
          role="tab"
          aria-selected={view === 'real'}
        >
          <span className="rp-dot" />REAL{realEnabled ? '' : ' · OFF'}
        </button>
        <button
          className={'rp-tab paper' + (view === 'paper' ? ' on' : '')}
          onClick={() => onChange('paper')}
          role="tab"
          aria-selected={view === 'paper'}
        >
          PAPER
        </button>
      </div>
    </div>
  );
}

function KillSwitchBanner({ tripped }) {
  return (
    <div className={'panel kill-banner' + (tripped ? ' tripped' : ' armed')}>
      {tripped ? (
        <><span className="kb-icon">🛑</span> KILL SWITCH TRIPPED — real trading halted at −50%. Re-enable from control panel.</>
      ) : (
        <><span className="kb-icon">🛡</span> KILL SWITCH ARMED — auto-halt if equity drops 50%</>
      )}
    </div>
  );
}

function RealHero({ book }) {
  const pnl = book.pnlUsd || 0;
  const pnlCls = pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
  const startSol = book.startSol;
  return (
    <div className="panel real-hero">
      <h2 className="panel-title"><span className="rp-dot" /> REAL MONEY — live funds</h2>
      <div className="rh-grid">
        <div className="rh-stat">
          <span className="rh-label">balance</span>
          <span className="rh-val">{fmtUsd(book.equity)}</span>
          <span className="rh-sub">{fmtSol(book.equity != null && book.startUsd ? (book.equity / book.startUsd) * startSol : startSol)}</span>
        </div>
        <div className="rh-stat">
          <span className="rh-label">P&amp;L since start</span>
          <span className={'rh-val ' + pnlCls}>{fmtUsd(pnl)}</span>
          <span className={'rh-sub ' + pnlCls}>{fmtPct(book.pnlPct || 0)}</span>
        </div>
        <div className="rh-stat">
          <span className="rh-label">avg slippage</span>
          <span className="rh-val">{book.avgSlippageBps == null ? '—' : `${Math.round(book.avgSlippageBps)} bps`}</span>
          <span className="rh-sub">quoted vs filled</span>
        </div>
      </div>
    </div>
  );
}

function RealPositions({ positions, priceMap, onChart }) {
  const list = positions || [];
  const now = Date.now();
  return (
    <div className="panel">
      <h2 className="panel-title"><span className="rp-dot" /> Open real positions · {list.length}</h2>
      {list.length === 0 && <div className="empty">flat — real entries fire when paper signals</div>}
      <div className="pos-grid">
        {list.map(p => {
          const t = priceMap[p.mint];
          // approx current value from live price if available
          const curUsd = t && t.price && p.quotedOut ? (p.quotedOut / 1e9) * t.price : null;
          const upl = curUsd != null ? curUsd - p.sizeUsd : null;
          return (
            <div
              key={p.mint}
              className="pos clickable"
              onClick={() => onChart && onChart({ mint: p.mint, symbol: p.symbol, entryTs: p.entryTs })}
              title="click to see chart"
            >
              <div className="top">
                <span className="sym">{p.symbol}</span>
                <span className="badge enter">REAL</span>
              </div>
              <div className="row"><span>size</span><b>{fmtSol(p.solSize)} · {fmtUsd(p.sizeUsd)}</b></div>
              {upl != null && (
                <div className="row"><span>unrealized</span><b className={upl >= 0 ? 'pnl-pos' : 'pnl-neg'}>{fmtUsd(upl)}</b></div>
              )}
              <div className="row"><span>score @ entry</span><b className="score-num">{p.score ?? '?'}</b></div>
              <div className="row"><span>held</span><b>{fmtDur(now - p.entryTs)}</b></div>
              <div className="row"><span>on-chain</span><b style={{ color: 'var(--grn)' }}>✓ filled</b></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RealTrades({ closed, onChart }) {
  const list = closed || [];
  return (
    <div className="panel">
      <h2 className="panel-title"><span className="rp-dot" /> Closed real trades · {list.length}</h2>
      {list.length === 0 && <div className="empty">no closed real trades yet — exits land here with on-chain fills</div>}
      {list.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="ledger">
            <thead>
              <tr><th>Token</th><th>Real P&amp;L</th><th>Mult</th><th>Size</th><th>Exit reason</th><th>Held</th></tr>
            </thead>
            <tbody>
              {list.slice(0, 60).map((c, i) => (
                <tr
                  key={(c.exitTxSig || c.mint) + i}
                  className={onChart ? 'clickable' : ''}
                  onClick={() => onChart && onChart({ mint: c.mint, symbol: c.symbol, entryTs: c.entryTs, exitTs: c.exitTs })}
                  title="click to see chart"
                >
                  <td><b>{c.symbol}</b> <span className="badge enter" style={{ fontSize: 9 }}>REAL</span></td>
                  <td className={c.pnlUsd >= 0 ? 'pnl-pos' : 'pnl-neg'}>{fmtUsd(c.pnlUsd)}</td>
                  <td>{(c.multiple || 1).toFixed(2)}x</td>
                  <td>{fmtSol(c.solSize)}</td>
                  <td style={{ color: 'var(--dim)' }}>{c.exitReason}</td>
                  <td style={{ color: 'var(--faint)' }}>{fmtDur(c.holdMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RealOff() {
  return (
    <div className="panel" style={{ textAlign: 'center', padding: '48px 20px' }}>
      <div style={{ fontSize: 13, letterSpacing: 3, color: 'var(--dim)', marginBottom: 12 }}>REAL TRADING OFF</div>
      <div style={{ color: 'var(--faint)', fontSize: 12, maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
        Real-money mode is not enabled on the server.<br />
        Paper trading continues in the background.
      </div>
    </div>
  );
}

export default function RealDesk({ book, priceMap, onChart }) {
  if (!book || !book.ok) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 32, color: 'var(--dim)' }}>
        connecting to real book…
      </div>
    );
  }
  if (!book.enabled) return <RealOff />;
  return (
    <>
      <KillSwitchBanner tripped={!!book.killSwitched} />
      <RealHero book={book} />
      <RealPositions positions={book.positions} priceMap={priceMap} onChart={onChart} />
      <RealTrades closed={book.closed} onChart={onChart} />
      <div className="panel" style={{ color: 'var(--faint)', fontSize: 11, textAlign: 'center' }}>
        guardrails — max {book.guardrails?.maxPositions ?? 3} positions · per-trade cap {Math.round((book.guardrails?.maxSizePct ?? 0.3) * 100)}% · kill switch at −{Math.round((book.guardrails?.killSwitchDrawdown ?? 0.5) * 100)}%
      </div>
    </>
  );
}
