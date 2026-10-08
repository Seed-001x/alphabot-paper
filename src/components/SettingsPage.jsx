// ALPHABOT — Settings tab. Every tunable lives here.
// Server tuning via /api/tuning + /api/mode + /api/rugshield.
// Keys stay in this browser's localStorage, never in code.
import { useEffect, useState } from 'react';
import {
  getBackendUrl, setBackendUrl, fetchTuning, patchTuning,
  setAggressive, setRugShield,
} from '../lib/api.js';

const HELIUS_KEY = 'ab_helius_key_v1';
const AI_KEY = 'ab_ai_key_v1';

const MC_PRESETS = [
  { label: '$100K', v: 100000 },
  { label: '$250K', v: 250000 },
  { label: '$500K', v: 500000 },
  { label: '$1M', v: 1000000 },
];

// [tuning key, label, hint, {pct, step}]
const RISK_FIELDS = [
  ['takeProfit', 'Take profit', 'per-trade target', { pct: true }],
  ['stopLoss', 'Stop loss', 'per-trade max loss', { pct: true }],
  ['trailingStop', 'Trailing stop', 'locks in runners', { pct: true }],
  ['maxHoldHours', 'Max hold (hours)', 'zombie sweeper', {}],
  ['maxPositions', 'Max positions', 'concurrent real trades', { step: 1 }],
  ['cooldownMin', 'Cooldown (min)', 'between entries', { step: 1 }],
  ['minVol24hUsd', 'Min 24h volume ($)', 'liquidity floor', { step: 100 }],
  ['minMc', 'Min market cap ($)', 'vetting floor', { step: 1000 }],
  ['maxTopHolderPct', 'Max top holder (%)', 'concentration kill', { pct: true }],
  ['maxTop10Pct', 'Max top-10 holders (%)', 'concentration kill', { pct: true }],
  ['maxDevPct', 'Max dev holding (%)', 'dev concentration kill', { pct: true }],
];

function Toggle({ on, disabled, onFlip }) {
  return (
    <button className={'toggle' + (on ? ' on' : '')} disabled={disabled} onClick={onFlip} aria-pressed={!!on} />
  );
}

function useLocalKey(storageKey) {
  const [saved, setSaved] = useState(() => {
    try { return !!localStorage.getItem(storageKey); } catch { return false; }
  });
  const [input, setInput] = useState('');
  const save = () => {
    const v = input.trim();
    if (!v) return;
    try { localStorage.setItem(storageKey, v); } catch {}
    setInput(''); setSaved(true);
  };
  const drop = () => {
    try { localStorage.removeItem(storageKey); } catch {}
    setSaved(false);
  };
  return { saved, input, setInput, save, drop };
}

function KeySection({ title, note, storageKey }) {
  const k = useLocalKey(storageKey);
  return (
    <>
      <div className="set-row" style={{ borderBottom: 0, paddingBottom: 4 }}>
        <div>
          <div className="set-label">{title}</div>
          <div className="set-hint">{note}</div>
        </div>
      </div>
      {k.saved ? (
        <div className="key-active">
          <span className="dot" /> key active
          <button className="btn" onClick={k.drop}>Remove</button>
        </div>
      ) : (
        <div className="key-row">
          <input type="password" placeholder="paste key" value={k.input}
            onChange={e => k.setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && k.save()} />
          <button className="btn" onClick={k.save}>Save</button>
        </div>
      )}
    </>
  );
}

