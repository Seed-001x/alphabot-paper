// OPPORTUNITIES — live pump.fun movers feed.
// Shows the same coins the bot is looking at. Read-only: no trading actions.
// Polls /api/movers every 30s. Sorted by MC descending.
import { useCallback, useEffect, useState } from 'react';
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

function fmtHolders(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function fmtAge(ts) {
  if (!ts) return '—';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd';
}

export default function Opportunities() {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    const base = getBackendUrl();
    if (!base) { setErr('offline — set a backend URL in Settings'); setLoading(false); return; }
    try {
      const list = await fetchMovers(base);
      // sort by MC descending
      list.sort((a, b) => (b.usdMc || b.usd_market_cap || 0) - (a.usdMc || a.usd_market_cap || 0));
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

  return (
    <div className="col">
      <div className="card">
        <div className="card-head">
          <div className="card-title">OPPORTUNITIES <span className="n">· {coins.length}</span></div>
          <div className="tx-time">{updatedAt ? 'updated ' + fmtAge(updatedAt) + ' ago' : ''}</div>
        </div>

        {loading && <div className="empty">loading movers…</div>}

        {!loading && err && coins.length === 0 && (
          <div className="empty">{err}</div>
        )}

        {!loading && !err && coins.length === 0 && (
          <div className="empty">no movers right now — check back soon</div>
        )}

        {coins.length > 0 && (
          <div>
            {coins.map(c => {
              const mc = c.usdMc ?? c.usd_market_cap ?? c.market_cap_usd ?? null;
              const holders = c.holders ?? c.holderCount ?? null;
              const addr = c.address || c.mint || '';
              const sym = c.symbol || '???';
              const name = c.name || '';
              return (
                <a
                  key={addr || sym}
                  href={addr ? `https://pump.fun/coin/${addr}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opp-row"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="tok-ic">{String(sym).slice(0, 1).toUpperCase()}</div>
                  <div className="pos-main">
                    <div className="pos-sym">{sym}</div>
                    {name && name !== sym && <div className="pos-sub">{name}</div>}
                    <div className="pos-nums">
                      <div className="pos-kv">
                        <span className="k">MC</span>
                        <span className="v">{fmtMc(mc)}</span>
                      </div>
                      {holders != null && (
                        <div className="pos-kv">
                          <span className="k">Holders</span>
                          <span className="v">{fmtHolders(holders)}</span>
                        </div>
                      )}
                      {c.createdAt && (
                        <div className="pos-kv">
                          <span className="k">Age</span>
                          <span className="v">{fmtAge(c.createdAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="pos-side">
                    <span className="tx-kind buy">↗</span>
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
        Live movers from pump.fun — the same feed the bot scans. Tap a coin to open it on pump.fun.
      </div>
    </div>
  );
}
