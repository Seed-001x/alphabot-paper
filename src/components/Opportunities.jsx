// OPPORTUNITIES — live pump.fun movers feed, trading-terminal style.
// Card-based layout like pump.fun/Photon movers: coin visual, symbol/name,
// MC front and center, age, graduated badge. Tap a card → pump.fun.
// Polls /api/movers every 30s. Client-side filters: min MC (default $100K),
// min age (default 5h), sort by recency (default) or MC.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBackendUrl, fmtMc } from '../lib/api.js';

async function fetchMovers(base) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`${base}/api/movers`, { signal: ctl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    if (!d || d.ok !== true) throw new Error((d && d.error) || 'bad payload');
    return Array.isArray(d.coins) ? d.coins : [];
  } finally {
    clearTimeout(t);
  }
}

// deterministic identicon: gradient from address hash + first letter
const PALETTES = [
  ['#8B7CF6', '#5b4fd6'], ['#2DD4BF', '#0e7c6f'], ['#f472b6', '#b83280'],
  ['#fbbf24', '#b45309'], ['#60a5fa', '#1d4ed8'], ['#34d399', '#047857'],
  ['#fb7185', '#be123c'], ['#a78bfa', '#6d28d9'], ['#facc15', '#a16207'],
  ['#38bdf8', '#0369a1'],
];
function identicon(addr, sym) {
  let h = 0;
  const s = String(addr || sym || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const [c1, c2] = PALETTES[h % PALETTES.length];
  const letter = String(sym || '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase() || '?';
  return { bg: `linear-gradient(135deg, ${c1}, ${c2})`, letter };
}

function fmtAge(ts) {
  if (!ts) return '—';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  const d = Math.floor(h / 24);
  return d + 'd ' + (h % 24) + 'h';
}

const MC_PRESETS = [
  { label: '50K', v: 50000 },
  { label: '100K', v: 100000 },
  { label: '250K', v: 250000 },
  { label: '500K', v: 500000 },
  { label: '1M', v: 1000000 },
];
const AGE_PRESETS = [
  { label: '1h', v: 1 },
  { label: '5h', v: 5 },
  { label: '12h', v: 12 },
  { label: '24h', v: 24 },
];

export default function Opportunities() {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [minMc, setMinMc] = useState(100000);
  const [minAgeH, setMinAgeH] = useState(5);
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'mc'

  const load = useCallback(async () => {
    const base = getBackendUrl();
    if (!base) { setErr('offline — set a backend URL in Settings'); setLoading(false); return; }
    try {
      const list = await fetchMovers(base);
      setCoins(list);
      setUpdatedAt(Date.now());
      setErr('');
    } catch (e) {
      setErr('cannot reach movers feed — retrying');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => {
    const now = Date.now();
    const minAgeMs = minAgeH * 3600e3;
    const out = coins.filter(c => {
      const mc = c.usdMc ?? c.usd_market_cap ?? 0;
      if (!(mc >= minMc)) return false;
      if (c.createdAt && now - c.createdAt < minAgeMs) return false;
      return true;
    });
    if (sortBy === 'mc') {
      out.sort((a, b) => (b.usdMc ?? 0) - (a.usdMc ?? 0));
    } else {
      // movers order (recency of trade); fall back to newest created
      out.sort((a, b) => (b.lastTradeTs ?? b.createdAt ?? 0) - (a.lastTradeTs ?? a.createdAt ?? 0));
    }
    return out;
  }, [coins, minMc, minAgeH, sortBy]);

  return (
    <div className="col">
      <div className="card">
        <div className="card-head">
          <div className="card-title">OPPORTUNITIES <span className="n">· {visible.length}{visible.length !== coins.length ? `/${coins.length}` : ''}</span></div>
          <div className="tx-time">{updatedAt ? 'updated ' + fmtAge(updatedAt) + ' ago' : ''}</div>
        </div>

        {/* filter bar */}
        <div className="opp-filters">
          <div className="opp-frow">
            <span className="opp-flabel">MC ≥</span>
            <div className="opp-chips">
              {MC_PRESETS.map(p => (
                <button key={p.v} className={'opp-chip' + (minMc === p.v ? ' on' : '')}
                  onClick={() => setMinMc(p.v)}>${p.label}</button>
              ))}
            </div>
          </div>
          <div className="opp-frow">
            <span className="opp-flabel">Age ≥</span>
            <div className="opp-chips">
              {AGE_PRESETS.map(p => (
                <button key={p.v} className={'opp-chip' + (minAgeH === p.v ? ' on' : '')}
                  onClick={() => setMinAgeH(p.v)}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="opp-frow">
            <span className="opp-flabel">Sort</span>
            <div className="opp-chips">
              <button className={'opp-chip' + (sortBy === 'recent' ? ' on' : '')}
                onClick={() => setSortBy('recent')}>Movers</button>
              <button className={'opp-chip' + (sortBy === 'mc' ? ' on' : '')}
                onClick={() => setSortBy('mc')}>Top MC</button>
            </div>
          </div>
        </div>

        {loading && <div className="empty">loading movers…</div>}

        {!loading && err && coins.length === 0 && (
          <div className="empty">{err}</div>
        )}

        {!loading && !err && visible.length === 0 && (
          <div className="empty">
            {coins.length > 0
              ? 'no coins pass the filters — loosen MC or age'
              : 'no movers right now — check back soon'}
          </div>
        )}

        {visible.length > 0 && (
          <div className="opp-grid">
            {visible.map(c => {
              const mc = c.usdMc ?? c.usd_market_cap ?? null;
              const addr = c.address || c.mint || '';
              const sym = c.symbol || '???';
              const name = c.name || '';
              const id = identicon(addr, sym);
              return (
                <a
                  key={addr || sym}
                  href={addr ? `https://pump.fun/coin/${addr}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opp-card"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="opp-card-top">
                    <div className="opp-coin" style={{ background: id.bg }}>{id.letter}</div>
                    <div className="opp-id">
                      <div className="opp-sym">{sym}</div>
                      {name && name !== sym && <div className="opp-name">{name}</div>}
                    </div>
                    {c.graduated && <div className="opp-badge grad">GRAD</div>}
                  </div>
                  <div className="opp-mc">{fmtMc(mc)}</div>
                  <div className="opp-meta">
                    <span className="opp-age">{c.createdAt ? fmtAge(c.createdAt) + ' old' : '—'}</span>
                    <span className="opp-open">pump.fun ↗</span>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {err && coins.length > 0 && (
          <div className="rc-note">{err}</div>
        )}
      </div>
      <div className="rc-note">
        Live movers from pump.fun — the same feed the bot scans. Tap a card to open it on pump.fun.
      </div>
    </div>
  );
}
