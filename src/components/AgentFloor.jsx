// AGENT FLOOR — animated visualization of the desk's real pipeline.
// Little SVG robot agents at SCAN → VET → RESEARCH → SCORE → TRADE (+ VAULT),
// token chips flow between stations driven ONLY by real floorBus events.
// Theatrical pacing (chips walk ~1 hop/sec) is visual; every chip, kill
// reason, score and entry is a real pipeline event. No events = idle floor,
// never fake tokens. Transform/opacity animations only (mobile-safe).

import { useEffect, useRef, useState } from 'react';
import { subscribeFloor } from '../lib/floorBus.js';

const STATIONS = [
  { id: 'scan', name: 'SCAN', color: '#2DD4BF' },
  { id: 'vet', name: 'VET', color: '#8B7CF6' },
  { id: 'research', name: 'RESEARCH', color: '#3ECF8E' },
  { id: 'score', name: 'SCORE', color: '#E5B567' },
  { id: 'trade', name: 'TRADE', color: '#8B7CF6' },
  { id: 'vault', name: 'VAULT', color: '#b48cff' },
];
const RISK = { id: 'risk', name: 'RISK', color: '#F0665E' };
const STAGE_IDX = { scan: 0, vet: 1, research: 2, score: 3, trade: 4, vault: 5 };
const MAX_CHIPS = 12;
const BD_LABELS = { liquidity: 'liquidity', holders: 'holders', buyPressure: 'buy pressure', curve: 'curve', age: 'age' };

