// ROAMERS — free-roaming agents overlay.
// Four little SVG robots wander the ENTIRE viewport (not confined to the
// Agent Floor panel), reacting to REAL floorBus pipeline events. Subscribe
// only — never emits into the pipeline, never touches pipeline logic.
// Purely visual: fixed layer is pointer-events:none (each agent tappable),
// transform-only rAF movement, loop paused when tab hidden. No events =
// idle wandering, never fake activity.

import { useEffect, useReducer, useRef, useState } from 'react';
import { subscribeFloor } from '../lib/floorBus.js';

const DEFS = [
  { id: 'bolt', name: 'Bolt', color: '#41e8ff' },
  { id: 'nib', name: 'Nibbles', color: '#ff2bd6' },
  { id: 'sprock', name: 'Sprocket', color: '#3dff8f' },
  { id: 'pip', name: 'Pip', color: '#ffb02e' },
];
const PAD = 26;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const vw = () => window.innerWidth;
const vh = () => window.innerHeight;
const spd = () => (window.innerWidth <= 760 ? 0.65 : 1);
const sym6 = (s) => (s || '???').slice(0, 6);

function seatCenter(idx) {
  try {
    const seats = document.querySelectorAll('.seats .seat');
    if (seats[idx]) {
      const r = seats[idx].getBoundingClientRect();
      return {
        x: clamp(r.left + r.width / 2, PAD + 50, vw() - PAD - 50),
        y: clamp(r.top + r.height + 26, PAD + 40, vh() - PAD - 40),
      };
    }
  } catch { /* fall through */ }
  return { x: vw() / 2, y: 150 };
}

function freshAgent(def, i) {
  return {
    ...def,
    x: rnd(PAD, Math.max(PAD + 1, vw() - PAD)),
    y: rnd(vh() * 0.25, Math.max(vh() * 0.3, vh() - PAD)),
    tx: 0, ty: 0, speed: 40,
    state: 'wander', // wander | pause | busy
    anim: '', animKey: 0, flip: 1, task: 'wandering',
    carry: null, carryFade: false,
    holdUntil: 0, onArrive: null, stateAt: 0, maxDur: 0,
    pauseUntil: 0, inspecting: false,
    stats: { handled: 0, kills: 0, buys: 0 },
  };
}

// ------------------------------------------------------------ steering
function pickWander(a) {
  a.tx = rnd(PAD, Math.max(PAD + 1, vw() - PAD));
  a.ty = rnd(PAD, Math.max(PAD + 1, vh() - PAD));
  a.speed = rnd(26, 52) * spd();
  a.state = 'wander'; a.anim = ''; a.task = 'wandering';
  a.carry = null; a.carryFade = false; a.inspecting = false;
  a.holdUntil = 0; a.onArrive = null; a.maxDur = 0;
}
function toWander(a) { pickWander(a); }
function goPause(a) {
  a.state = 'pause'; a.anim = ''; a.task = 'looking around';
  a.pauseUntil = performance.now() + rnd(900, 2600);
  a.onArrive = null;
}
function sendTo(a, x, y, speed, task, anim) {
  a.tx = clamp(x, PAD, Math.max(PAD + 1, vw() - PAD));
  a.ty = clamp(y, PAD, Math.max(PAD + 1, vh() - PAD));
  a.speed = speed * spd();
  a.state = 'busy'; a.anim = anim || ''; a.task = task;
  a.stateAt = performance.now(); a.maxDur = 25000;
}
function holdAnim(a, anim, ms, next) {
  a.anim = anim; a.animKey++;
  a.holdUntil = performance.now() + ms;
  a.onArrive = next || null;
}

