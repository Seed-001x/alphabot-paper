// v3.3 — FEEDS panel. Read-only view of the raw discovery feeds (NEW /
// TRENDING / MOVERS), separate from the vetted pipeline. Dense rows like a
// trading-app feed: symbol, V (24h vol), MC, age, TX. Tap a row -> opens the
// token's DexScreener page (real link from enrichment) and logs an inspect
// event. Never faked: rows come only from the live `feeds.ready` bus event
// (local mode) or the server's /api/state snapshot (server mode).
// v3.9: server seeding adopts fresh snapshots whenever they change (not just
// once); an empty tab says WHY in one line — never a dead "awaiting" box.
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

const rowsSig = (r) => r
  ? TABS.map(t => `${t.id}:${((r[t.id] || []).length)}`).join('|') + '#' + (((r.new || [])[0] || {}).mint || '')
  : '';

// v3.8 backend mode: pass initialRows (+updatedTs) from the server's
// /api/state so the panel shows data immediately; live bus events keep
// refreshing it in local mode.
export default function FeedsPanel({ initialRows, initialTs, uptimeSec }) {
  const [rows, setRows] = useState(() => initialRows || { new: [], trending: [], movers: [] });
  const [tab, setTab] = useState('trending');
  const [updatedAt, setUpdatedAt] = useState(() => initialTs || null);
  const [pp, setPp] = useState('idle');
  const lastSigRef = useRef('');

  // Adopt server snapshots whenever they change (server mode re-polls
  // /api/state; the first snapshot after a deploy can be legitimately empty).
  useEffect(() => {
    if (!initialRows) return;
    const s = rowsSig(initialRows);
    if (s === lastSigRef.current) return;
    lastSigRef.current = s;
    const next = { new: initialRows.new || [], trending: initialRows.trending || [], movers: initialRows.movers || [] };
    setRows(next);
    setUpdatedAt(initialTs || Date.now());
    // Default to the first tab that actually has rows — never an empty tab.
    setTab(prev => {
      if ((next[prev] || []).length) return prev;
      for (const t of TABS) if ((next[t.id] || []).length) return t.id;
      return prev;
    });
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

  // Honest one-line reasons — an empty feed says why, never "awaiting".
  const emptyWhy = (() => {
    if (tab === 'trending') return 'trending: DexScreener boosts returned 0 Solana tokens this cycle';
    if (tab === 'movers') {
      const m = uptimeSec != null ? Math.floor(uptimeSec / 60) : null;
      return m != null && m < 30
        ? `movers: needs 30m of price snapshots — ${m}m in, still collecting`
        : 'movers: no coins with 30m+ of snapshots right now — still collecting';
    }
    return 'new: no fresh launches seen this cycle — rescans every 45s';
  })();

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
        {!list.length && <div className="fd-why">{emptyWhy}</div>}
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