const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : (a || '?'));
const fmtUsd = (v) => v == null ? '?' : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${Math.round(v)}`;
const fmtMs = (ms) => ms == null ? '—' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

const freshStats = () => ({
  scan: { seen: 0 },
  vet: { kills: 0, passed: 0, msSum: 0, msN: 0 },
  research: { dossiers: 0, modSum: 0, msSum: 0, msN: 0 },
  score: { stamped: 0, scoreSum: 0 },
  trade: { entries: 0, skips: 0 },
  risk: { exits: 0 },
});

// ------------------------------------------------------------ robot
function Bot({ color, active, sleepy, jolt, label, small }) {
  return (
    <div className={'af-bot' + (active ? ' working' : '') + (jolt ? ' jolt' : '') + (small ? ' small' : '')}>
      <svg viewBox="0 0 60 78" width={small ? 34 : 46} height={small ? 44 : 58}>
        <line x1="30" y1="12" x2="30" y2="4" stroke={color} strokeWidth="2" />
        <circle cx="30" cy="4" r="2.6" fill={color} className="af-ant" />
        <rect x="14" y="12" width="32" height="22" rx="7" fill="#0c0612" stroke={color} strokeWidth="2" />
        {sleepy && !jolt ? (
          <g stroke={color} strokeWidth="2" strokeLinecap="round">
            <line x1="21" y1="23" x2="27" y2="23" /><line x1="33" y1="23" x2="39" y2="23" />
          </g>
        ) : (
          <g><circle cx="24" cy="23" r="3" fill={color} className="af-eye" /><circle cx="36" cy="23" r="3" fill={color} className="af-eye" /></g>
        )}
        <rect x="18" y="38" width="24" height="22" rx="6" fill="#0c0612" stroke={color} strokeWidth="2" />
        <circle cx="30" cy="49" r="4" fill="none" stroke={color} strokeWidth="2" className={active ? 'af-core' : ''} />
        <line x1="18" y1="44" x2="10" y2="52" stroke={color} strokeWidth="2" strokeLinecap="round" className="af-arm" />
        <line x1="42" y1="44" x2="50" y2="52" stroke={color} strokeWidth="2" strokeLinecap="round" className="af-arm" />
        <line x1="24" y1="60" x2="24" y2="72" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <line x1="36" y1="60" x2="36" y2="72" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="af-botname" style={{ color }}>{label}</div>
      {sleepy && !jolt && <div className="af-zzz">z z</div>}
    </div>
  );
}

// ------------------------------------------------------------ chip
function ChipView({ chip, x, y, onTap }) {
  const d = chip.data || {};
  const dispScore = d.finalScore != null ? d.finalScore
    : d.score != null ? Math.max(0, Math.min(100, d.score + (d.researchMod || 0))) : null;
  const color = chip.killed ? '#F0665E' : chip.flow ? '#E5B567' : (STATIONS[STAGE_IDX[chip.stage] ?? 0] || {}).color || '#2DD4BF';
  return (
    <div
      className={'af-chip' + (chip.killed ? ' killed' : '') + ((chip.fading || chip.gone) ? ' fade' : '') + (chip.inBin ? ' binned' : '')}
      style={{
        transform: `translate3d(${x}px, ${y}px, 0) translateX(-50%)`,
        borderColor: color, boxShadow: `0 0 14px ${color}55, inset 0 0 8px ${color}22`,
      }}
      onClick={(e) => { e.stopPropagation(); onTap(); }}
    >
      <span className="af-sym">{(chip.symbol || '???').slice(0, 6)}</span>
      {dispScore != null && !chip.killed && <span className="af-score">{dispScore}</span>}
      {chip.killed && <span className="af-x">✕</span>}
      {chip.flash === 'grn' && <span className="af-buytag">BUY</span>}
    </div>
  );
}

// ------------------------------------------------------------ popups
function ChipDossier({ chip, onClose }) {
  const d = chip.data || {};
  const bd = d.breakdown || {};
  return (
    <div className="af-pop" onClick={onClose}>
      <div className="af-popcard" onClick={(e) => e.stopPropagation()}>
        <div className="af-pophead">
          <b>{chip.symbol}</b><span className="af-mono dim">{chip.name || ''}</span>
          <button className="af-x-btn" onClick={onClose}>✕</button>
        </div>
        <div className="af-mono dim">mint {short(chip.mint)} · MC {fmtUsd(chip.mc)}</div>
        <div className="af-trail">{chip.trail.join(' → ')}</div>
        {d.killPass && (
          <div className="af-killbox">KILLED [{d.killPass}]<br />{d.killReason}</div>
        )}
        {d.score != null && (
          <div className="af-scorebox">
            <div>score <b>{d.finalScore != null ? d.finalScore : d.score}</b>
              {d.researchMod ? <span className={d.researchMod > 0 ? 'grn' : 'red'}> ({d.researchMod > 0 ? '+' : ''}{d.researchMod} research)</span> : null}
            </div>
            {Object.keys(BD_LABELS).map(k => bd[k] == null ? null : (
              <div key={k} className="af-bar"><span>{BD_LABELS[k]}</span>
                <div className="af-barbg"><div className="af-barfg" style={{ width: `${Math.round(bd[k])}%` }} /></div>
                <b>{Math.round(bd[k])}</b>
              </div>
            ))}
          </div>
        )}
        {d.researchLine && <div className="af-rsline">⟁ research {d.researchMod > 0 ? '+' : ''}{d.researchMod} — {d.researchLine}</div>}
        {d.sizeUsd != null && <div className="af-enter">ENTER · {fmtUsd(d.sizeUsd)} @ {fmtUsd(d.entryMc)} MC</div>}
        {d.skipReason && <div className="af-mono dim">no entry: {d.skipReason}</div>}
      </div>
    </div>
  );
}

function AgentPopup({ seat, stats, onClose }) {
  const rows = {
    scan: [['tokens seen', stats.scan.seen]],
    vet: [['killed', stats.vet.kills], ['passed', stats.vet.passed],
      ['avg vet time', fmtMs(stats.vet.msN ? stats.vet.msSum / stats.vet.msN : null)]],
    research: [['dossiers read', stats.research.dossiers],
      ['avg modifier', stats.research.dossiers ? (stats.research.modSum / stats.research.dossiers >= 0 ? '+' : '') + (stats.research.modSum / stats.research.dossiers).toFixed(1) : '—'],
      ['avg time', fmtMs(stats.research.msN ? stats.research.msSum / stats.research.msN : null)]],
    score: [['stamped', stats.score.stamped],
      ['avg score', stats.score.stamped ? Math.round(stats.score.scoreSum / stats.score.stamped) : '—']],
    trade: [['paper entries', stats.trade.entries], ['skipped (gated)', stats.trade.skips]],
    risk: [['exits fired', stats.risk.exits]],
    vault: [['—', 'paper vault holds entries']],
  }[seat] || [];
  const label = seat === 'vault' ? 'VAULT' : seat === 'risk' ? 'RISK' : seat.toUpperCase();
  return (
    <div className="af-pop" onClick={onClose}>
      <div className="af-popcard" onClick={(e) => e.stopPropagation()}>
        <div className="af-pophead"><b>{label}</b><span className="af-mono dim">this session</span>
          <button className="af-x-btn" onClick={onClose}>✕</button></div>
        {rows.map(([k, v]) => (
          <div key={k} className="af-srow"><span>{k}</span><b>{v}</b></div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ main
export default function AgentFloor() {
  const [collapsed, setCollapsed] = useState(false);
  const [chips, setChips] = useState([]);
  const [stats, setStats] = useState(freshStats);
  const [selected, setSelected] = useState(null);
  const [seenCycle, setSeenCycle] = useState(false);
  const [killCount, setKillCount] = useState(0);
  const [riskAwake, setRiskAwake] = useState(false);
  const [exitToasts, setExitToasts] = useState([]);
  const [trackW, setTrackW] = useState(0);
  const trackRef = useRef(null);
  const t0 = useRef(new Map());

  // ---- event → chip queue plumbing (theatrical pacing, real events) ----
  const queueHop = (mint, hop) => setChips(prev => {
    const i = prev.findIndex(c => c.mint === mint && !c.gone);
    if (i < 0) return prev;
    const next = [...prev];
    next[i] = { ...next[i], queue: [...next[i].queue, hop] };
    return next;
  });
  const mergeData = (mint, data) => setChips(prev => {
    const i = prev.findIndex(c => c.mint === mint && !c.gone);
    if (i < 0) return prev;
    const next = [...prev];
    next[i] = { ...next[i], data: { ...next[i].data, ...data } };
    return next;
  });
  const addChip = (info) => setChips(prev => {
    const live = prev.filter(c => !c.gone);
    if (live.some(c => c.mint === info.mint)) return prev;
    const chip = {
      mint: info.mint, symbol: info.symbol || '???', name: info.name || '', mc: info.mc,
      flow: !!info.flow,
      stage: 'scan', queue: [], data: {}, trail: ['SCAN'],
      blocked: false, blockedAt: 0, researchReady: false,
      holdUntil: Date.now() + 800, flash: null, flashAt: 0,
      killed: false, inBin: false, fading: false, gone: false, goneAt: 0,
    };
    let next = [...live, chip];
    if (next.length > MAX_CHIPS) {
      const idx = next.findIndex(c => c.stage !== 'trade' && c.stage !== 'vault' && !c.inBin);
      if (idx >= 0) next[idx] = { ...next[idx], gone: true, goneAt: Date.now() };
    }
    return next;
  });

  useEffect(() => subscribeFloor((ev) => {
    switch (ev.type) {
      case 'cycle.start': setSeenCycle(true); break;
      case 'scan.token':
        t0.current.set(ev.mint, { scan: ev.ts });
        setStats(s => ({ ...s, scan: { seen: s.scan.seen + 1 } }));
        addChip(ev);
        break;
      case 'vet.kill': {
        const s0 = t0.current.get(ev.mint);
        setStats(s => ({ ...s, vet: { ...s.vet, kills: s.vet.kills + 1, msSum: s.vet.msSum + (s0 && s0.scan ? ev.ts - s0.scan : 0), msN: s.vet.msN + (s0 && s0.scan ? 1 : 0) } }));
        mergeData(ev.mint, { killPass: ev.killPass, killReason: ev.killReason });
        queueHop(ev.mint, { to: 'vet', dwell: 850 });
        queueHop(ev.mint, { to: 'killed', dwell: 1400, flash: 'red' });
        queueHop(ev.mint, { to: 'bin', dwell: 2400 });
        queueHop(ev.mint, { to: 'gone' });
        setKillCount(k => k + 1);
        break;
      }
      case 'vet.scored': {
        const s0 = t0.current.get(ev.mint);
        setStats(s => ({
          ...s,
          vet: { ...s.vet, passed: s.vet.passed + 1, msSum: s.vet.msSum + (s0 && s0.scan ? ev.ts - s0.scan : 0), msN: s.vet.msN + (s0 && s0.scan ? 1 : 0) },
          score: { ...s.score, stamped: s.score.stamped + 1, scoreSum: s.score.scoreSum + (ev.score || 0) },
        }));
        mergeData(ev.mint, { score: ev.score, breakdown: ev.breakdown, holderCount: ev.holderCount });
        queueHop(ev.mint, { to: 'vet', dwell: 850 });
        queueHop(ev.mint, { to: 'research', dwell: 1300 });
        break;
      }
      case 'research.start':
        t0.current.set(ev.mint, { ...(t0.current.get(ev.mint) || {}), research: ev.ts });
        break;
      case 'research.done': {
        const s0 = t0.current.get(ev.mint);
        setStats(s => ({ ...s, research: { ...s.research, dossiers: s.research.dossiers + 1, modSum: s.research.modSum + (ev.modifier || 0), msSum: s.research.msSum + (s0 && s0.research ? ev.ts - s0.research : 0), msN: s.research.msN + (s0 && s0.research ? 1 : 0) } }));
        mergeData(ev.mint, { researchMod: ev.modifier, researchLine: ev.line });
        setChips(prev => prev.map(c => (c.mint === ev.mint && !c.gone) ? { ...c, researchReady: true, blocked: false } : c));
        queueHop(ev.mint, { to: 'score', dwell: 1600 });
        break;
      }
      case 'trade.enter':
        setStats(s => ({ ...s, trade: { ...s.trade, entries: s.trade.entries + 1 } }));
        mergeData(ev.mint, { sizeUsd: ev.sizeUsd, entryMc: ev.entryMc, finalScore: ev.score });
        queueHop(ev.mint, { to: 'trade', dwell: 1100, flash: 'grn' });
        queueHop(ev.mint, { to: 'vault', dwell: 1700 });
        queueHop(ev.mint, { to: 'gone' });
        break;
      case 'trade.skip':
        setStats(s => ({ ...s, trade: { ...s.trade, skips: s.trade.skips + 1 } }));
        mergeData(ev.mint, { skipReason: ev.reason, finalScore: ev.score });
        queueHop(ev.mint, { to: 'skipped', dwell: 1600 });
        queueHop(ev.mint, { to: 'gone' });
        break;
      case 'risk.exit':
        setStats(s => ({ ...s, risk: { ...s.risk, exits: s.risk.exits + 1 } }));
        setRiskAwake(true);
        setTimeout(() => setRiskAwake(false), 2800);
        setExitToasts(prev => [...prev.slice(-2), { id: ev.ts + ev.mint, symbol: ev.symbol, reason: ev.exitReason, pnl: ev.pnlUsd }]);
        setTimeout(() => setExitToasts(prev => prev.slice(1)), 6500);
        break;
      default: break;
    }
  }), []);

  // ---- hop runner: ~1 theatrical hop per chip per beat ----
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setChips(prev => {
        let changed = false;
        const next = prev.map(c => {
          if (c.gone) return c;
          let cc = c;
          if (cc.blocked && now - (cc.blockedAt || now) > 25000) { cc = { ...cc, blocked: false }; changed = true; } // failsafe
          if (cc.flash && now - cc.flashAt > 1400) { cc = { ...cc, flash: null }; changed = true; }
          if (cc.blocked || now < cc.holdUntil) return cc;
          const hop = cc.queue[0];
          if (!hop) return cc;
          changed = true;
          const nc = { ...cc, queue: cc.queue.slice(1), data: { ...cc.data, ...(hop.data || {}) } };
          nc.flash = hop.flash || null;
          nc.flashAt = hop.flash ? now : 0;
          switch (hop.to) {
            case 'gone': nc.gone = true; nc.goneAt = now; break;
            case 'killed': nc.killed = true; nc.trail = [...nc.trail, 'VET ✕']; nc.holdUntil = now + hop.dwell; break;
            case 'bin': nc.inBin = true; nc.trail = [...nc.trail, 'BIN']; nc.holdUntil = now + hop.dwell; break;
            case 'skipped': nc.fading = true; nc.trail = [...nc.trail, 'NO ENTRY']; nc.holdUntil = now + hop.dwell; break;
            default:
              nc.stage = hop.to;
              nc.trail = [...nc.trail, hop.to.toUpperCase()];
              nc.holdUntil = now + (hop.dwell || 900);
              if (hop.to === 'research' && !nc.researchReady) { nc.blocked = true; nc.blockedAt = now; }
          }
          return nc;
        }).filter(c => !(c.gone && now - c.goneAt > 650));
        if (next.length !== prev.length) changed = true;
        return changed ? next : prev;
      });
    }, 350);
    return () => clearInterval(id);
  }, []);

  // ---- track measurement for chip x-positions ----
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth));
    ro.observe(el);
    setTrackW(el.clientWidth);
    return () => ro.disconnect();
  }, [collapsed]);

  const colW = trackW > 0 ? trackW / 6 : 110;
  const posFor = (c) => {
    let idx = STAGE_IDX[c.stage] ?? 0;
    let y = 34;
    if (c.inBin) { idx = 1; y = 172; }
    return { x: (idx + 0.5) * colW, y };
  };
  const workingAt = (id) => chips.some(c => !c.gone && !c.inBin && c.stage === id);

  const selChip = selected && selected.kind === 'chip' ? chips.find(c => c.mint === selected.mint) : null;

  return (
    <div className="panel af-panel">
      <div className="af-head" onClick={() => setCollapsed(v => !v)}>
        <h2 className="panel-title">◈ AGENT FLOOR · live</h2>
        <div className="af-headright" onClick={(e) => e.stopPropagation()}>
          <div
            className={'af-riskmini' + (riskAwake ? ' jolt' : '')}
            onClick={() => setSelected({ kind: 'agent', seat: 'risk' })}
            title="RISK agent"
          >
            <Bot color={RISK.color} sleepy={!riskAwake && stats.risk.exits === 0} jolt={riskAwake} label="RISK" small />
            <span className="af-mono dim">{stats.risk.exits} exits</span>
          </div>
          <span className="af-collapse" onClick={() => setCollapsed(v => !v)}>{collapsed ? '▸' : '▾'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="af-scroll">
          <div className="af-track" ref={trackRef}>
            <div className="af-lane" />
            {STATIONS.map(s => (
              <div key={s.id} className="af-station" onClick={() => setSelected({ kind: 'agent', seat: s.id })}>
                <Bot color={s.color} active={workingAt(s.id)} label={s.name} />
              </div>
            ))}
            <div className="af-bin" style={{ left: `${((1 + 0.5) / 6) * 100}%` }}>
              <span>☠ KILL BIN · {killCount}</span>
            </div>
            {chips.filter(c => !c.gone).map(c => {
              const p = posFor(c);
              return <ChipView key={c.mint} chip={c} x={p.x} y={p.y} onTap={() => setSelected({ kind: 'chip', mint: c.mint })} />;
            })}
            {!seenCycle && chips.length === 0 && (
              <div className="af-idle">agents idle · awaiting first cycle</div>
            )}
          </div>
        </div>
      )}

      {exitToasts.map(t => (
        <div key={t.id} className="af-toast">
          <b style={{ color: RISK.color }}>RISK</b> closed {t.symbol} · {t.reason}
          <span className={t.pnl >= 0 ? 'grn' : 'red'}> {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</span>
        </div>
      ))}

      {selChip && <ChipDossier chip={selChip} onClose={() => setSelected(null)} />}
      {selected && selected.kind === 'agent' && (
        <AgentPopup seat={selected.seat} stats={stats} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
