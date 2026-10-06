// ALPHABOT v3.1 — THE FLOOR. Visualization layer ONLY, subscribe-only.
// Dense AI command-center: seat strip → isometric trading room → bottom
// telemetry. ZERO pipeline changes. Every number/chart/agent state reflects
// real pipeline data or real idle state — never faked.

import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeFloor } from '../lib/floorBus.js';
import { fmtUsd, fmtClock } from '../lib/paper.js';
import Equity from './Equity.jsx';
import { BrainReadout } from './BrainPanel.jsx';

// ------------------------------------------------------------ session stats
// One aggregator subscribing to floorBus. Everything downstream reads this.
const EMPTY = {
  scanned: 0, kills: 0, killsByPass: {}, scored: 0, entries: 0,
  scores: [], modifiers: [], lastMod: null, topScore: 0, topRunner: null,
  whale: null, buckets: [],
};

function useDeskStats() {
  const [s, setS] = useState(EMPTY);
  useEffect(() => {
    const onEv = (ev) => {
      setS(prev => {
        const next = { ...prev };
        switch (ev.type) {
          case 'scan.token': {
            next.scanned = prev.scanned + 1;
            const m = Math.floor(Date.now() / 60000);
            const b = prev.buckets.map(x => ({ ...x }));
            const last = b[b.length - 1];
            if (last && last.m === m) last.n += 1;
            else b.push({ m, n: 1 });
            next.buckets = b.slice(-24);
            break;
          }
          case 'vet.kill': {
            next.kills = prev.kills + 1;
            const p = ev.killPass || 'vet';
            next.killsByPass = { ...prev.killsByPass, [p]: (prev.killsByPass[p] || 0) + 1 };
            break;
          }
          case 'vet.scored': {
            next.scored = prev.scored + 1;
            next.scores = [...prev.scores, ev.score].slice(-40);
            if (ev.score > prev.topScore) {
              next.topScore = ev.score;
              next.topRunner = { symbol: ev.symbol, score: ev.score, ts: Date.now() };
            }
            break;
          }
          case 'research.done': {
            next.modifiers = [...prev.modifiers, ev.modifier || 0].slice(-14);
            next.lastMod = ev.modifier || 0;
            break;
          }
          case 'trade.enter':
            next.entries = prev.entries + 1;
            break;
          case 'dossier.ready':
            next.whale = {
              symbol: ev.symbol, devPct: ev.devPct, topPct: ev.topPct,
              top10Pct: ev.top10Pct, holderCount: ev.holderCount, rugged: ev.rugged,
            };
            break;
          default: break;
        }
        return next;
      });
    };
    return subscribeFloor(onEv);
  }, []);
  return s;
}

// ------------------------------------------------------------ tiny charts
function Spark({ vals, w = 66, h = 26, stroke = '#ff2bd6', fill = true, zero = false }) {
  const v = (vals || []).filter(x => x != null);
  if (v.length < 2) return <div className="fscr-empty">·</div>;
  const mn = Math.min(...v), mx = Math.max(...v);
  const span = mx - mn || 1;
  const X = i => (i / (v.length - 1)) * (w - 4) + 2;
  const Y = x => h - 3 - ((x - mn) / span) * (h - 8);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(' ');
  const zb = zero ? `M2,${Y(0).toFixed(1)} L${(w - 2).toFixed(1)},${Y(0).toFixed(1)}` : null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="fscr" preserveAspectRatio="none">
      {zb && <path d={zb} stroke="rgba(255,255,255,.18)" strokeWidth="1" />}
      {fill && <path d={`${d} L${X(v.length - 1).toFixed(1)},${h} L2,${h} Z`} fill={stroke} opacity="0.14" />}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <circle cx={X(v.length - 1)} cy={Y(v[v.length - 1])} r="2" fill={stroke} />
    </svg>
  );
}

