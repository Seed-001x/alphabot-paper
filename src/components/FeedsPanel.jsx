// v3.3 — FEEDS panel. Read-only view of the raw discovery feeds (NEW /
// TRENDING / MOVERS), separate from the vetted pipeline. Dense rows like a
// trading-app feed: symbol, V (24h vol), MC, age, TX. Tap a row -> opens the
// token's DexScreener page (real link from enrichment) and logs an inspect
// event. Never faked: rows come only from the live `feeds.ready` bus event.
import { useEffect, useRef, useState } from 'react';
import { subscribeFloor, floorEmit } from '../lib/floorBus.js';
import { pumpPortalState } from '../lib/pumpportal.js';
import { fmtUsd, fmtAgo } from '../lib/paper.js';

const TABS = [
  { id: 'trending', label: 'TRENDING' },
  { id: 'movers', label: 'MOVERS' },
  { id: 'new', label: 'NEW' },
];

function Age({ ts }) {
  if (!ts) return <span className="fd-unk">?</span>;
  return <span>{fmtAgo(ts)}</span>;
}

function FeedRow({ r, extra }) {
  const open = () => {
    try { floorEmit('feed.inspect', { mint: r.mint, symbol: r.symbol }); } catch { /* noop */ }
    if (r.url) window.open(r.url, '_blank', 'noopener');
  };
  return (
    <button className="fd-row" onClick={open} title={r.name || r.symbol}>
      <span className="fd-sym">{r.symbol || '???'}</span>
      {extra}
      <span className="fd-v">{r.vol24h != null ? fmtUsd(r.vol24h) : '?'}</span>
      <span className="fd-mc">{r.mc != null ? fmtUsd(r.mc) : '?'}</span>
      <span className="fd-age"><Age ts={r.createdAt} /></span>
      <span className="fd-tx">{r.txns != null ? r.txns.toLocaleString() : '?'}</span>
      <span className="fd-go">↗</span>
    </button>
  );
}

// v3.8 backend mode: pass initialRows (+updatedTs) from the server's
// /api/state so the panel shows data immediately; live bus events keep
// refreshing it either way.
export default function FeedsPanel({ initialRows, initialTs }) {
  const [rows, setRows] = useState(() => initialRows || { new: [], trending: [], movers: [] });
  const [tab, setTab] = useState('trending');
  const [updatedAt, setUpdatedAt] = useState(() => initialTs || null);
  const [pp, setPp] = useState('idle');
  const seededRef = useRef(false);

  // Seed once from the server snapshot (first paint); bus events refresh after.
  useEffect(() => {
    if (!seededRef.current && initialRows &&
        ((initialRows.new || []).length + (initialRows.trending || []).length + (initialRows.movers || []).length > 0)) {
      seededRef.current = true;
      setRows(initialRows);
      setUpdatedAt(initialTs || Date.now());
    }
  }, [initialRows, initialTs]);

  useEffect(() => subscribeFloor(ev => {
    if (ev.type === 'feeds.ready' && ev.new) {
      setRows({ new: ev.new, trending: ev.trending || [], movers: ev.movers || [] });
      setUpdatedAt(ev.ts);
    }
  }), []);

  useEffect(() => {
    const t = setInterval(() => { try { setPp(pumpPortalState()); } catch { /* noop */ } }, 5000);
    return () => clearInterval(t);
  }, []);

  const list = rows[tab] || [];
  const ppLabel = pp === 'live' ? 'PP live' : pp === 'probing' ? 'PP probing' : pp === 'dead' ? 'PP retry' : 'PP off';
  return (
    <section className="fd-panel">
      <div className="fd-head">
        <span className="fd-title">FEEDS</span>
        <span className={'fd-pp' + (pp === 'live' ? ' on' : '')} title="PumpPortal websocket new-token stream (in-browser probe)">{ppLabel}</span>
        <div className="fd-tabs">
          {TABS.map(t => (
            <button key={t.id}
              className={'fd-tab' + (tab === t.id ? ' on' : '')}
              onClick={() => setTab(t.id)}>
              {t.label}<i>{(rows[t.id] || []).length}</i>
            </button>
          ))}
        </div>
        {updatedAt && <span className="fd-upd">upd {fmtAgo(updatedAt)}</span>}
      </div>
      <div className="fd-cols">
        <span>SYM</span>
        <span className="fd-x">{tab === 'movers' ? 'MOVE' : tab === 'trending' ? 'HEAT' : ''}</span>
        <span>V</span><span>MC</span><span>AGE</span><span>TX</span><span />
      </div>
      <div className="fd-list">
        {!list.length && <div className="fd-empty">awaiting feed data — fills on the next scan cycle</div>}
        {list.map(r => (
          <FeedRow key={r.mint} r={r} extra={
            tab === 'movers'
              ? <span className={'fd-x' + (r.moverPct >= 0 ? ' up' : ' dn')}>{r.moverPct != null ? `${r.moverPct >= 0 ? '+' : ''}${r.moverPct.toFixed(0)}%` : '?'}</span>
              : tab === 'trending'
                ? <span className="fd-x">{r.trendScore != null ? fmtUsd(r.trendScore) : '?'}</span>
                : <span className="fd-x" />
          } />
        ))}
      </div>
      <div className="fd-foot">raw discovery feeds — unvetted · tap a row for its chart</div>
    </section>
  );
}
