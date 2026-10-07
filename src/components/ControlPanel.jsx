// ALPHABOT v3.19 — CONTROL PANEL. The bot's remote control.
// Slide-in drawer: bankroll, mode, universe, score bar, learning status.
// Talks to the backend's control endpoints (paper only — no real funds exist).
// Big touch targets, mobile-first. Read-only when the backend is unreachable.

import { useEffect, useState } from 'react';

const MC_PRESETS = [
  { label: '$100K', v: 100000 },
  { label: '$250K', v: 250000 },
  { label: '$500K', v: 500000 },
  { label: '$1M', v: 1000000 },
];

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

function Row({ label, hint, children }) {
  return (
    <div className="cp-row">
      <div className="cp-row-head">
        <span className="cp-label">{label}</span>
        {hint && <span className="cp-hint">{hint}</span>}
      </div>
      <div className="cp-controls">{children}</div>
    </div>
  );
}

export default function ControlPanel({ open, onClose, backendUrl, serverConfig, serverStats, serverBrain, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [tuning, setTuning] = useState(null);
  const [score, setScore] = useState(null);

  const cfg = serverConfig || {};
  const stats = serverStats || {};
  const brain = serverBrain || {};
  const base = (backendUrl || '').replace(/\/+$/, '');

  // Pull live tuning when opened.
  useEffect(() => {
    if (!open || !base) return;
    setMsg('');
    fetch(`${base}/api/tuning`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.tuning) {
          setTuning(d.tuning);
          setScore(d.tuning.minTokenScore);
        }
      })
      .catch(() => {});
  }, [open, base]);

  if (!open) return null;

  const run = async (key, fn, doneMsg) => {
    setBusy(key);
    setMsg('');
    try {
      await fn();
      setMsg(doneMsg || 'Done.');
      if (onChanged) onChanged();
    } catch (e) {
      setMsg('Failed: ' + (e.message || 'network error'));
    } finally {
      setBusy(null);
    }
  };

  const doFund = () =>
    run('fund', () => postJson(`${base}/api/bankroll`, { sol: 1 }), 'Bankroll funded: 1 SOL. Past trades + learning preserved.');
  const doAggro = (on) =>
    run('aggro', () => postJson(`${base}/api/mode`, { on }), on ? 'Aggressive mode ON — disciplined aggro, rug shield up.' : 'Aggressive mode OFF.');
  const doRug = (on) =>
    run('rug', () => postJson(`${base}/api/rugshield`, { on }), on ? 'Rug shield ON — RugCheck kills active.' : 'Rug shield OFF — coins flow to scoring unfiltered.');
  const doMc = (v) =>
    run('mc' + v, async () => {
      const d = await postJson(`${base}/api/tuning`, { patch: { maxMc: v, pumpMaxMc: v } });
      setTuning(d.tuning || tuning);
    }, `Universe cap set to $${(v / 1000).toFixed(0)}K.`);
  const doScore = () =>
    run('score', async () => {
      const d = await postJson(`${base}/api/tuning`, { patch: { minTokenScore: score } });
      setTuning(d.tuning || tuning);
    }, `Score bar set to ${score}.`);

  const curMc = (tuning && tuning.maxMc) || cfg.maxMc || 500000;
  const curScore = score != null ? score : cfg.minTokenScore != null ? cfg.minTokenScore : 25;
  const aggroOn = !!cfg.aggressiveMode;
  const rugOn = cfg.rugShield !== false;
  const equity = stats.equity != null ? stats.equity : null;
  const trades = stats.totalTrades != null ? stats.totalTrades : brain.closed || 0;
  const wr = stats.winRate != null ? stats.winRate : brain.winRate;

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cp-head">
          <span className="cp-title">⌁ CONTROL</span>
          <button className="cc-btn cp-close" onClick={onClose}>✕</button>
        </div>

        {msg && <div className={'cp-msg' + (msg.startsWith('Failed') ? ' err' : '')}>{msg}</div>}

        <Row label="BANKROLL" hint="paper · learning never wiped">
          <div className="cp-bank">
            <span className="cp-equity">{equity != null ? '$' + Number(equity).toFixed(2) : '—'}</span>
            <button className="cp-bigbtn" disabled={busy === 'fund' || !base} onClick={doFund}>
              {busy === 'fund' ? '…' : '+ FUND 1 SOL'}
            </button>
          </div>
          <div className="cp-note">Fresh cash, fresh equity curve. Past trades + all learning carry over.</div>
        </Row>

        <Row label="MODE" hint="speed + size">
          <button
            className={'cp-bigbtn toggle' + (aggroOn ? ' on' : '')}
            disabled={busy === 'aggro' || !base}
            onClick={() => doAggro(!aggroOn)}
          >
            {busy === 'aggro' ? '…' : aggroOn ? '🔥 AGGRESSIVE · ON' : 'AGGRESSIVE · OFF'}
          </button>
          <div className="cp-note">Wide net, 5-min cooldown, volume sizing. Rug shield stays on.</div>
        </Row>

        <Row label="RUG SHIELD" hint="RugCheck kill chain">
          <button
            className={'cp-bigbtn toggle' + (rugOn ? ' on' : '')}
            disabled={busy === 'rug' || !base}
            onClick={() => doRug(!rugOn)}
          >
            {busy === 'rug' ? '…' : rugOn ? '🛡️ SHIELD · ON' : 'SHIELD · OFF'}
          </button>
          <div className="cp-note">ON kills high dev/holder concentration. OFF lets everything through to scoring.</div>
        </Row>

        <Row label="UNIVERSE" hint="max market cap">
          <div className="cp-presets">
            {MC_PRESETS.map((p) => (
              <button
                key={p.v}
                className={'cp-chip' + (curMc === p.v ? ' on' : '')}
                disabled={busy === 'mc' + p.v || !base}
                onClick={() => doMc(p.v)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="cp-note">$100K–$500K + fresh post-bond coins are the scalp zone.</div>
        </Row>

        <Row label="SCORE BAR" hint={`entries need ≥ ${curScore}`}>
          <input
            type="range" min="10" max="60" step="5" value={curScore}
            className="cp-slider"
            onChange={(e) => setScore(Number(e.target.value))}
          />
          <div className="cp-slider-row">
            <span className="cp-slider-val">{curScore}</span>
            <button className="cp-bigbtn small" disabled={busy === 'score' || !base} onClick={doScore}>
              {busy === 'score' ? '…' : 'APPLY'}
            </button>
          </div>
        </Row>

        <Row label="RISK" hint="learned exits">
          <div className="cp-kv">
            <span>Take profit</span><b>+{Math.round(((tuning && tuning.takeProfit) || cfg.takeProfit || 0.2) * 100)}%</b>
          </div>
          <div className="cp-kv">
            <span>Stop loss</span><b>−{Math.round(((tuning && tuning.stopLoss) || cfg.stopLoss || 0.1) * 100)}%</b>
          </div>
          <div className="cp-kv">
            <span>Max positions</span><b>{(tuning && tuning.maxPositions) || cfg.maxPositions || 5}</b>
          </div>
          <div className="cp-note">Exits keep adapting from the trade journal — the profiler overrides these per bucket.</div>
        </Row>

        <Row label="LEARNING" hint="never reset">
          <div className="cp-kv">
            <span>Trades logged</span><b>{trades}</b>
          </div>
          <div className="cp-kv">
            <span>Win rate</span><b>{wr != null ? (wr * 100).toFixed(1) + '%' : '—'}</b>
          </div>
          <div className="cp-kv">
            <span>Exit profile</span><b>{brain && brain.confirmedKills != null ? 'adapting' : 'collecting'}</b>
          </div>
          <div className="cp-note">Kill ledger · trade journal · creator ledger · learned weights — permanent.</div>
        </Row>

        <div className="cp-foot">Paper only. No wallet, no signing, no real funds.</div>
      </div>
    </div>
  );
}