function MiniBars({ vals, w = 66, h = 26, pos = '#3dff8f', neg = '#ff2e63', zero = false }) {
  const v = (vals || []).slice(-14);
  if (!v.length) return <div className="fscr-empty">·</div>;
  const mx = Math.max(1, ...v.map(x => Math.abs(x)));
  const bw = (w - 4) / v.length;
  const mid = zero ? h / 2 : h - 2;
  const sc = zero ? (h / 2 - 3) / mx : (h - 5) / mx;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="fscr" preserveAspectRatio="none">
      {zero && <line x1="2" y1={mid} x2={w - 2} y2={mid} stroke="rgba(255,255,255,.18)" strokeWidth="1" />}
      {v.map((x, i) => {
        const bh = Math.max(1.5, Math.abs(x) * sc);
        const y = x >= 0 ? mid - bh : mid;
        return <rect key={i} x={(2 + i * bw).toFixed(1)} y={y.toFixed(1)} width={Math.max(1, bw - 1.5).toFixed(1)} height={bh.toFixed(1)} fill={x >= 0 ? pos : neg} opacity="0.85" />;
      })}
    </svg>
  );
}

// ------------------------------------------------------------ robot
// Same SVG design language as before; arms animate only when .busy.
export function Robot({ color, small }) {
  return (
    <svg viewBox="0 0 60 78" width={small ? 26 : 34} height={small ? 34 : 44} className="frob">
      <line x1="30" y1="12" x2="30" y2="4" stroke={color} strokeWidth="2" />
      <circle cx="30" cy="4" r="2.6" fill={color} className="frob-ant" />
      <rect x="14" y="12" width="32" height="22" rx="7" fill="#0a0a10" stroke={color} strokeWidth="2" />
      <circle cx="24" cy="23" r="3" fill={color} className="frob-eye" />
      <circle cx="36" cy="23" r="3" fill={color} className="frob-eye" />
      <rect x="18" y="38" width="24" height="22" rx="6" fill="#0a0a10" stroke={color} strokeWidth="2" />
      <circle cx="30" cy="49" r="4" fill="none" stroke={color} strokeWidth="2" />
      <line className="ra-l" x1="18" y1="44" x2="10" y2="52" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line className="ra-r" x1="42" y1="44" x2="50" y2="52" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="24" y1="60" x2="24" y2="72" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="36" y1="60" x2="36" y2="72" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ------------------------------------------------------------ seat strip
const SEAT_META = [
  { id: 'scan', name: 'SCAN' },
  { id: 'vet', name: 'VET' },
  { id: 'research', name: 'RESEARCH' },
  { id: 'score', name: 'SCORE' },
  { id: 'trade', name: 'TRADE' },
  { id: 'risk', name: 'RISK' },
];

const EV_ACTIVE = {
  'cycle.start': 'scan', 'scan.token': 'scan', 'flow.inject': 'scan',
  'vet.kill': 'vet',
  'research.start': 'research', 'bread-start': 'research', 'bread-done': 'research',
  'bread-fail': 'research', 'hunt.start': 'research', 'hunt.done': 'research',
  'ledger.check': 'research', 'judge.done': 'research', 'dossier.ready': 'research',
  'research.done': 'research',
  'vet.scored': 'score',
  'trade.enter': 'trade', 'trade.skip': 'trade',
  'risk.exit': 'risk',
};

export function SeatStrip({ d, openCount }) {
  const [activeSeat, setActiveSeat] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    const u = subscribeFloor((ev) => {
      const id = EV_ACTIVE[ev.type];
      if (!id) return;
      setActiveSeat(id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setActiveSeat(null), 4000);
    });
    return () => { u(); clearTimeout(timer.current); };
  }, []);
  const cards = [
    { id: 'scan', val: String(d.scanned), sub: 'tokens' },
    { id: 'vet', val: String(d.kills), sub: `killed · ${d.scored} scored` },
    { id: 'research', val: d.lastMod == null ? '—' : (d.lastMod >= 0 ? '+' : '') + d.lastMod, sub: 'last modifier' },
    { id: 'score', val: d.topScore ? String(d.topScore) : '—', sub: 'top score' },
    { id: 'trade', val: String(d.entries), sub: 'paper entries' },
    { id: 'risk', val: String(openCount), sub: 'open' },
  ];
  return (
    <section className="seats" aria-label="seats">
      {cards.map(c => (
        <div key={c.id} className={'seat' + (activeSeat === c.id ? ' on' : '')}>
          <div className="seat-top"><i className={'sdot' + (activeSeat === c.id ? ' on' : '')} /><span className="seat-name">{c.id.toUpperCase()}</span></div>
          <div className="seat-val">{c.val}</div>
          <div className="seat-sub">{c.sub}</div>
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------ THE FLOOR v3.2
// Isometric trading room (2.5D CSS/SVG): back wall = live equity chart,
// TWO rows of workstation desks (3 front + 3 behind, isometric depth),
// FREE-ROAMING worker robots that walk to desks on real events, and a
// CROWNED TRADER throne at the far right. Delivery ritual: workers carry
// research dossiers to the trader ONLY for survivors; kills drop where
// they die and are never carried. Visualization layer ONLY — subscribe-only,
// zero pipeline changes. Every movement is triggered by real floorBus
// events or idle wander — never fake activity.
const DESKS = [
  { id: 'scan', name: 'SCAN', color: '#41e8ff', x: 0.08, y: 0.80, row: 'front' },
  { id: 'vet', name: 'VET', color: '#ff2bd6', x: 0.27, y: 0.80, row: 'front' },
  { id: 'research', name: 'RESEARCH', color: '#3dff8f', x: 0.46, y: 0.80, row: 'front' },
  { id: 'score', name: 'SCORE', color: '#ffb02e', x: 0.155, y: 0.42, row: 'back' },
  { id: 'trade', name: 'TRADE', color: '#ff7ae2', x: 0.345, y: 0.42, row: 'back' },
  { id: 'risk', name: 'RISK', color: '#ff2e63', x: 0.535, y: 0.42, row: 'back' },
];
const THRONE = { x: 0.865, y: 0.58 };
const STAGE_W = 1000, STAGE_H = 264;
const SEAT_OF = { scan: 0, vet: 1, research: 2, score: 3, trade: 4, risk: 5 };
const EV_SEAT = {
  'cycle.start': 'scan', 'scan.token': 'scan', 'flow.inject': 'scan',
  'vet.kill': 'vet',
  'research.start': 'research', 'bread-start': 'research', 'bread-done': 'research',
  'bread-fail': 'research', 'hunt.start': 'research', 'hunt.done': 'research',
  'ledger.check': 'research', 'judge.done': 'research', 'dossier.ready': 'research',
  'research.done': 'research',
  'vet.scored': 'score',
  'trade.enter': 'trade', 'trade.skip': 'trade',
  'risk.exit': 'risk',
};
const ACTIVE_MS = 4500;
const MAX_CHIPS = 10;
const MAX_DELIV = 3;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function DeskMonitor({ id, d, equityArr, positions, priceMap }) {
  switch (id) {
    case 'scan':
      return <Spark vals={d.buckets.map(b => b.n)} stroke="#41e8ff" />;
    case 'vet': {
      const k = d.kills, p = d.scored;
      const mx = Math.max(1, k, p);
      return (
        <div className="fscr-nums">
          <div className="fscr-bar"><i style={{ width: `${(k / mx) * 100}%`, background: '#ff2e63' }} /><span>{k}✕</span></div>
          <div className="fscr-bar"><i style={{ width: `${(p / mx) * 100}%`, background: '#3dff8f' }} /><span>{p}✓</span></div>
        </div>
      );
    }
    case 'research':
      return <MiniBars vals={d.modifiers} zero pos="#3dff8f" neg="#ff2e63" />;
    case 'score':
      return <MiniBars vals={d.scores} pos="#ffb02e" neg="#ffb02e" />;
    case 'trade': {
      const pts = (equityArr || []).slice(-48).map(p => p.v);
      return <Spark vals={pts} stroke="#ff7ae2" />;
    }
    case 'risk': {
      const pos = positions || [];
      if (!pos.length) return <div className="fscr-empty">0 open</div>;
      const pnls = pos.slice(0, 8).map(x => {
        const t = priceMap[x.mint];
        const cur = t && t.price ? x.tokens * t.price : x.sizeUsd;
        return cur - x.sizeUsd;
      });
      return <MiniBars vals={pnls} zero pos="#3dff8f" neg="#ff2e63" />;
    }
    default:
      return <div className="fscr-empty">·</div>;
  }
}

function WhaleRadar({ whale }) {
  if (!whale || (whale.devPct == null && whale.topPct == null)) {
    return <div className="fg-empty">awaiting dossier</div>;
  }
  const W = 84, c = W / 2;
  const r = (pct) => 6 + Math.min(1, (pct || 0) / 100) * (c - 8);
  const pt = (pct, ang) => {
    const rr = r(pct), a = (ang * Math.PI) / 180;
    return [c + rr * Math.cos(a), c - rr * Math.sin(a)];
  };
  const [dx, dy] = pt(whale.devPct, 90);
  const [tx, ty] = pt(whale.topPct, 210);
  const [ox, oy] = pt(whale.top10Pct, 330);
  const short = (a) => (a && a.length > 8 ? a.slice(0, 4) + '…' : a || '?');
  return (
    <svg viewBox={`0 0 ${W} ${W}`} className="fg-radar">
      {[14, 26, 38].map(rr => <circle key={rr} cx={c} cy={c} r={rr} fill="none" stroke="rgba(255,43,214,.22)" strokeWidth="1" />)}
      <line x1={c} y1="4" x2={c} y2={W - 4} stroke="rgba(255,43,214,.14)" />
      <line x1="4" y1={c} x2={W - 4} y2={c} stroke="rgba(255,43,214,.14)" />
      <circle cx={dx.toFixed(1)} cy={dy.toFixed(1)} r="3.4" fill="#ff2e63"><title>dev {whale.devPct?.toFixed(1)}%</title></circle>
      <circle cx={tx.toFixed(1)} cy={ty.toFixed(1)} r="3.4" fill="#ffb02e"><title>top {whale.topPct?.toFixed(1)}%</title></circle>
      <circle cx={ox.toFixed(1)} cy={oy.toFixed(1)} r="3.4" fill="#41e8ff"><title>top10 {whale.top10Pct?.toFixed(1)}%</title></circle>
      <text x={c} y={W - 2} textAnchor="middle" fill="#a07fae" fontSize="7">{short(whale.symbol)}</text>
    </svg>
  );
}

function CrownedRobot() {
  return (
    <span className="fcrown-wrap">
      <svg viewBox="0 0 60 30" width="30" height="15" className="fcrown">
        <path d="M14,26 L18,8 L26,17 L32,4 L38,17 L46,8 L50,26 Z" fill="#ffd166" stroke="#b8860b" strokeWidth="1.6" />
        <circle cx="18" cy="8" r="2" fill="#ff2bd6" /><circle cx="32" cy="4" r="2" fill="#ff2bd6" /><circle cx="46" cy="8" r="2" fill="#ff2bd6" />
        <rect x="14" y="24" width="36" height="4" rx="2" fill="#b8860b" />
      </svg>
      <Robot color="#ffd166" small />
    </span>
  );
}

export function TheFloor({ d, equityArr, bankroll0, positions, priceMap, stats, now }) {
  const [active, setActive] = useState({ id: null, ts: 0, exit: false });
  const [chips, setChips] = useState([]);
  const [delivs, setDelivs] = useState([]); // {mint, symbol, phase: fetch|carry|review|exec|waveoff}
  const [trader, setTrader] = useState({ mode: 'idle' }); // idle|exec|wave
  const [popWorker, setPopWorker] = useState(null);
  const [tickNow, setTickNow] = useState(Date.now());
  const [, setTick] = useState(0);
  const stageRef = useRef(null);
  const [stagePx, setStagePx] = useState({ w: STAGE_W, h: STAGE_H });
  const sizeRef = useRef({ w: STAGE_W, h: STAGE_H });
  const agentsRef = useRef(null);
  const chipTimers = useRef(new Map());

  // ---- stage measurement
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = { w: el.clientWidth || STAGE_W, h: el.clientHeight || STAGE_H };
      sizeRef.current = s;
      setStagePx(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const deskPx = (id) => {
    const dk = DESKS.find(k => k.id === id);
    const s = sizeRef.current;
    return { x: dk.x * s.w, y: dk.y * s.h };
  };
  const thronePx = () => ({ x: THRONE.x * sizeRef.current.w, y: THRONE.y * sizeRef.current.h });
  const chipXY = (st) => {
    const dk = DESKS[clamp(st, 0, 5)];
    return { x: dk.x, y: Math.max(0.06, dk.y - 0.19) };
  };

  // ---- chips (token flow across desks; kills drop where they die)
  const addChip = (mint, symbol, flow, st) => {
    const p = chipXY(st || 0);
    setChips(prev => {
      if (prev.some(c => c.mint === mint)) return prev;
      return [...prev, { mint, symbol: (symbol || '???').slice(0, 6), x: p.x, y: p.y, st: st || 0, state: 'run', flow: !!flow }].slice(-MAX_CHIPS);
    });
  };
  const advanceChip = (mint, toSt) => {
    const p = chipXY(toSt);
    setChips(prev => prev.map(c => (c.mint === mint && c.state === 'run' ? { ...c, st: toSt, x: p.x, y: p.y } : c)));
  };
  const dropChip = (mint) => {
    setChips(prev => prev.map(c => (c.mint === mint ? { ...c, state: 'dying' } : c)));
    const t = setTimeout(() => {
      setChips(prev => prev.filter(c => c.mint !== mint));
      chipTimers.current.delete(mint);
    }, 1200);
    chipTimers.current.set(mint, t);
  };
  const finishChip = (mint, ok) => {
    setChips(prev => prev.map(c => (c.mint === mint ? { ...c, state: ok ? 'done' : 'gone' } : c)));
    const t = setTimeout(() => {
      setChips(prev => prev.filter(c => c.mint !== mint));
      chipTimers.current.delete(mint);
    }, ok ? 1800 : 800);
    chipTimers.current.set(mint, t);
  };
  const removeChip = (mint) => setChips(prev => prev.filter(c => c.mint !== mint));

  // ---- worker steering (rAF, stage-local px)
  const pickWander = (a) => {
    const s = sizeRef.current;
    a.tx = rnd(50, s.w - 50); a.ty = rnd(56, s.h - 26);
    a.speed = rnd(34, 62); a.mode = 'wander'; a.task = 'wandering';
    a.carry = null; a.onArrive = null; a.busyUntil = 0;
  };
  const stepAgent = (a, dt, now) => {
    const s = sizeRef.current;
    if (a.mode === 'work' && now > a.busyUntil) { pickWander(a); return true; }
    if (a.mode === 'pause') {
      if (now >= a.pauseUntil) { pickWander(a); return true; }
      return false;
    }
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 7) {
      const cb = a.onArrive; a.onArrive = null;
      if (cb) { cb(a); return true; }
      if (a.mode === 'wander') { a.mode = 'pause'; a.pauseUntil = now + rnd(900, 2600); a.task = 'looking around'; return true; }
      return false;
    }
    const step = a.speed * dt;
    a.x += (dx / dist) * Math.min(step, dist);
    a.y += (dy / dist) * Math.min(step, dist);
    const f = dx < -3 ? -1 : dx > 3 ? 1 : a.flip;
    if (f !== a.flip) { a.flip = f; return true; }
    return true;
  };
  const nearestIdleWorker = (x, y) => {
    const list = (agentsRef.current || []).filter(a => a.mode === 'wander' || a.mode === 'pause');
    if (!list.length) return null;
    return list.sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0];
  };

  useEffect(() => {
    if (!agentsRef.current) {
      const s = sizeRef.current;
      agentsRef.current = DESKS.map(dk => {
        const a = {
          id: dk.id, color: dk.color, name: dk.name,
          x: rnd(60, s.w - 60), y: rnd(60, s.h - 30),
          tx: 0, ty: 0, speed: 48, mode: 'wander',
          busyUntil: 0, carry: null, onArrive: null,
          task: 'wandering', pauseUntil: 0, flip: 1,
          stats: { handled: 0, carried: 0 },
        };
        return a;
      });
      agentsRef.current.forEach(a => pickWander(a));
    }
    let raf, last = performance.now(), lastTick = 0;
    const loop = (now) => {
      const dt = Math.min(0.06, (now - last) / 1000); last = now;
      let moved = false;
      for (const a of agentsRef.current) if (stepAgent(a, dt, now)) moved = true;
      if (moved && now - lastTick > 40) { lastTick = now; setTick(t => t + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- delivery ritual (real events only)
  const startDelivery = (mint, symbol) => {
    const sym = (symbol || '???').slice(0, 6);
    let started = false;
    setDelivs(prev => {
      const active = prev.filter(x => x.phase === 'fetch' || x.phase === 'carry' || x.phase === 'review');
      if (prev.some(x => x.mint === mint) || active.length >= MAX_DELIV) return prev;
      started = true;
      return [...prev, { mint, symbol: sym, phase: 'fetch' }];
    });
    if (!started) return;
    const sp = deskPx('score');
    const w = nearestIdleWorker(sp.x, sp.y);
    if (!w) {
      // no idle worker: dossier appears at the throne directly
      setDelivs(prev => prev.map(x => x.mint === mint ? { ...x, phase: 'review' } : x));
      staleDelivery(mint);
      return;
    }
    w.mode = 'fetch'; w.tx = sp.x; w.ty = sp.y + 30; w.speed = 135;
    w.task = `fetching ${sym}`; w.stats.handled++;
    w.onArrive = (ag) => {
      removeChip(mint); // worker picks up the research
      ag.carry = { mint, symbol: sym };
      ag.stats.carried++;
      ag.mode = 'deliver'; ag.speed = 120;
      const tp = thronePx();
      ag.tx = tp.x - 60; ag.ty = tp.y + 10; ag.task = `delivering ${sym} to trader`;
      setDelivs(prev => prev.map(x => x.mint === mint ? { ...x, phase: 'carry' } : x));
      ag.onArrive = (ag2) => {
        ag2.carry = null;
        setDelivs(prev => prev.map(x => x.mint === mint ? { ...x, phase: 'review' } : x));
        pickWander(ag2);
      };
    };
    staleDelivery(mint);
  };
  const staleDelivery = (mint) => {
    setTimeout(() => {
      setDelivs(prev => {
        const d = prev.find(x => x.mint === mint);
        if (d && (d.phase === 'fetch' || d.phase === 'carry' || d.phase === 'review')) {
          return prev.filter(x => x.mint !== mint);
        }
        return prev;
      });
    }, 120000);
  };
  const killDelivery = (mint) => {
    setDelivs(prev => prev.filter(x => x.mint !== mint));
    for (const a of (agentsRef.current || [])) {
      if (a.carry && a.carry.mint === mint) { a.carry = null; pickWander(a); }
    }
  };
  const execDelivery = (mint) => {
    setDelivs(prev => prev.map(x => x.mint === mint ? { ...x, phase: 'exec' } : x));
    setTrader({ mode: 'exec' });
    setTimeout(() => {
      setDelivs(prev => prev.filter(x => x.mint !== mint));
      setTrader({ mode: 'idle' });
    }, 1800);
  };
  const waveDelivery = (mint) => {
    setDelivs(prev => prev.map(x => x.mint === mint ? { ...x, phase: 'waveoff' } : x));
    setTrader({ mode: 'wave' });
    setTimeout(() => {
      setDelivs(prev => prev.filter(x => x.mint !== mint));
      setTrader({ mode: 'idle' });
    }, 1800);
  };

  // ---- floorBus subscription
  useEffect(() => {
    const onEv = (ev) => {
      const seatId = EV_SEAT[ev.type];
      if (seatId) {
        setActive({ id: seatId, ts: Date.now(), exit: ev.type === 'risk.exit' });
        const wi = SEAT_OF[seatId];
        const w = agentsRef.current && agentsRef.current[wi];
        if (w && (w.mode === 'wander' || w.mode === 'pause' || w.mode === 'work')) {
          const p = deskPx(seatId);
          w.mode = 'work'; w.tx = p.x; w.ty = p.y + 34; w.speed = 150;
          w.busyUntil = Date.now() + ACTIVE_MS; w.task = `working ${seatId}`;
          w.stats.handled++;
        }
      }
      const mint = ev.mint;
      switch (ev.type) {
        case 'scan.token': if (mint) addChip(mint, ev.symbol, ev.flow, 0); break;
        case 'flow.inject': if (mint) addChip(mint, ev.symbol, true, 0); break;
        case 'research.start': case 'bread-start': case 'hunt.start': case 'dossier.ready':
          if (mint) advanceChip(mint, 2); break;
        case 'vet.scored': case 'judge.done': case 'research.done': case 'ledger.check':
          if (mint) advanceChip(mint, 3); break;
        case 'vet.kill': if (mint) { dropChip(mint); killDelivery(mint); } break;
        case 'trade.enter': if (mint) { finishChip(mint, true); execDelivery(mint); } break;
        case 'trade.skip': if (mint) { finishChip(mint, false); waveDelivery(mint); } break;
        default: break;
      }
    };
    const u = subscribeFloor(onEv);
    const t = setInterval(() => setTickNow(Date.now()), 2000);
    return () => { u(); clearInterval(t); };
  }, []);

  // delivery trigger: a scored token = survived research → worker fetches it
  useEffect(() => {
    const onScored = (ev) => { if (ev.mint) startDelivery(ev.mint, ev.symbol); };
    // subscribe separately so delivery logic stays isolated
    const u = subscribeFloor((ev) => { if (ev.type === 'vet.scored') onScored(ev); });
    return u;
  }, []);

  const activeId = tickNow - active.ts < ACTIVE_MS ? active.id : null;
  const eqUp = (equityArr && equityArr.length > 1)
    ? equityArr[equityArr.length - 1].v >= (bankroll0 || 0) : true;
  const agents = agentsRef.current || [];
  const reviewD = delivs.filter(x => x.phase === 'review');

  return (
    <section className="fl" aria-label="trading floor">
      <div className="fl-grid">
        <div className="fl-room">
          <div className="fl-wall">
            <div className="fl-wall-tag"><span>BALANCE · LIVE</span><b className={eqUp ? 'grn' : 'red'}>{fmtUsd(stats.equity)}</b></div>
            <Equity points={equityArr} bankroll0={bankroll0} />
          </div>
          <div className="fl-pan">
            <div className="fl-stage" ref={stageRef}>
              {DESKS.map(dk => {
                const busy = activeId === dk.id;
                return (
                  <div key={dk.id}
                    className={'fdesk' + (dk.row === 'back' ? ' back' : '') + (busy ? ' on' : '') + (busy && active.exit ? ' exit' : '')}
                    style={{ left: (dk.x * 100) + '%', top: (dk.y * 100) + '%' }}>
                    <div className={'fdesk-mon' + (busy ? ' busy' : '')}>
                      <div className="fdesk-scr">
                        <DeskMonitor id={dk.id} d={d} equityArr={equityArr} positions={positions} priceMap={priceMap} />
                      </div>
                    </div>
                    <div className="fdesk-stand" />
                    <div className="fdesk-top" />
                    <div className="fdesk-front" />
                    <div className="fdesk-name">{dk.name}</div>
                  </div>
                );
              })}
              {/* crowned trader throne — far right */}
              <div className="fthrone" style={{ left: (THRONE.x * 100) + '%', top: (THRONE.y * 100) + '%' }}>
                <div className={'ftrader ' + trader.mode}>
                  <CrownedRobot />
                </div>
                <div className={'fdesk-mon throne-mon' + (trader.mode !== 'idle' ? ' busy' : '')}>
                  <div className="fdesk-scr">
                    <DeskMonitor id="trade" d={d} equityArr={equityArr} positions={positions} priceMap={priceMap} />
                  </div>
                </div>
                <BrainReadout />
                <div className="fdesk-stand" />
                <div className="fdesk-top" />
                <div className="fdesk-front" />
                <div className="fdesk-name">👑 TRADER</div>
                {reviewD.map(x => (
                  <div key={x.mint} className="freview">◈ {x.symbol} · under review</div>
                ))}
                {delivs.filter(x => x.phase === 'exec').map(x => (
                  <div key={x.mint} className="freview exec">◈ {x.symbol} · EXECUTED</div>
                ))}
                {delivs.filter(x => x.phase === 'waveoff').map(x => (
                  <div key={x.mint} className="freview wave">◈ {x.symbol} · passed</div>
                ))}
              </div>
              {/* free-roaming workers */}
              {agents.map(a => (
                <div key={a.id}
                  className={'fagent' + (a.mode === 'work' ? ' busy' : '')}
                  style={{ transform: `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)` }}
                  onClick={() => setPopWorker(a)}>
                  <span className="fagent-in" style={{ transform: `scaleX(${a.flip})` }}>
                    <Robot color={a.color} small />
                  </span>
                  {a.carry && <span className="fagent-carry">◈ {a.carry.symbol}</span>}
                </div>
              ))}
              {chips.map(c => (
                <div key={c.mint}
                  className={'fl-chip' + (c.state === 'dying' ? ' dying' : c.state === 'done' ? ' done' : c.state === 'gone' ? ' gone' : '') + (c.flow ? ' flow' : '')}
                  style={{ left: (c.x * 100) + '%', top: (c.y * 100) + '%' }}>
                  {c.state === 'dying' ? '✕' : c.symbol}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="fl-rail">
          <div className="fg">
            <div className="fg-label">LOCAL TIME</div>
            <div className="fg-val">{fmtClock(now)}</div>
          </div>
          <div className="fg">
            <div className="fg-label">KILL COUNTER</div>
            <div className="fg-val red">{d.kills}</div>
            <div className="fg-sub">{d.scored} passed</div>
          </div>
          <div className="fg">
            <div className="fg-label">TOP RUNNER</div>
            <div className="fg-val mag">{d.topRunner ? d.topRunner.symbol.slice(0, 8) : '—'}</div>
            <div className="fg-sub">{d.topRunner ? `score ${d.topRunner.score}` : 'awaiting scores'}</div>
          </div>
          <div className="fg">
            <div className="fg-label">WHALE RADAR</div>
            <WhaleRadar whale={d.whale} />
            <div className="fg-sub"><i className="fg-k" style={{ background: '#ff2e63' }} />dev <i className="fg-k" style={{ background: '#ffb02e' }} />top <i className="fg-k" style={{ background: '#41e8ff' }} />top10</div>
          </div>
        </div>
      </div>
      {popWorker && (
        <div className="af-pop" onClick={() => setPopWorker(null)}>
          <div className="af-popcard" onClick={(e) => e.stopPropagation()}>
            <div className="af-pophead">
              <b style={{ color: popWorker.color }}>{popWorker.name}</b>
              <span className="af-mono dim">floor worker · this session</span>
              <button className="af-x-btn" onClick={() => setPopWorker(null)}>✕</button>
            </div>
            <div className="af-srow"><span>task</span><b>{popWorker.task}</b></div>
            <div className="af-srow"><span>tokens handled</span><b>{popWorker.stats.handled}</b></div>
            <div className="af-srow"><span>deliveries</span><b>{popWorker.stats.carried}</b></div>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------ bottom telemetry
export function BottomPanels({ d, equityArr, bankroll0 }) {
  const passes = ['free', 'trade', 'rug'];
  const kb = passes.map(p => ({ p, n: d.killsByPass[p] || 0 }));
  const kbMax = Math.max(1, ...kb.map(x => x.n));
  const bins = new Array(10).fill(0);
  for (const s of d.scores) bins[Math.min(9, Math.floor(s / 10))] += 1;
  const bMax = Math.max(1, ...bins);
  const scanBars = d.buckets.slice(-20).map(b => b.n);

  return (
    <section className="fl-bottom">
      <div className="fbp">
        <div className="fbp-head"><span>EQUITY · SCAN RATE</span></div>
        <div className="fbp-eq"><Equity points={equityArr} bankroll0={bankroll0} /></div>
        <div className="fbp-scanbars">
          {scanBars.length ? scanBars.map((n, i) => (
            <i key={i} style={{ height: `${Math.max(6, (n / Math.max(1, ...scanBars)) * 100)}%` }} />
          )) : <span className="dim">scan rate builds…</span>}
        </div>
      </div>
      <div className="fbp">
        <div className="fbp-head"><span>KILL BREAKDOWN</span><b className="red">{d.kills}</b></div>
        <div className="fbp-rows">
          {kb.map(x => (
            <div className="fbp-row" key={x.p}>
              <span className="fbp-k">{x.p.toUpperCase()}</span>
              <div className="fbp-track"><i style={{ width: `${(x.n / kbMax) * 100}%` }} /></div>
              <b>{x.n}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="fbp">
        <div className="fbp-head"><span>SCORE DISTRIBUTION</span><b>{d.scored}</b></div>
        <div className="fbp-hist">
          {bins.map((n, i) => (
            <div className="fbp-hcol" key={i} title={`${i * 10}-${i * 10 + 9}: ${n}`}>
              <i style={{ height: `${(n / bMax) * 100}%` }} />
              <span>{i === 0 ? '0' : `${i * 10}`}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export { useDeskStats };
