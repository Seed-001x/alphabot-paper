// OPPORTUNITIES — pump.fun movers replica with full enriched data.
// Row layout mirrors pump.fun's movers tab frame-by-frame:
// [thumb] Name ✓ | V $vol  MC $mc(cyan) / TICKER 🌱 age 👥𝕏🌐 | price / 👤 holders | TX n
// Polls /api/movers every 30s. Filters: MC range ($100K–$2M default), age range (5m–24h default).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBackendUrl } from '../lib/api.js';

async function fetchMovers(base) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
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

// deterministic identicon fallback when the API has no image
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
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd';
  return Math.floor(d / 30) + 'mo';
}

// compact money: 159200 -> $159.2K, 5000000 -> $5M
function fmtUsd(v) {
  if (v == null || !(v >= 0)) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K';
  return '$' + v.toFixed(v < 10 ? 2 : 0);
}

// compact count: 75000 -> 75K, 4200 -> 4.2K
function fmtCount(v) {
  if (v == null || !(v >= 0)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K';
  return String(Math.round(v));
}

function fmtPrice(v) {
  if (v == null || !(v > 0)) return '—';
  if (v >= 1) return '$' + v.toFixed(2);
  if (v >= 0.01) return '$' + v.toFixed(4);
  return '$' + v.toFixed(6);
}

const MC_RANGES = [
  { key: '100k-2m', label: '$100K – $2M', min: 100000, max: 2000000 },
  { key: '100k-500k', label: '$100K – $500K', min: 100000, max: 500000 },
  { key: '100k-1m', label: '$100K – $1M', min: 100000, max: 1000000 },
  { key: '500k-5m', label: '$500K – $5M', min: 500000, max: 5000000 },
  { key: '1m-plus', label: '$1M+', min: 1000000, max: Infinity },
  { key: 'any', label: 'Any MC', min: 0, max: Infinity },
];
const AGE_RANGES = [
  { key: '5m-24h', label: '5m – 24h', minMs: 5 * 60e3, maxMs: 24 * 3600e3 },
  { key: '5m-1h', label: '5m – 1h', minMs: 5 * 60e3, maxMs: 3600e3 },
  { key: '1h-24h', label: '1h – 24h', minMs: 3600e3, maxMs: 24 * 3600e3 },
  { key: '5h-24h', label: '5h – 24h', minMs: 5 * 3600e3, maxMs: 24 * 3600e3 },
  { key: 'any', label: 'Any age', minMs: 0, maxMs: Infinity },
];

export default function Opportunities() {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [mcRange, setMcRange] = useState('100k-2m');
  const [ageRange, setAgeRange] = useState('5m-24h');
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
    const mcR = MC_RANGES.find(r => r.key === mcRange) || MC_RANGES[0];
    const ageR = AGE_RANGES.find(r => r.key === ageRange) || AGE_RANGES[0];
    const out = coins.filter(c => {
      const mc = c.usdMc ?? 0;
      if (!(mc >= mcR.min && mc <= mcR.max)) return false;
      if (c.createdAt) {
        const ageMs = now - c.createdAt;
        if (!(ageMs >= ageR.minMs && ageMs <= ageR.maxMs)) return false;
      }
      return true;
    });
    if (sortBy === 'mc') {
      out.sort((a, b) => (b.usdMc ?? 0) - (a.usdMc ?? 0));
    }
    // 'recent' keeps feed order (already sorted by last trade)
    return out;
  }, [coins, mcRange, ageRange, sortBy]);

  return (
    <div className="col">
      <div className="card pf-movers">
        <div className="card-head">
          <div className="card-title">MOVERS <span className="n">· {visible.length}{visible.length !== coins.length ? `/${coins.length}` : ''}</span></div>
          <div className="tx-time">{updatedAt ? 'updated ' + fmtAge(updatedAt) + ' ago' : ''}</div>
        </div>

        <div className="opp-filters">
          <select
            className="opp-dd"
            value={mcRange}
            onChange={e => setMcRange(e.target.value)}
            aria-label="MC range"
          >
            {MC_RANGES.map(r => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          <select
            className="opp-dd"
            value={ageRange}
            onChange={e => setAgeRange(e.target.value)}
            aria-label="Age range"
          >
            {AGE_RANGES.map(r => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          <select
            className="opp-dd"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            aria-label="Sort"
          >
            <option value="recent">Movers</option>
            <option value="mc">Top MC</option>
          </select>
        </div>

        {loading && <div className="empty">loading movers…</div>}
        {!loading && err && coins.length === 0 && <div className="empty">{err}</div>}
        {!loading && !err && visible.length === 0 && (
          <div className="empty">
            {coins.length > 0 ? 'no coins pass the filters — try a wider MC or age range' : 'no movers right now — check back soon'}
          </div>
        )}

        {visible.length > 0 && (
          <div className="pf-rows">
            {visible.map(c => {
              const addr = c.address || '';
              const sym = c.symbol || '???';
              const name = c.name || sym;
              const mc = c.usdMc ?? null;
              const vol = c.vol24h ?? null;
              const holders = c.holders ?? null;
              const txns = c.txns24h ?? null;
              const price = c.priceUsd ?? null;
              const age = c.createdAt ? fmtAge(c.createdAt) : '—';
              const img = c.image || null;
              const id = img ? null : identicon(addr, sym);
              return (
                <a
                  key={addr || sym}
                  href={addr ? `https://pump.fun/coin/${addr}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pf-row"
                >
                  <div className="pf-thumb" style={img ? { backgroundImage: `url(${img})` } : { background: id.bg }}>
                    {!img && <span>{id.letter}</span>}
                  </div>
                  <div className="pf-mid">
                    <div className="pf-line1">
                      <span className="pf-name">{name}</span>
                      {c.graduated && <span className="pf-grad">GRAD</span>}
                    </div>
                    <div className="pf-line2">
                      <span className="pf-ticker">{String(sym).toUpperCase().slice(0, 14)}</span>
                      <span className="pf-age">🌱 {age}</span>
                      {c.twitter && <span className="pf-soc">𝕏</span>}
                      {c.website && <span className="pf-soc">🌐</span>}
                    </div>
                    <div className="pf-line3">
                      <span className="pf-holders">👤 {holders != null ? fmtCount(holders) : '—'}</span>
                    </div>
                  </div>
                  <div className="pf-right">
                    <div className="pf-vmc"><span className="pf-v">V {fmtUsd(vol)}</span> <span className="pf-mc">MC {fmtUsd(mc)}</span></div>
                    <div className="pf-price">{fmtPrice(price)}</div>
                    <div className="pf-tx">TX {fmtCount(txns)}</div>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {err && coins.length > 0 && <div className="rc-note">{err}</div>}
      </div>
      <div className="rc-note">
        Live movers from pump.fun — the same feed the bot scans. Tap a row to open it on pump.fun.
      </div>
    </div>
  );
}
