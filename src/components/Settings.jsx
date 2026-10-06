// Settings drawer: Helius key, risk params, pause/reset.
import { useState } from 'react';
import { RISK_META } from '../lib/config.js';
import { getKey, setKey, clearKey } from '../lib/helius.js';
import { statsFor, fmtUsd, fmtPct } from '../lib/paper.js';

const ORDER = [
  'bankroll0', 'minTokenScore',
  'minLiquidityUsd', 'minVol24hUsd', 'minMc', 'maxMc', 'minAgeMin', 'maxAgeDays',
  'minBuys24h', 'maxTopHolderPct', 'maxTop10Pct', 'eliteBoost',
  'maxPositions', 'positionPct', 'takeProfit', 'stopLoss', 'trailingStop', 'maxHoldHours', 'cooldownMin',
  'scanIntervalSec', 'priceIntervalSec',
];

export default function Settings({ open, onClose, config, onConfig, portfolio, priceMap, onReset, paused, onTogglePaused, keyState, onKeySaved }) {
  const [keyInput, setKeyInput] = useState('');
  const [keyErr, setKeyErr] = useState('');
  if (!open) return null;
  const stats = statsFor(portfolio, priceMap);

  function saveKey() {
    const v = keyInput.trim();
    if (!v) { setKeyErr('Paste a key first.'); return; }
    setKey(v); setKeyInput(''); setKeyErr('');
    onKeySaved(v);
  }
  function dropKey() { clearKey(); onKeySaved(''); }

  function setCfg(k, raw) {
    const meta = RISK_META[k];
    let v = Number(raw);
    if (isNaN(v)) return;
    if (meta.pct) v = v / 100;
    v = Math.min(meta.max, Math.max(meta.min, v));
    onConfig({ ...config, [k]: v });
  }
  function dispVal(k) {
    const v = config[k];
    return RISK_META[k].pct ? (v * 100) : v;
  }

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <div className="drawer">
        <h3>◈ Desk control</h3>
        <div className="stat-grid">
          <div className="stat"><div className="k">Equity</div><div className="v">{fmtUsd(stats.equity)}</div></div>
          <div className="stat"><div className="k">P&amp;L</div><div className="v">{fmtPct(stats.totalPnlPct)}</div></div>
          <div className="stat"><div className="k">Win rate</div><div className="v">{stats.winRate == null ? '—' : Math.round(stats.winRate * 100) + '%'}</div></div>
        </div>
        <div className="stat-grid">
          <div className="stat"><div className="k">Wins</div><div className="v" style={{ color: 'var(--grn)' }}>{stats.wins}</div></div>
          <div className="stat"><div className="k">Losses</div><div className="v" style={{ color: 'var(--red)' }}>{stats.losses}</div></div>
          <div className="stat"><div className="k">Avg mult</div><div className="v">{stats.avgMultiple == null ? '—' : stats.avgMultiple.toFixed(2) + 'x'}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className={'btn' + (paused ? ' on' : '')} onClick={onTogglePaused}>{paused ? '▶ Resume desk' : '❚❚ Pause desk'}</button>
          <button className="btn" onClick={() => { if (window.confirm('Reset the paper portfolio? This wipes positions, trades and the equity curve.')) onReset(config.bankroll0); }}>↺ Reset</button>
          <button className="btn grn" onClick={onClose}>Done</button>
        </div>

        <h3>◈ Elite intel — Helius key</h3>
        <p className="note">
          Optional. The token desk runs fully without it — SCAN/VET/SCORE are all free.
          The key only powers the <b>elite confirmation boost</b> (+score when a top wallet holds a token)
          and <b>elite-seller exits</b>. It stays in this browser's localStorage, never in the code.
        </p>
        {keyState ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="note" style={{ color: 'var(--grn)' }}>● key active — elite intel ON</span>
            <button className="btn" onClick={dropKey}>Remove</button>
          </div>
        ) : (
          <>
            <div className="key-row">
              <input type="password" placeholder="Helius API key" value={keyInput} onChange={e => setKeyInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveKey()} />
              <button className="btn" onClick={saveKey}>Save</button>
            </div>
            {keyErr && <p className="err">{keyErr}</p>}
            <p className="note">Free at <a href="https://www.helius.dev" target="_blank" rel="noreferrer">helius.dev</a>.</p>
          </>
        )}

        <h3>◈ Risk &amp; vet parameters</h3>
        {ORDER.map(k => {
          const meta = RISK_META[k];
          if (!meta) return null;
          return (
            <div key={k} className="cfg-row">
              <label>{meta.label} <small>{meta.hint} · {meta.unit}</small></label>
              <input
                type="number"
                value={dispVal(k)}
                min={meta.pct ? meta.min * 100 : meta.min}
                max={meta.pct ? meta.max * 100 : meta.max}
                step="any"
                onChange={e => setCfg(k, e.target.value)}
              />
            </div>
          );
        })}
        <p className="note" style={{ marginTop: 14 }}>
          Paper money only. Virtual P&amp;L proves nothing about real trading — this desk is a strategy
          laboratory, not a profit machine.
        </p>
      </div>
    </>
  );
}
