// v3.21: Learning Room — give the bot homework.
// Paste a wallet, it dissects the trading style. Add multiple wallets,
// then synthesize into a strategy the bot can actually use.
import { useState, useEffect } from 'react';

const postJson = async (url, body) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
};

export default function LearningRoom({ base, onClose }) {
  const [wallet, setWallet] = useState('');
  const [label, setLabel] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [strategy, setStrategy] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [manualTrades, setManualTrades] = useState('');

  const load = async () => {
    try {
      const r = await fetch(`${base}/api/learn/profiles`);
      const d = await r.json();
      setProfiles(d.profiles || []);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const analyzeWallet = async () => {
    if (!wallet.trim()) return;
    setBusy('analyze');
    setMsg('Pulling trade history…');
    try {
      // For now: user pastes trade JSON, or we trigger a browser pull.
      // MVP: accept manually pasted trades.
      let trades = [];
      if (manualTrades.trim()) {
        trades = JSON.parse(manualTrades);
      } else {
        setMsg('Paste trade JSON below, or the auto-pull is coming soon.');
        setBusy(null);
        return;
      }
      const d = await postJson(`${base}/api/learn/wallet`, {
        wallet: wallet.trim(),
        label: label.trim() || wallet.slice(0, 8),
        trades,
      });
      if (d.ok) {
        setMsg(`Analyzed ${d.profile.totalTrades} trades. Win rate ${d.profile.winRate}%.`);
        setWallet(''); setLabel(''); setManualTrades('');
        load();
      } else {
        setMsg('Failed: ' + (d.error || 'unknown'));
      }
    } catch (e) {
      setMsg('Failed: ' + (e.message || 'parse error — check JSON format'));
    } finally {
      setBusy(null);
    }
  };

  const synthesize = async () => {
    setBusy('synth');
    try {
      const d = await postJson(`${base}/api/learn/synthesize`, {});
      if (d.ok) {
        setStrategy(d.strategy);
        setMsg(`Synthesized from ${d.profileCount} profiles.`);
      } else setMsg('Failed: ' + d.error);
    } catch (e) { setMsg('Failed: ' + e.message); }
    finally { setBusy(null); }
  };

  const applyStrategy = async () => {
    if (!strategy) return;
    setBusy('apply');
    try {
      const d = await postJson(`${base}/api/learn/apply`, {});
      if (d.ok) setMsg('Strategy applied to bot config. Ready to resume trading.');
      else setMsg('Failed: ' + d.error);
    } catch (e) { setMsg('Failed: ' + e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-drawer" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="cp-head">
          <span className="cp-title">📚 LEARNING ROOM</span>
          <button className="cc-btn cp-close" onClick={onClose}>✕</button>
        </div>

        {msg && <div className="cp-msg">{msg}</div>}

        <div className="cp-note" style={{ marginBottom: 12 }}>
          Paper trading is paused. Give the bot homework: paste a wallet's trades,
          it dissects the style. Add a few wallets, then synthesize a strategy.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            placeholder="Wallet address"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            style={{ flex: 2 }}
            className="cp-input"
          />
          <input
            placeholder="Label (e.g. 'my wallet')"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ flex: 1 }}
            className="cp-input"
          />
        </div>
        <textarea
          placeholder='Paste trades JSON: [{"symbol":"ZCAT","buys":[{"amount":51,"mcap":351000,"ts":123}],"sells":[...],"pnl":1275,"pnlPct":10.2}]'
          value={manualTrades}
          onChange={(e) => setManualTrades(e.target.value)}
          rows={4}
          style={{ width: '100%', marginBottom: 8 }}
          className="cp-input"
        />
        <button
          className="cp-bigbtn"
          disabled={busy === 'analyze' || !base}
          onClick={analyzeWallet}
          style={{ marginBottom: 16 }}
        >
          {busy === 'analyze' ? 'Analyzing…' : '📥 Analyze Wallet'}
        </button>

        {profiles.length > 0 && (
          <>
            <div className="cp-title" style={{ marginBottom: 8 }}>Style Profiles ({profiles.length})</div>
            {profiles.map((p) => (
              <div key={p.wallet} className="cp-card" style={{ marginBottom: 8, padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{p.label}</div>
                <div className="cp-note">
                  {p.profile.totalTrades} trades · {p.profile.winRate}% WR ·
                  P&L ${p.profile.totalPnl} · Avg hold {p.profile.avgHoldMin}m
                </div>
                <div className="cp-note">Entry: {p.profile.entryStyle}</div>
                {p.profile.leaks.map((l, i) => (
                  <div key={i} className="cp-note" style={{ color: '#f59e0b' }}>
                    ⚠️ {l.note}
                  </div>
                ))}
              </div>
            ))}

            <button
              className="cp-bigbtn"
              disabled={busy === 'synth' || !base}
              onClick={synthesize}
              style={{ marginTop: 8, marginBottom: 8 }}
            >
              {busy === 'synth' ? '…' : '🧬 Synthesize Strategy'}
            </button>
          </>
        )}

        {strategy && (
          <div className="cp-card" style={{ padding: 12, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Recommended Strategy</div>
            <div className="cp-note">Take Profit: {(strategy.takeProfit * 100).toFixed(0)}%</div>
            <div className="cp-note">Stop Loss: {(strategy.stopLoss * 100).toFixed(0)}%</div>
            <div className="cp-note">Max Hold: {strategy.maxHoldHours}h</div>
            {strategy.reasoning.map((r, i) => (
              <div key={i} className="cp-note" style={{ marginTop: 4 }}>→ {r}</div>
            ))}
            <button
              className="cp-bigbtn"
              disabled={busy === 'apply' || !base}
              onClick={applyStrategy}
              style={{ marginTop: 12 }}
            >
              {busy === 'apply' ? '…' : '✅ Apply to Bot'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