export default function SettingsPage({ book, onBackendChange }) {
  const [tuning, setTuning] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState({ t: '', ok: true });
  const [score, setScore] = useState(null);
  const [bUrl, setBUrl] = useState(getBackendUrl() || '');
  const base = getBackendUrl();

  useEffect(() => {
    if (!base) return;
    fetchTuning(base).then(t => { setTuning(t); setScore(t.minTokenScore); }).catch(() => {});
  }, [base]);

  const run = async (key, fn, okMsg) => {
    setBusy(key); setMsg({ t: '', ok: true });
    try {
      const t = await fn();
      if (t) setTuning(t);
      setMsg({ t: okMsg || 'Saved.', ok: true });
    } catch (e) {
      setMsg({ t: 'Failed: ' + (e.message || 'network error'), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const aggroOn = !!(tuning && tuning.aggressiveMode);
  const rugOn = tuning ? tuning.rugShield !== false : true;
  const curMc = (tuning && tuning.maxMc) || 1000000;
  const curScore = score != null ? score : (tuning && tuning.minTokenScore) || 25;

  const setField = (k, raw, meta) => {
    let v = Number(raw);
    if (isNaN(v)) return;
    if (meta.pct) v = v / 100;
    setDraft(d => ({ ...d, [k]: v }));
  };
  const dispVal = (k, meta) => {
    const v = draft[k] != null ? draft[k] : tuning ? tuning[k] : null;
    if (v == null) return '';
    return meta.pct ? +(v * 100).toFixed(2) : v;
  };
  const dirtyCount = Object.keys(draft).length;
  const doSaveRisk = () => run('risk', () => patchTuning(base, draft).then(t => { setDraft({}); return t; }), 'Risk parameters saved.');

  return (
    <div className="set-grid">
      {/* trading mode */}
      <div className="card">
        <div className="set-sec-title">TRADING MODE</div>
        <div className="set-row">
          <div><div className="set-label">Aggressive</div><div className="set-hint">wide net · 5-min cooldown · volume sizing</div></div>
          <Toggle on={aggroOn} disabled={busy === 'aggro' || !base}
            onFlip={() => run('aggro', () => setAggressive(base, !aggroOn).then(() => fetchTuning(base)), aggroOn ? 'Aggressive OFF.' : 'Aggressive ON.')} />
        </div>
        <div className="set-row">
          <div><div className="set-label">Rug shield</div><div className="set-hint">RugCheck kill chain on dev/holder concentration</div></div>
          <Toggle on={rugOn} disabled={busy === 'rug' || !base}
            onFlip={() => run('rug', () => setRugShield(base, !rugOn).then(() => fetchTuning(base)), rugOn ? 'Rug shield OFF.' : 'Rug shield ON.')} />
        </div>
        <div className="set-row" style={{ display: 'block' }}>
          <div className="set-label" style={{ marginBottom: 8 }}>Universe <span className="set-hint">— max market cap</span></div>
          <div className="chips">
            {MC_PRESETS.map(p => (
              <button key={p.v} className={'chip' + (curMc === p.v ? ' on' : '')}
                disabled={busy === 'mc' || !base}
                onClick={() => run('mc', () => patchTuning(base, { maxMc: p.v, pumpMaxMc: p.v }), `Universe cap ${p.label}.`)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="set-row" style={{ display: 'block' }}>
          <div className="set-label" style={{ marginBottom: 8 }}>Score bar <span className="set-hint">— entries need ≥ {curScore}</span></div>
          <div className="slider-row">
            <input type="range" className="slider" min="10" max="60" step="5" value={curScore}
              onChange={e => setScore(Number(e.target.value))} />
            <span className="slider-val">{curScore}</span>
            <button className="btn" disabled={busy === 'score' || !base}
              onClick={() => run('score', () => patchTuning(base, { minTokenScore: score }), `Score bar → ${score}.`)}>
              {busy === 'score' ? '…' : 'Apply'}
            </button>
          </div>
        </div>
        {msg.t && <div className={'set-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</div>}
      </div>

      {/* risk */}
      <div className="card">
        <div className="set-sec-title">RISK PARAMETERS</div>
        {RISK_FIELDS.map(([k, label, hint, meta]) => (
          <div className="set-row" key={k}>
            <div><div className="set-label">{label}</div><div className="set-hint">{hint}</div></div>
            <input className="set-input" type="number" step={meta.step || 'any'}
              value={dispVal(k, meta)} onChange={e => setField(k, e.target.value, meta)}
              placeholder="—" />
          </div>
        ))}
        <button className="save-btn" disabled={!dirtyCount || busy === 'risk' || !base} onClick={doSaveRisk}>
          {busy === 'risk' ? 'Saving…' : `Save${dirtyCount ? ` (${dirtyCount})` : ''}`}
        </button>
        {msg.t && <div className={'set-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</div>}
      </div>

      {/* real money */}
      <div className="card">
        <div className="set-sec-title">REAL MONEY</div>
        <div className="set-row">
          <div><div className="set-label">Max size per trade</div><div className="set-hint">% of bankroll</div></div>
          <input className="set-input" type="number" step="any"
            value={draft.realMaxSizePct != null ? +(draft.realMaxSizePct * 100).toFixed(1) : tuning && tuning.realMaxSizePct != null ? +(tuning.realMaxSizePct * 100).toFixed(1) : ''}
            onChange={e => { const v = Number(e.target.value); if (!isNaN(v)) setDraft(d => ({ ...d, realMaxSizePct: v / 100 })); }}
            placeholder="—" />
        </div>
        <div className="set-row">
          <div><div className="set-label">Priority fee (lamports)</div><div className="set-hint">per transaction</div></div>
          <input className="set-input" type="number" step="1000"
            value={draft.priorityFeeLamports != null ? draft.priorityFeeLamports : tuning ? tuning.priorityFeeLamports : ''}
            onChange={e => { const v = Number(e.target.value); if (!isNaN(v)) setDraft(d => ({ ...d, priorityFeeLamports: Math.round(v) })); }}
            placeholder="—" />
        </div>
        <div className="set-row">
          <div><div className="set-label">Kill switch</div><div className="set-hint">auto-halt at −50% equity</div></div>
          <span style={{ fontWeight: 800, fontSize: 12, color: book && book.killSwitched ? '#f43f5e' : '#34d399' }}>
            {book && book.killSwitched ? 'TRIPPED' : 'ARMED'}
          </span>
        </div>
        <div className="set-row">
          <div><div className="set-label">Avg slippage</div><div className="set-hint">quoted vs filled</div></div>
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            {book && book.avgSlippageBps != null ? Math.round(book.avgSlippageBps) + ' bps' : '—'}
          </span>
        </div>
        {(draft.realMaxSizePct != null || draft.priorityFeeLamports != null) && (
          <button className="save-btn" disabled={busy === 'risk' || !base} onClick={doSaveRisk}>
            {busy === 'risk' ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {/* keys */}
      <div className="card">
        <div className="set-sec-title">KEYS <span style={{ color: 'var(--faint)', letterSpacing: 0 }}>— this browser only</span></div>
        <KeySection title="Smart flow — Helius key" note="Enables the silent smart-flow layer. Optional." storageKey={HELIUS_KEY} />
        <div style={{ height: 14 }} />
        <KeySection title="AI judge — OpenAI key" note="Second-opinion judgments on researched tokens. Optional." storageKey={AI_KEY} />
      </div>

      {/* connection */}
      <div className="card">
        <div className="set-sec-title">CONNECTION</div>
        <div className="set-label" style={{ marginBottom: 8 }}>Backend URL</div>
        <div className="key-row">
          <input value={bUrl} onChange={e => setBUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
          <button className="btn" onClick={() => {
            setBackendUrl(bUrl);
            if (onBackendChange) onBackendChange();
          }}>Save</button>
        </div>
        <div className="set-hint" style={{ marginTop: 8 }}>Clear the field and save to go offline.</div>
      </div>
    </div>
  );
}
