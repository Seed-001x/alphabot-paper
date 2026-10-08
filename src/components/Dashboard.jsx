// ALPHABOT — Dashboard tab. Real-only. Positions, feed, equity, stats, allocation.
import { useMemo, useState } from 'react';
import {
  fmtUsd, fmtUsdSigned, fmtPct, fmtSol, fmtMc, fmtDur, fmtDate, shortMint,
  sellPosition,
} from '../lib/api.js';
import Sparkline from './Sparkline.jsx';
import EquityChart from './EquityChart.jsx';

function KillBanner({ tripped }) {
  return (
    <div className={'kill-banner' + (tripped ? ' tripped' : ' armed')}>
      {tripped
        ? '🛑 KILL SWITCH TRIPPED — trading halted. Re-enable from Settings.'
        : '🛡 Kill switch armed — auto-halt if equity drops 50%'}
    </div>
  );
}

function PosRow({ p, onSell, selling }) {
  const mult = p.multiple;
  const up = mult == null ? true : mult >= 1;
  const upl = p.unrealized;
  const now = Date.now();
  // Honest sparkline: entry MC → current MC (the only two points we know).
  const spark = p.entryMc != null && p.curMc != null ? [p.entryMc, p.curMc] : null;
  const pricePending = p.curMc == null;
  return (
    <div className="pos-row">
      <div className="tok-ic">{(p.symbol || '?').slice(0, 1).toUpperCase()}</div>
      <div className="pos-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="pos-sym">{p.symbol || '???'}</span>
          <span className={'mult ' + (up ? 'pos-up' : 'pos-dn')}>
            {mult != null ? mult.toFixed(2) + 'x' : '—'}
          </span>
          {spark && <Sparkline data={spark} positive={up} />}
          <span className="live-dot" title="live prices updating" />
        </div>
        <div className="pos-sub">{shortMint(p.mint)} · score {p.score ?? '?'} · held {fmtDur(now - (p.entryTs || now))}</div>
        <div className="pos-nums">
          <div className="pos-kv"><span className="k">entry MC</span><span className="v">{fmtMc(p.entryMc)}</span></div>
          <div className="pos-kv"><span className="k">MC now</span><span className="v">{pricePending ? <span style={{color:'#fbbf24'}}>syncing…</span> : fmtMc(p.curMc)}</span></div>
          <div className="pos-kv"><span className="k">size</span><span className="v">{fmtSol(p.solSize)}</span></div>
          <div className="pos-kv">
            <span className="k">unrealized</span>
            <span className={'v ' + (upl >= 0 ? 'pos-up' : 'pos-dn')}>{upl != null ? fmtUsdSigned(upl) : '—'}</span>
          </div>
        </div>
      </div>
      <div className="pos-side">
        <button className="sellbtn" disabled={selling} onClick={() => onSell(p)}>
          {selling ? '…' : 'SELL'}
        </button>
      </div>
    </div>
  );
}