function stepAgent(a, dt, now) {
  if (a.state === 'busy' && a.maxDur && now - a.stateAt > a.maxDur) { toWander(a); return true; }
  if (a.state === 'pause') {
    if (now >= a.pauseUntil) { pickWander(a); return true; }
    return false;
  }
  if (a.holdUntil) {
    if (now >= a.holdUntil) {
      const cb = a.onArrive; a.onArrive = null; a.holdUntil = 0;
      if (cb) { cb(a); return true; }
    }
    return false;
  }
  const dx = a.tx - a.x, dy = a.ty - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 5) {
    const cb = a.onArrive; a.onArrive = null;
    if (cb) { cb(a); return true; }
    if (a.state === 'wander') { goPause(a); return true; }
    return false;
  }
  const step = a.speed * dt;
  a.x += (dx / dist) * Math.min(step, dist);
  a.y += (dy / dist) * Math.min(step, dist);
  const wantFlip = dx < -2 ? -1 : dx > 2 ? 1 : a.flip;
  if (wantFlip !== a.flip) { a.flip = wantFlip; return true; }
  return false;
}

// ------------------------------------------------------------ events
function handleEvent(ev, agents, queueDirty) {
  const idle = () => agents.filter(a => a.state === 'wander' || a.state === 'pause');
  const nearestIdle = (x, y) => {
    const list = idle();
    if (!list.length) return null;
    return list.sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0];
  };
  const now = performance.now();
  switch (ev.type) {
    case 'scan.token': {
      const a = nearestIdle(rnd(0, vw()), 100);
      if (!a) return;
      const sym = sym6(ev.symbol);
      sendTo(a, rnd(40, vw() - 40), rnd(56, 150), 250, `catching ${sym}`, '');
      a.stats.handled++;
      a.onArrive = (ag) => holdAnim(ag, 'rm-hop', 850, (ag2) => toWander(ag2));
      queueDirty();
      break;
    }
    case 'vet.kill': {
      const a = nearestIdle(vw() / 2, vh() * 0.4);
      if (!a) return;
      const sym = sym6(ev.symbol);
      sendTo(a, a.x + rnd(-170, 170), a.y + rnd(-130, 40), 210, `stomping ${sym}`, '');
      a.stats.handled++; a.stats.kills++;
      a.onArrive = (ag) => holdAnim(ag, 'rm-squash', 450, (ag2) => {
        ag2.carry = { type: 'kill', label: sym };
        ag2.task = 'dragging kill away';
        sendTo(ag2, ag2.x + rnd(-60, 60), vh() - 74, 95, 'dragging kill away', '');
        ag2.onArrive = (ag3) => {
          ag3.carryFade = true;
          holdAnim(ag3, '', 550, (ag4) => { ag4.carry = null; ag4.carryFade = false; toWander(ag4); });
        };
      });
      queueDirty();
      break;
    }
    case 'research.start': {
      const c = seatCenter(2);
      const list = idle()
        .sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))
        .slice(0, 2);
      if (!list.length) return;
      list.forEach((a, i) => {
        sendTo(a, c.x + (i === 0 ? -46 : 46), c.y + rnd(-8, 14), 175, `researching ${sym6(ev.symbol)}`, 'rm-inspect');
        a.inspecting = true; a.stats.handled++;
        a.holdUntil = 0; // hold via inspect loop below
        a.onArrive = (ag) => { ag.anim = 'rm-inspect'; ag.animKey++; };
      });
      // safety: release inspectors after 18s even if research.done never lands
      setTimeout(() => {
        list.forEach((a) => { if (a.inspecting) { a.inspecting = false; toWander(a); } });
      }, 18000);
      queueDirty();
      break;
    }
    case 'research.done': {
      let changed = false;
      agents.forEach((a) => {
        if (a.inspecting) { a.inspecting = false; toWander(a); changed = true; }
      });
      if (changed) queueDirty();
      break;
    }
    case 'trade.enter': {
      const c = seatCenter(4);
      const list = idle();
      if (!list.length) return;
      const sym = sym6(ev.symbol);
      list.forEach((a) => {
        sendTo(a, c.x + rnd(-70, 70), c.y + rnd(-10, 20), 270, `BUY ${sym}!`, '');
        a.stats.handled++;
        a.onArrive = (ag) => holdAnim(ag, 'rm-celebrate', 2200, (ag2) => {
          // nearest to vault corner carries the chip home
          const carrier = agents.reduce((best, b) =>
            Math.hypot(b.x - (vw() - 80), b.y - (vh() - 110)) < Math.hypot(best.x - (vw() - 80), best.y - (vh() - 110)) ? b : best, ag2);
          agents.forEach((b) => { if (b !== carrier && b.state === 'busy') toWander(b); });
          carrier.carry = { type: 'buy', label: sym };
          carrier.stats.buys++;
          sendTo(carrier, vw() - 76, vh() - 116, 135, 'delivering to vault', '');
          carrier.onArrive = (ag3) => {
            ag3.carryFade = true;
            holdAnim(ag3, '', 550, (ag4) => { ag4.carry = null; ag4.carryFade = false; toWander(ag4); });
          };
        });
      });
      queueDirty();
      break;
    }
    case 'risk.exit': {
      const cx = vw() / 2, cy = vh() / 2;
      agents.forEach((a) => {
        if (a.state !== 'wander' && a.state !== 'pause') return;
        const dx = a.x - cx || rnd(-1, 1), dy = a.y - cy || rnd(-1, 1);
        const d = Math.hypot(dx, dy);
        sendTo(a, a.x + (dx / d) * rnd(140, 240), a.y + (dy / d) * rnd(140, 240), 300, 'scattering!', '');
        a.onArrive = (ag) => holdAnim(ag, '', 1100, (ag2) => toWander(ag2));
      });
      // round-robin: one agent slow-walks the P&L tag across
      const carrier = agents[exitRR.current++ % agents.length];
      const pnl = Number(ev.pnlUsd) || 0;
      setTimeout(() => {
        carrier.carry = { type: 'exit', pnl, symbol: sym6(ev.symbol) };
        carrier.task = `carrying ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
        sendTo(carrier, rnd(PAD, vw() - PAD), rnd(vh() * 0.3, vh() - PAD), 62, carrier.task, '');
        carrier.onArrive = (ag) => {
          ag.carryFade = true;
          holdAnim(ag, '', 700, (ag2) => { ag2.carry = null; ag2.carryFade = false; toWander(ag2); });
        };
      }, 1300);
      queueDirty();
      break;
    }
    default: break;
  }
}
const exitRR = { current: 0 };

// ------------------------------------------------------------ visuals
function RoamerBot({ color }) {
  return (
    <svg viewBox="0 0 60 78" className="rm-svg">
      <line x1="30" y1="12" x2="30" y2="4" stroke={color} strokeWidth="2" />
      <circle cx="30" cy="4" r="2.6" fill={color} className="rm-ant" />
      <rect x="14" y="12" width="32" height="22" rx="7" fill="#0b0512" stroke={color} strokeWidth="2" />
      <circle cx="24" cy="23" r="3" fill={color} className="rm-eye" />
      <circle cx="36" cy="23" r="3" fill={color} className="rm-eye" />
      <rect x="18" y="38" width="24" height="22" rx="6" fill="#0b0512" stroke={color} strokeWidth="2" />
      <circle cx="30" cy="49" r="4" fill="none" stroke={color} strokeWidth="2" />
      <line x1="18" y1="44" x2="10" y2="52" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="42" y1="44" x2="50" y2="52" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="24" y1="60" x2="24" y2="72" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="36" y1="60" x2="36" y2="72" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CarryChip({ carry, fade }) {
  if (!carry) return null;
  const cls = 'rm-carry' + (fade ? ' fade' : '');
  if (carry.type === 'kill') return <div className={cls + ' kill'}>✕ {carry.label}</div>;
  if (carry.type === 'buy') return <div className={cls + ' buy'}>◈ {carry.label}</div>;
  const pos = carry.pnl >= 0;
  return (
    <div className={cls + (pos ? ' grn' : ' red')}>
      {carry.symbol} {pos ? '+' : ''}${Number(carry.pnl).toFixed(2)}
    </div>
  );
}

function AgentCard({ agent, onClose }) {
  if (!agent) return null;
  const s = agent.stats;
  return (
    <div className="af-pop" onClick={onClose}>
      <div className="af-popcard" onClick={(e) => e.stopPropagation()}>
        <div className="af-pophead">
          <b style={{ color: agent.color }}>{agent.name}</b>
          <span className="af-mono dim">roamer · this session</span>
          <button className="af-x-btn" onClick={onClose}>✕</button>
        </div>
        <div className="af-srow"><span>status</span><b>{agent.task}</b></div>
        <div className="af-srow"><span>tokens handled</span><b>{s.handled}</b></div>
        <div className="af-srow"><span>kills dragged</span><b>{s.kills}</b></div>
        <div className="af-srow"><span>buys celebrated</span><b>{s.buys}</b></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ main
export default function Roamers() {
  const [agents] = useState(() => DEFS.map((d, i) => freshAgent(d, i)));
  const [, bump] = useReducer((x) => x + 1, 0);
  const [sel, setSel] = useState(null);
  const nodeRefs = useRef({});
  const queueRef = useRef([]);
  const aliveRef = useRef(true);
  const reduced = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    agents.forEach(pickWander);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reduced.current) return;
    aliveRef.current = true;
    const unsub = subscribeFloor((ev) => queueRef.current.push(ev));
    let raf = 0;
    let last = performance.now();
    let running = true;
    const dirty = { v: false };
    const markDirty = () => { dirty.v = true; };

    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running && aliveRef.current) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const onResize = () => {
      agents.forEach((a) => {
        a.x = clamp(a.x, PAD, Math.max(PAD + 1, vw() - PAD));
        a.y = clamp(a.y, PAD, Math.max(PAD + 1, vh() - PAD));
        a.tx = clamp(a.tx, PAD, Math.max(PAD + 1, vw() - PAD));
        a.ty = clamp(a.ty, PAD, Math.max(PAD + 1, vh() - PAD));
      });
    };

    function loop(now) {
      if (!running || !aliveRef.current) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const q = queueRef.current;
      while (q.length) handleEvent(q.shift(), agents, markDirty);
      for (const a of agents) {
        if (stepAgent(a, dt, now)) dirty.v = true;
        const el = nodeRefs.current[a.id];
        if (el) el.style.transform = `translate3d(${a.x}px, ${a.y}px, 0)`;
      }
      if (dirty.v) { dirty.v = false; bump(); }
      raf = requestAnimationFrame(loop);
    }

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onResize);
    raf = requestAnimationFrame(loop);
    return () => {
      aliveRef.current = false;
      running = false;
      cancelAnimationFrame(raf);
      unsub();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reduced.current) return null;

  const selAgent = sel ? agents.find((a) => a.id === sel) : null;

  return (
    <div className="rm-layer">
      {agents.map((a) => (
        <div
          key={a.id}
          ref={(el) => { if (el) nodeRefs.current[a.id] = el; }}
          className="rm-agent"
          style={{ transform: `translate3d(${a.x}px, ${a.y}px, 0)` }}
          onClick={(e) => { e.stopPropagation(); setSel(a.id); }}
        >
          <div className="rm-flip" style={{ transform: `scaleX(${a.flip})` }}>
            <div key={a.animKey} className={'rm-anim' + (a.anim ? ' ' + a.anim : '')}>
              <RoamerBot color={a.color} />
              {a.anim === 'rm-celebrate' && (
                <span className="rm-particles" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <i key={i} style={{ '--px': `${Math.round(Math.cos(i * 1.047) * 44)}px`, '--py': `${Math.round(Math.sin(i * 1.047) * 44 - 18)}px`, background: a.color }} />
                  ))}
                </span>
              )}
            </div>
          </div>
          <CarryChip carry={a.carry} fade={a.carryFade} />
          <div className="rm-tag" style={{ borderColor: a.color, color: a.color }}>{a.name}</div>
        </div>
      ))}
      {selAgent && <AgentCard agent={selAgent} onClose={() => setSel(null)} />}
    </div>
  );
}
