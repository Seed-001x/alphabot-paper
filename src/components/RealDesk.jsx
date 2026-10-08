// REAL-money desk — the primary view when realMode is live.
// Paper trading lives in the background; this is real funds.
import { useState } from 'react';
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
  // v3.24: before first trade, show live on-chain balance (liveSol) instead of blanks
  const startSol = book.startSol != null ? book.startSol : book.liveSol;
  const balUsd = book.equity != null ? book.equity : null;
  return (
    <div className="panel real-hero">
      <h2 className="panel-title"><span className="rp-dot" /> REAL MONEY — live funds</h2>
      <div className="rh-grid">
        <div className="rh-stat">
          <span className="rh-label">balance</span>
          <span className="rh-val">{balUsd != null ? fmtUsd(balUsd) : '—'}</span>
          <span className="rh-sub">{startSol != null ? fmtSol(startSol) : '—'}</span>
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

function fmtMc(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function RealPositions({ positions, onSell }) {
  const list = positions || [];
  const now = Date.now();
  const [selling, setSelling] = useState(null);
  const handleSell = async (mint, symbol) => {
    if (!confirm(`Sell ${symbol} now?`)) return;
    setSelling(mint);
    try {
      await onSell(mint);
    } finally {
      setSelling(null);
    }
  };
  return (
    <div className="panel">
      <h2 className="panel-title"><span className="rp-dot" /> Open real positions · {list.length}</h2>
      {list.length === 0 && <div className="empty">flat — real entries fire when paper signals</div>}
      <div className="pos-grid">
        {list.map(p => {
          const mult = p.multiple;
          const multCls = mult == null ? '' : mult >= 1 ? 'pnl-pos' : 'pnl-neg';
          const upl = p.unrealized;
          const entryTime = p.entryTs ? new Date(p.entryTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
          const isSelling = selling === p.mint;
          return (
            <div key={p.mint} className="pos">
              <div className="top">
                <span className="sym">{p.symbol}</span>
                <span className={multCls} style={{ fontSize: '1.4em', fontWeight: 700 }}>
                  {mult != null ? mult.toFixed(2) + 'x' : '—'}
                </span>
              </div>
              <div className="row"><span>CA</span><b style={{ fontSize: '0.75em', wordBreak: 'break-all' }}>{p.mint ? p.mint.slice(0, 8) + '...' + p.mint.slice(-6) : '—'}</b></div>
              <div className="row"><span>entry MC</span><b>{fmtMc(p.entryMc)}</b></div>
              <div className="row"><span>MC now</span><b>{fmtMc(p.curMc)}</b></div>
              <div className="row"><span>size</span><b>{fmtSol(p.solSize)} · {fmtUsd(p.sizeUsd)}</b></div>
              <div className="row"><span>value now</span><b>{p.valueNow != null ? fmtUsd(p.valueNow) : '—'}</b></div>
              <div className="row"><span>unrealized</span><b className={upl >= 0 ? 'pnl-pos' : 'pnl-neg'}>{upl != null ? fmtUsd(upl) : '—'}</b></div>
              <div className="row"><span>score @ entry</span><b className="score-num">{p.score ?? '?'}</b></div>
              <div className="row"><span>entered</span><b>{entryTime}</b></div>
              <div className="row"><span>held</span><b>{fmtDur(now - p.entryTs)}</b></div>
              <div className="row"><span>on-chain</span><b style={{ color: 'var(--grn)' }}>✓ filled</b></div>
              <div className="row live-row"><span className="live-dot" /><b className="live-text">live · updating</b></div>
              <button
                className="sell-btn"
                disabled={isSelling}
                onClick={() => handleSell(p.mint, p.symbol)}
                style={{
                  marginTop: '8px', width: '100%', padding: '10px',
                  background: isSelling ? '#333' : '#e11d48', color: '#fff',
                  border: 'none', borderRadius: '8px', fontWeight: 700,
                  cursor: isSelling ? 'wait' : 'pointer', fontSize: '0.9em',
                }}
              >
                {isSelling ? 'SELLING…' : 'SELL'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RealTrades({ closed }) {
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
                <tr key={(c.exitTxSig || c.mint) + i}>
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

export default function RealDesk({ book, priceMap, onChart, apiBase }) {
  const handleSell = async (mint) => {
    const base = apiBase || '';
    const r = await fetch(`${base}/api/admin/sell-position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mint }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'sell failed');
    return j;
  };
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
      <RealPositions positions={book.positions} onSell={handleSell} />
      <RealTrades closed={book.closed} />
      <div className="panel" style={{ color: 'var(--faint)', fontSize: 11, textAlign: 'center' }}>
        guardrails — max {book.guardrails?.maxPositions ?? 3} positions · per-trade cap {Math.round((book.guardrails?.maxSizePct ?? 0.3) * 100)}% · kill switch at −{Math.round((book.guardrails?.killSwitchDrawdown ?? 0.5) * 100)}%
      </div>
    </>
  );
}