function Positions({ positions, apiBase, onChanged, updatedTs }) {
  const [sort, setSort] = useState('size');
  const [selling, setSelling] = useState(null);

  const list = useMemo(() => {
    const arr = [...(positions || [])];
    if (sort === 'pnl') arr.sort((a, b) => (b.unrealized || 0) - (a.unrealized || 0));
    else if (sort === 'new') arr.sort((a, b) => (b.entryTs || 0) - (a.entryTs || 0));
    else arr.sort((a, b) => (b.solSize || 0) - (a.solSize || 0));
    return arr;
  }, [positions, sort]);

  const ageSec = updatedTs ? Math.max(0, Math.round((Date.now() - updatedTs) / 1000)) : null;

  const handleSell = async (p) => {
    if (!window.confirm(`Sell ${p.symbol || 'position'} now at market?`)) return;
    setSelling(p.mint);
    try {
      await sellPosition(apiBase, p.mint);
      if (onChanged) onChanged();
    } catch (e) {
      window.alert('Sell failed: ' + (e.message || 'network error'));
    } finally {
      setSelling(null);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">OPEN POSITIONS <span className="n">({list.length})</span>
          {ageSec != null && <span className="n" style={{color:'#34d399'}}> · live {ageSec}s ago</span>}
        </span>
        <select className="sortsel" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="size">Sort: Size</option>
          <option value="pnl">Sort: P&amp;L</option>
          <option value="new">Sort: Newest</option>
        </select>
      </div>
      {list.length === 0
        ? <div className="empty">flat — the bot opens positions when its signals fire</div>
        : list.map(p => <PosRow key={p.mint} p={p} onSell={handleSell} selling={selling === p.mint} />)}
    </div>
  );
}

// Transaction feed: buys from open positions + buy/sell pairs from closed trades.
function buildFeed(book) {
  const rows = [];
  for (const p of book.positions || []) {
    rows.push({
      id: 'o-' + p.mint, kind: 'buy', symbol: p.symbol || '???',
      amt: fmtSol(p.solSize), meta: `entry ${fmtMc(p.entryMc)}`,
      ts: p.entryTs || 0,
    });
  }
  for (const c of book.closed || []) {
    rows.push({
      id: 'b-' + (c.entryTxSig || c.mint), kind: 'buy', symbol: c.symbol || '???',
      amt: fmtSol(c.solSize), meta: `entry ${fmtMc(c.entryMc)}`,
      ts: c.entryTs || 0,
    });
    rows.push({
      id: 's-' + (c.exitTxSig || c.mint), kind: 'sell', symbol: c.symbol || '???',
      amt: c.pnlUsd != null ? fmtUsdSigned(c.pnlUsd) : '—',
      meta: (c.exitReason || 'exit').replace(/^[^\s]+\s/, ''),
      ts: c.exitTs || 0, pnl: c.pnlUsd,
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  return rows.slice(0, 50);
}

function TxFeed({ book }) {
  const rows = useMemo(() => buildFeed(book), [book]);
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">TRANSACTION FEED <span className="n">(Last {rows.length})</span></span>
      </div>
      {rows.length === 0
        ? <div className="empty">no transactions yet</div>
        : rows.map(r => (
          <div className="tx-row" key={r.id}>
            <div className={'tx-bar ' + r.kind} />
            <div>
              <span className="tx-sym">{r.symbol}</span>{' '}
              <span className={'tx-kind ' + r.kind}>{r.kind === 'buy' ? 'BUY' : 'SELL'}</span>
              <div className="tx-meta">{r.meta}</div>
            </div>
            <div className="tx-amt" style={{ color: r.kind === 'sell' ? (r.pnl >= 0 ? '#34d399' : '#f43f5e') : undefined }}>
              {r.amt}
            </div>
            <div className="tx-time">{fmtDate(r.ts)}</div>
          </div>
        ))}
    </div>
  );
}

function WalletCard({ book }) {
  const bal = book.equity;
  const pnl = book.pnlUsd || 0;
  const slip = book.avgSlippageBps;
  return (
    <div className="card">
      <div className="wallet-card">
        <div className="wallet-ic">⌁</div>
        <div className="wallet-nums">
          <div className="wkv">
            <span className="k">balance</span>
            <span className="v">{bal != null ? fmtUsd(bal) : '—'}</span>
          </div>
          <div className="wkv">
            <span className="k">P&amp;L</span>
            <span className="v" style={{ color: pnl >= 0 ? '#34d399' : '#f43f5e' }}>{fmtUsdSigned(pnl)}</span>
          </div>
          <div className="wkv">
            <span className="k">avg slip</span>
            <span className="v">{slip == null ? '—' : Math.round(slip) + ' bps'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCards({ book }) {
  const closed = book.closed || [];
  const wins = closed.filter(c => (c.pnlUsd || 0) > 0).length;
  const wr = closed.length ? wins / closed.length : null;
  const avgMult = closed.length
    ? closed.reduce((a, c) => a + (c.multiple || 1), 0) / closed.length
    : null;
  const cards = [
    { k: 'Total P&L', v: fmtUsdSigned(book.pnlUsd || 0), s: fmtPct(book.pnlPct || 0), c: (book.pnlUsd || 0) >= 0 ? '#34d399' : '#f43f5e' },
    { k: 'Win rate', v: wr == null ? '—' : Math.round(wr * 100) + '%', s: `${wins}W / ${closed.length - wins}L` },
    { k: 'Trades', v: String(closed.length), s: `${(book.positions || []).length} open now` },
    { k: 'Avg multiple', v: avgMult == null ? '—' : avgMult.toFixed(2) + 'x', s: 'closed trades' },
  ];
  return (
    <div className="stat4">
      {cards.map(c => (
        <div className="stat-card" key={c.k}>
          <div className="k">{c.k}</div>
          <div className="v" style={c.c ? { color: c.c } : undefined}>{c.v}</div>
          <div className="s">{c.s}</div>
        </div>
      ))}
    </div>
  );
}

function Donut({ book }) {
  const positions = book.positions || [];
  const cash = book.cash != null ? book.cash : 0;
  const total = (book.equity || 0) || 1;
  const segs = positions.map((p, i) => ({
    label: p.symbol || '???',
    v: p.valueNow != null ? p.valueNow : (p.sizeUsd || 0),
    color: ['#8B7CF6', '#2DD4BF', '#f472b6', '#fbbf24', '#60a5fa'][i % 5],
  }));
  segs.push({ label: 'Cash', v: Math.max(0, cash), color: '#2a2f42' });

  // build SVG donut
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = segs.map(s => {
    const frac = Math.max(0, s.v / total);
    const el = { ...s, dash: (frac * C).toFixed(1), off: (-acc * C).toFixed(1), frac };
    acc += frac;
    return el;
  });

  return (
    <div className="card">
      <div className="card-head"><span className="card-title">ALLOCATION</span></div>
      <div className="donut-flex">
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r={R} fill="none" stroke="#1a1f2b" strokeWidth="16" />
          {arcs.map((a, i) => (
            <circle key={i} cx="65" cy="65" r={R} fill="none"
              stroke={a.color} strokeWidth="16"
              strokeDasharray={`${a.dash} ${C}`}
              strokeDashoffset={a.off}
              transform="rotate(-90 65 65)"
              strokeLinecap="butt" />
          ))}
          <text x="65" y="62" textAnchor="middle" fill="#e8ecf4" fontSize="15" fontWeight="800">
            {(book.positions || []).length}
          </text>
          <text x="65" y="78" textAnchor="middle" fill="#5d6579" fontSize="9">POSITIONS</text>
        </svg>
        <div className="legend">
          {arcs.map((a, i) => (
            <div className="leg-row" key={i}>
              <span className="leg-swatch" style={{ background: a.color }} />
              <span>{a.label}</span>
              <span className="lv">{Math.round(a.frac * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Guardrails({ book }) {
  const g = book.guardrails || {};
  return (
    <div className="card">
      <div className="card-head"><span className="card-title">GUARDRAILS</span></div>
      <div className="legend">
        <div className="leg-row"><span>Max positions</span><span className="lv">{g.maxPositions ?? '—'}</span></div>
        <div className="leg-row"><span>Per-trade cap</span><span className="lv">{g.maxSizePct != null ? Math.round(g.maxSizePct * 100) + '%' : '—'}</span></div>
        <div className="leg-row"><span>Kill switch</span><span className="lv">−{g.killSwitchDrawdown != null ? Math.round(g.killSwitchDrawdown * 100) : 50}%</span></div>
        <div className="leg-row"><span>Status</span><span className="lv" style={{ color: book.killSwitched ? '#f43f5e' : '#34d399' }}>{book.killSwitched ? 'TRIPPED' : 'ARMED'}</span></div>
      </div>
    </div>
  );
}

export default function Dashboard({ book, apiBase, onChanged }) {
  if (!book) return <div className="loading">connecting to live book…</div>;
  return (
    <>
      <KillBanner tripped={!!book.killSwitched} />
      <div className="dash-grid">
        <div className="col">
          <Positions positions={book.positions} apiBase={apiBase} onChanged={onChanged} updatedTs={book.ts} />
          <TxFeed book={book} />
        </div>
        <div className="col">
          <WalletCard book={book} />
          <div className="card">
            <div className="card-head"><span className="card-title">EQUITY</span></div>
            <EquityChart curve={book.equityCurve} startUsd={book.startUsd} />
          </div>
          <StatCards book={book} />
          <div className="donut-row">
            <Donut book={book} />
            <Guardrails book={book} />
          </div>
        </div>
      </div>
      <div className="guard-foot" style={{ marginTop: 14 }}>
        real funds · on-chain fills · not financial advice
      </div>
    </>
  );
}
