// RESEARCH CENTER — whale wallet buy feed (REAL DATA).
// This tab NEVER touches trading. It shows what the tracked smart-money
// wallets are actually buying, fetched live from /api/whales.
// Synthesize hands findings to the trading bot when ready.
import { useEffect, useRef, useState } from 'react';
import { synthesizeResearch, fetchWhales, fetchWhaleBuys } from '../lib/api.js';

// The user's own wallet — tagged in the feed so their own buys stand out.
const USER_WALLET = 'BPabbM6hwqQxxfHt3rVKTN2K4NaU1jZY2GWuFj6ZCBv6';

function fmtMc(mc) {
  if (mc == null || !isFinite(mc)) return '—';
  if (mc >= 1e9) return '$' + (mc / 1e9).toFixed(2) + 'B';
  if (mc >= 1e6) return '$' + (mc / 1e6).toFixed(2) + 'M';
  if (mc >= 1e3) return '$' + (mc / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(mc);
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function useWhaleCanvas(ref, activity) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let W = 0, H = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = canvas.width = Math.max(300, Math.floor(r.width * 2));
      H = canvas.height = 760;
    };
    resize();
    window.addEventListener('resize', resize);

    // Wandering nodes, tinted by live whale activity.
    const nodes = [];
    for (let i = 0; i < 15; i++) {
      nodes.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0016,
        vy: (Math.random() - 0.5) * 0.0016,
        r: 5 + Math.random() * 5,
        pulse: Math.random() * Math.PI * 2,
      });
    }
    const color = '#2DD4BF';

    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy; n.pulse += 0.03;
        if (n.x < 0.02 || n.x > 0.98) n.vx *= -1;
        if (n.y < 0.04 || n.y > 0.96) n.vy *= -1;
        n.x = Math.min(0.98, Math.max(0.02, n.x));
        n.y = Math.min(0.96, Math.max(0.04, n.y));
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = (a.x - b.x) * W, dy = (a.y - b.y) * H;
          if (Math.hypot(dx, dy) < 260) {
            ctx.strokeStyle = color + '44';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x * W, a.y * H);
            ctx.lineTo(b.x * W, b.y * H);
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        const x = n.x * W, y = n.y * H;
        const glow = 10 + Math.sin(n.pulse) * 4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, glow * 2);
        g.addColorStop(0, color + 'aa');
        g.addColorStop(1, color + '00');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, glow * 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, n.r, 0, Math.PI * 2); ctx.fill();
      }
      if (activity > 0) {
        ctx.fillStyle = 'rgba(232,236,244,0.75)';
        ctx.font = '600 17px -apple-system, sans-serif';
        ctx.fillText('WHALE WATCH · ' + activity + ' buys tracked', 18, 30);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [ref, activity]);
}

