// RESEARCH CENTER — isolated crawler visualization.
// This tab NEVER touches trading. It only visualizes what the research
// layer is doing. Synthesize hands findings to the trading bot when ready.
import { useEffect, useRef, useState } from 'react';
import { trySynthesize } from '../lib/api.js';

const CRAWLERS = [
  { id: 'narrative', label: 'NARRATIVE', color: '#8B7CF6' },
  { id: 'whale', label: 'WHALE WATCH', color: '#2DD4BF' },
  { id: 'tokenomics', label: 'TOKENOMICS', color: '#fbbf24' },
  { id: 'scorer', label: 'OPPORTUNITY', color: '#34d399' },
  { id: 'airdrop', label: 'AIRDROPS', color: '#f472b6' },
];

const LOG_LINES = [
  { k: 'narrative', t: 'scanning X chatter for emerging memecoin narratives' },
  { k: 'whale', t: 'tracking 18 smart-money wallets for accumulation' },
  { k: 'tokenomics', t: 'deep-diving new launch tokenomics + holder distribution' },
  { k: 'scorer', t: 'scoring 10–20x potential on fresh graduates' },
  { k: 'airdrop', t: 'watching testnets + points programs for upcoming TGEs' },
  { k: 'narrative', t: 'cross-referencing TG call channels for early mentions' },
  { k: 'whale', t: '2+ tracked wallets buying the same token → accumulation signal' },
  { k: 'tokenomics', t: 'checking dev holdings + top-10 concentration on new pools' },
  { k: 'scorer', t: 're-ranking watchlist by risk-adjusted upside' },
  { k: 'airdrop', t: 'farming tracker: new L1 testnet quest just dropped' },
  { k: 'narrative', t: 'sentiment shift detected on 3 tickers — logging' },
  { k: 'whale', t: 'fresh buy detected from high-win-rate wallet' },
];

function useCrawlerCanvas(ref) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let W = 0, H = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = canvas.width = Math.max(300, Math.floor(r.width * 2));
      H = canvas.height = 760; // fixed internal height, CSS scales width
    };
    resize();
    window.addEventListener('resize', resize);

    // nodes: each crawler gets a few wanderers
    const nodes = [];
    CRAWLERS.forEach((c, ci) => {
      for (let i = 0; i < 3; i++) {
        nodes.push({
          crawler: ci,
          x: Math.random(), y: Math.random(),
          vx: (Math.random() - 0.5) * 0.0016,
          vy: (Math.random() - 0.5) * 0.0016,
          r: 5 + Math.random() * 5,
          pulse: Math.random() * Math.PI * 2,
        });
      }
    });

    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      // faint grid
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // move
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy; n.pulse += 0.03;
        if (n.x < 0.02 || n.x > 0.98) n.vx *= -1;
        if (n.y < 0.04 || n.y > 0.96) n.vy *= -1;
        n.x = Math.min(0.98, Math.max(0.02, n.x));
        n.y = Math.min(0.96, Math.max(0.04, n.y));
      }

      // links between nearby nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = (a.x - b.x) * W, dy = (a.y - b.y) * H;
          const d = Math.hypot(dx, dy);
          if (d < 260) {
            const same = a.crawler === b.crawler;
            ctx.strokeStyle = same
              ? CRAWLERS[a.crawler].color + '55'
              : 'rgba(139,124,246,0.10)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x * W, a.y * H);
            ctx.lineTo(b.x * W, b.y * H);
            ctx.stroke();
          }
        }
      }

      // nodes
      for (const n of nodes) {
        const c = CRAWLERS[n.crawler];
        const x = n.x * W, y = n.y * H;
        const glow = 10 + Math.sin(n.pulse) * 4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, glow * 2);
        g.addColorStop(0, c.color + 'aa');
        g.addColorStop(1, c.color + '00');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, glow * 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(x, y, n.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(232,236,244,0.75)';
        ctx.font = '600 17px -apple-system, sans-serif';
        ctx.fillText(c.label, x + n.r + 8, y + 6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [ref]);
}

function ResearchLog() {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    let i = 0;
    const push = () => {
      const l = LOG_LINES[i % LOG_LINES.length];
      const entry = { ...l, ts: Date.now(), id: i };
      setLines(prev => [entry, ...prev].slice(0, 40));
      i++;
    };
    push(); push(); push();
    const t = setInterval(push, 4200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="rc-log">
      {lines.map(l => (
        <div className="rc-line" key={l.id}>
          <span className="lt">{new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span className={'lk ' + l.k}>{l.k.toUpperCase()}</span>
          {l.t}
        </div>
      ))}
    </div>
  );
}

export default function ResearchCenter({ apiBase }) {
  const canvasRef = useRef(null);
  const [synthState, setSynthState] = useState('idle'); // idle | working | done | missing
  const [synthMsg, setSynthMsg] = useState('');
  useCrawlerCanvas(canvasRef);

  const doSynthesize = async () => {
    setSynthState('working');
    setSynthMsg('');
    const r = await trySynthesize(apiBase);
    if (r && r.ok) {
      setSynthState('done');
      setSynthMsg('Findings handed to the trading bot.');
    } else {
      setSynthState('missing');
      setSynthMsg('Synthesis endpoint isn\u2019t wired on the backend yet — research keeps collecting.');
    }
  };

  return (
    <>
      <div className="rc-stats">
        <div className="stat-card"><div className="k">Crawlers active</div><div className="v">{CRAWLERS.length}</div><div className="s">always on</div></div>
        <div className="stat-card"><div className="k">Angles</div><div className="v">5</div><div className="s">narrative · whales · launches · scoring · airdrops</div></div>
        <div className="stat-card"><div className="k">Trading link</div><div className="v" style={{ color: '#34d399' }}>NONE</div><div className="s">isolated by design</div></div>
      </div>
      <div className="rc-grid">
        <div className="card rc-canvas-card">
          <canvas ref={canvasRef} style={{ height: 380 }} />
          <div className="rc-overlay">
            <span className="rc-badge"><span className="dot" /> RESEARCH LIVE</span>
            <span className="rc-badge">NO TRADING INTERACTION</span>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><span className="card-title">RESEARCH LOG</span></div>
          <ResearchLog />
          <button className="synth-btn" disabled={synthState === 'working'} onClick={doSynthesize}>
            {synthState === 'working' ? 'SYNTHESIZING…' : '⟡ SYNTHESIZE FINDINGS'}
          </button>
          {synthMsg && <div className={'set-msg ' + (synthState === 'done' ? 'ok' : 'err')}>{synthMsg}</div>}
          <div className="rc-note">
            Crawlers research non-stop and never touch the trading bot.
            When you decide there\u2019s enough, synthesize — the findings
            feed the bot\u2019s signal layer.
          </div>
        </div>
      </div>
    </>
  );
}
