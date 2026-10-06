// ALPHABOT v3.1 — THE FLOOR. Visualization layer ONLY, subscribe-only.
// Dense AI command-center: seat strip → isometric trading room → bottom
// telemetry. ZERO pipeline changes. Every number/chart/agent state reflects
// real pipeline data or real idle state — never faked.

import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeFloor } from '../lib/floorBus.js';
import { fmtUsd, fmtClock } from '../lib/paper.js';
import Equity from './Equity.jsx';

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

// ------------------------------------------------------------ THE FLOOR
// Isometric-style trading room (2.5D CSS/SVG, no 3D lib):
// back wall = big live equity chart · floor = 6 workstation desks with tiny
// live monitors + robots that animate ONLY on real events · right rail =
// gadgets (clock, kills, top runner, whale radar) · token chips flow on events.
const DESKS = [
  { id: 'scan', name: 'SCAN', color: '#41e8ff' },
  { id: 'vet', name: 'VET', color: '#ff2bd6' },
  { id: 'research', name: 'RESEARCH', color: '#3dff8f' },
  { id: 'score', name: 'SCORE', color: '#ffb02e' },
  { id: 'trade', name: 'TRADE', color: '#ff7ae2' },
  { id: 'risk', name: 'RISK', color: '#ff2e63' },
];
const DX = [7, 24, 41, 58, 75, 92]; // % left positions
const EV_ST = {
  'cycle.start': 0, 'scan.token': 0, 'flow.inject': 0,
  'vet.kill': 1,
  'research.start': 2, 'bread-start': 2, 'bread-done': 2, 'bread-fail': 2,
  'hunt.start': 2, 'hunt.done': 2, 'ledger.check': 2, 'judge.done': 2,
  'dossier.ready': 2, 'research.done': 2,
  'vet.scored': 3,
  'trade.enter': 4, 'trade.skip': 4,
  'risk.exit': 5,
};
const ACTIVE_MS = 4500;
const MAX_CHIPS = 10;

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

export function TheFloor({ d, equityArr, bankroll0, positions, priceMap, stats, now }) {
  const [active, setActive] = useState({ st: -1, ts: 0, exit: false });
  const [chips, setChips] = useState([]);
  const [tickNow, setTickNow] = useState(Date.now());
  const chipTimers = useRef(new Map());

  const addChip = (mint, symbol, flow) => {
    setChips(prev => {
      if (prev.some(c => c.mint === mint)) return prev;
      return [...prev, { mint, symbol: (symbol || '???').slice(0, 6), st: 0, state: 'run', flow: !!flow }].slice(-MAX_CHIPS);
    });
  };
  const advanceChip = (mint, toSt) => {
    setChips(prev => prev.map(c => (c.mint === mint && c.state === 'run' ? { ...c, st: Math.max(c.st, toSt) } : c)));
  };
  const dropChip = (mint, st) => {
    setChips(prev => prev.map(c => (c.mint === mint ? { ...c, st: st ?? c.st, state: 'dying' } : c)));
    const t = setTimeout(() => {
      setChips(prev => prev.filter(c => c.mint !== mint));
      chipTimers.current.delete(mint);
    }, 1200);
    chipTimers.current.set(mint, t);
  };
  const finishChip = (mint, ok) => {
    setChips(prev => prev.map(c => (c.mint === mint ? { ...c, st: 4, state: ok ? 'done' : 'gone' } : c)));
    const t = setTimeout(() => {
      setChips(prev => prev.filter(c => c.mint !== mint));
      chipTimers.current.delete(mint);
    }, ok ? 1800 : 800);
    chipTimers.current.set(mint, t);
  };

  useEffect(() => {
    const onEv = (ev) => {
      const st = EV_ST[ev.type];
      if (st != null) setActive({ st, ts: Date.now(), exit: ev.type === 'risk.exit' });
      const mint = ev.mint;
      switch (ev.type) {
        case 'scan.token': if (mint) addChip(mint, ev.symbol, ev.flow); break;
        case 'flow.inject': if (mint) addChip(mint, ev.symbol, true); break;
        case 'research.start': case 'bread-start': case 'hunt.start': case 'dossier.ready':
          if (mint) advanceChip(mint, 2); break;
        case 'vet.scored': case 'judge.done': case 'research.done': case 'ledger.check':
          if (mint) advanceChip(mint, 3); break;
        case 'vet.kill': if (mint) dropChip(mint, 1); break;
        case 'trade.enter': if (mint) finishChip(mint, true); break;
        case 'trade.skip': if (mint) finishChip(mint, false); break;
        default: break;
      }
    };
    const u = subscribeFloor(onEv);
    const t = setInterval(() => setTickNow(Date.now()), 2000);
    return () => { u(); clearInterval(t); };
  }, []);

  const activeOn = tickNow - active.ts < ACTIVE_MS ? active.st : -1;
  const eqUp = (equityArr && equityArr.length > 1)
    ? equityArr[equityArr.length - 1].v >= (bankroll0 || 0) : true;

  return (
    <section className="fl" aria-label="trading floor">
      <div className="fl-grid">
        <div className="fl-room">
          <div className="fl-wall">
            <div className="fl-wall-tag"><span>BALANCE · LIVE</span><b className={eqUp ? 'grn' : 'red'}>{fmtUsd(stats.equity)}</b></div>
            <Equity points={equityArr} bankroll0={bankroll0} />
          </div>
          <div className="fl-pan">
            <div className="fl-floor">
              {DESKS.map((dk, i) => {
                const busy = activeOn === i;
                return (
                  <div key={dk.id} className={'fdesk' + (busy ? ' on' : '') + (busy && active.exit ? ' exit' : '')} style={{ left: DX[i] + '%' }}>
                    <div className={'fdesk-agent' + (busy ? ' busy' : '')}>
                      <Robot color={dk.color} small />
                    </div>
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
              {chips.map(c => (
                <div
                  key={c.mint}
                  className={'fl-chip' + (c.state === 'dying' ? ' dying' : c.state === 'done' ? ' done' : c.state === 'gone' ? ' gone' : '') + (c.flow ? ' flow' : '')}
                  style={{ left: DX[c.st] + '%' }}
                >
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