function WhaleRow({ w, apiBase, expanded, onToggle }) {
  const [buys, setBuys] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (expanded) { onToggle(null); return; }
    onToggle(w.address);
    if (!buys && !loading) {
      setLoading(true);
      try {
        const d = await fetchWhaleBuys(apiBase, w.address);
        setBuys(d.buys || []);
      } catch {
        setBuys([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const isUser = w.address === USER_WALLET;
  const lb = w.lastBuy;

  return (
    <div className="rc-line" style={{ cursor: 'pointer' }} onClick={toggle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="lk whale">WHALE</span>
        <span style={{ fontWeight: 700, color: '#e8ecf4' }}>{w.short}</span>
        {isUser && <span className="lk" style={{ color: '#fbbf24', background: 'rgba(251,191,36,.12)' }}>YOU</span>}
        {w.buys24h > 0 && (
          <span style={{ fontSize: 10.5, color: '#2DD4BF' }}>{w.buys24h} buy{w.buys24h === 1 ? '' : 's'} / 24h</span>
        )}
        <span style={{ marginLeft: 'auto', color: '#8b93a7', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 12 }}>
        {w.pending ? (
          <span style={{ color: '#fbbf24' }}>syncing — first poll in progress…</span>
        ) : w.error ? (
          <span style={{ color: '#f87171' }}>feed error — retrying</span>
        ) : lb ? (
          <span>
            last buy <b style={{ color: '#e8ecf4' }}>{lb.symbol}</b>
            {' '}@ {fmtMc(lb.mc)}
            {' '}· {lb.solSpent > 0 ? lb.solSpent + ' SOL' : '—'}
            {' '}· <span className="lt">{timeAgo(lb.ts)}</span>
          </span>
        ) : (
          <span style={{ color: '#8b93a7' }}>no recent buys in window</span>
        )}
      </div>
      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 4 }}>
          {loading && <div style={{ color: '#8b93a7', fontSize: 12 }}>loading buy history…</div>}
          {!loading && buys && buys.length === 0 && (
            <div style={{ color: '#8b93a7', fontSize: 12 }}>no buys found</div>
          )}
          {!loading && buys && buys.map((b, i) => (
            <div key={b.sig || i} style={{ fontSize: 12, padding: '4px 0', borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
              <b style={{ color: '#e8ecf4' }}>{b.symbol}</b>
              {' '}@ {fmtMc(b.mc)}
              {' '}· {b.solSpent > 0 ? b.solSpent + ' SOL' : '—'}
              {' '}· <span className="lt">{timeAgo(b.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WhaleFeed({ apiBase, onStats }) {
  const [wallets, setWallets] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await fetchWhales(apiBase);
        if (!alive) return;
        setWallets(d.wallets || []);
        setUpdatedAt(d.ts || Date.now());
        setError(null);
        if (onStats) {
          const buys24h = (d.wallets || []).reduce((s, w) => s + (w.buys24h || 0), 0);
          onStats({ count: (d.wallets || []).length, buys24h });
        }
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'unavailable');
      }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [apiBase, onStats]);

  if (error && !wallets) {
    return <div className="rc-log"><div className="rc-line" style={{ color: '#f87171' }}>whale feed offline — {error}</div></div>;
  }
  if (!wallets) {
    return <div className="rc-log"><div className="rc-line" style={{ color: '#fbbf24' }}>syncing whale data…</div></div>;
  }
  // Sort: wallets with recent buys first.
  const sorted = [...wallets].sort((a, b) => {
    const at = (a.lastBuy && a.lastBuy.ts) || 0;
    const bt = (b.lastBuy && b.lastBuy.ts) || 0;
    return bt - at;
  });
  return (
    <div className="rc-log">
      {updatedAt && (
        <div className="rc-line" style={{ color: '#8b93a7', fontSize: 11 }}>
          live on-chain data · updated {timeAgo(updatedAt)} · tap a wallet for its buy history
        </div>
      )}
      {sorted.map(w => (
        <WhaleRow key={w.address} w={w} apiBase={apiBase}
          expanded={expanded === w.address}
          onToggle={setExpanded} />
      ))}
    </div>
  );
}

export default function ResearchCenter({ apiBase }) {
  const canvasRef = useRef(null);
  const [synthState, setSynthState] = useState('idle'); // idle | working | done | missing
  const [synthMsg, setSynthMsg] = useState('');
  const [synthData, setSynthData] = useState(null);
  const [stats, setStats] = useState({ count: 0, buys24h: 0 });
  const [feedLive, setFeedLive] = useState(false);
  useWhaleCanvas(canvasRef, stats.buys24h);

  const handleStats = (s) => { setStats(s); setFeedLive(true); };

  const doSynthesize = async () => {
    setSynthState('working');
    setSynthMsg('');
    setSynthData(null);
    try {
      const r = await synthesizeResearch(apiBase);
      setSynthData(r);
      setSynthState('done');
      const n = (r.tokens || []).length;
      setSynthMsg(n > 0
        ? `${n} token${n === 1 ? '' : 's'} with whale accumulation in the last 24h.`
        : 'No tokens with 2+ whale buys in the last 24h — research keeps collecting.');
    } catch (e) {
      setSynthState('missing');
      setSynthMsg('Synthesis failed: ' + (e.message || 'unavailable'));
    }
  };

  return (
    <>
      <div className="rc-stats">
        <div className="stat-card"><div className="k">Whale wallets</div><div className="v">{stats.count || '—'}</div><div className="s">tracked on-chain</div></div>
        <div className="stat-card"><div className="k">Buys (24h)</div><div className="v">{stats.buys24h}</div><div className="s">across tracked wallets</div></div>
        <div className="stat-card"><div className="k">Trading link</div><div className="v" style={{ color: '#34d399' }}>NONE</div><div className="s">isolated by design</div></div>
      </div>
      <div className="rc-grid">
        <div className="card rc-canvas-card">
          <canvas ref={canvasRef} style={{ height: 380 }} />
          <div className="rc-overlay">
            <span className="rc-badge"><span className="dot" style={{ background: feedLive ? '#2DD4BF' : '#fbbf24' }} /> {feedLive ? 'WHALE FEED LIVE' : 'WHALE FEED SYNCING'}</span>
            <span className="rc-badge">NO TRADING INTERACTION</span>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><span className="card-title">WHALE BUYS</span></div>
          <WhaleFeed apiBase={apiBase} onStats={handleStats} />
          <button className="synth-btn" disabled={synthState === 'working'} onClick={doSynthesize}>
            {synthState === 'working' ? 'SYNTHESIZING…' : '⟡ SYNTHESIZE FINDINGS'}
          </button>
          {synthMsg && <div className={'set-msg ' + (synthState === 'done' ? 'ok' : 'err')}>{synthMsg}</div>}
          {synthState === 'done' && synthData && (synthData.tokens || []).length > 0 && (
            <div className="rc-log" style={{ marginTop: 8 }}>
              {(synthData.tokens || []).map(t => (
                <div className="rc-line" key={t.mint} style={{ color: '#e6eaf2' }}>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>{t.symbol || '?'}</span>
                  {' '}· {fmtMc(t.mc)} ·{' '}
                  <span style={{ color: '#fbbf24' }}>{t.walletCount} wallets</span>
                  {' '}· {t.totalSol} SOL · last buy {timeAgo(t.lastBuyTs)}
                  <div style={{ color: '#8b93a7', fontSize: 11 }}>
                    {(t.wallets || []).map(w => w.short).join('  ')}
                  </div>
                </div>
              ))}
              {synthData.walletCoverage && (
                <div className="rc-line" style={{ color: '#8b93a7', fontSize: 11 }}>
                  scanned {synthData.walletCoverage.cachedWallets} wallets with cached data
                  ({synthData.walletCoverage.withData} with recent buys)
                </div>
              )}
            </div>
          )}
          <div className="rc-note">
            Real on-chain buys from tracked smart-money wallets. Read-only —
            it never touches the trading bot. When you decide there\u2019s enough,
            synthesize and the findings feed the bot\u2019s signal layer.
          </div>
        </div>
      </div>
    </>
  );
}
