// ALPHABOT v2 — token-first paper-trading desk. Neon UI, honest numbers.
// SCAN (DexScreener discovery) → VET (kill chain, ascending cost) → SCORE (0–100)
// → TRADE (paper entries) → RISK (rule exits). Fake money, real signals.

import { useState, useEffect, useCallback, useRef } from 'react';
import { loadConfig, saveConfig } from './lib/config.js';
import { getKey } from './lib/helius.js';
import { fetchTokens, tokenView } from './lib/dexscreener.js';
import { scanTokens, freeKill, tradeKill, vetToken } from './lib/pipeline.js';
import { researchToken } from './lib/research.js';
import { floorEmit } from './lib/floorBus.js';
import ResearchTerminal from './components/Research.jsx';
import AgentFloor from './components/AgentFloor.jsx';
import Roamers from './components/Roamers.jsx';
import { ELITE } from './lib/elite.js';
import { fetchWalletTxns, parseSwaps } from './lib/helius.js';
import {
  loadPortfolio, savePortfolio, resetPortfolio,
  isPaused, setPaused, processResult, logSignal, tick, snapshotEquity,
  statsFor, fmtAgo,
} from './lib/paper.js';
import { Banner, Header, Seats } from './components/Chrome.jsx';
import Equity from './components/Equity.jsx';
import { SignalFeed, Positions, Trades } from './components/Feed.jsx';
import Settings from './components/Settings.jsx';

const LOG_DEDUP_MS = 20 * 60 * 1000;

async function mapPool(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  }
  return out;
}

async function fetchEliteSwaps(key) {
  const out = {};
  await mapPool(ELITE, 5, async (w) => {
    try {
      const txns = await fetchWalletTxns(w.address, key, 25);
      const { buys, sells } = parseSwaps(txns, w.address);
      out[w.address] = { label: w.label, buys, sells };
    } catch { /* one wallet failing never kills the desk */ }
  });
  return out;
}

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [portfolio, setPortfolio] = useState(() => loadPortfolio(loadConfig()));
  const [paused, setPausedState] = useState(isPaused());
  const [priceMap, setPriceMap] = useState({});
  const [seats, setSeats] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyState, setKeyState] = useState(getKey());
  const [now, setNow] = useState(Date.now());
  const [roamersOn, setRoamersOn] = useState(() => {
    try { return localStorage.getItem('alphabot_roamers_v2') !== 'off'; } catch { return true; }
  });

  function toggleRoamers() {
    setRoamersOn((prev) => {
      const next = !prev;
      try { localStorage.setItem('alphabot_roamers_v2', next ? 'on' : 'off'); } catch { /* ignore */ }
      return next;
    });
  }

  const portfolioRef = useRef(portfolio);
  const configRef = useRef(config);
  const pausedRef = useRef(paused);
  const eliteSwapsRef = useRef(null);
  const loggedRef = useRef(new Map());
  const scanning = useRef(false);
  portfolioRef.current = portfolio;
  configRef.current = config;
  pausedRef.current = paused;

  function setSeat(id, s) {
    setSeats(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...s } }));
  }

  function commitPortfolio() {
    const p = portfolioRef.current;
    savePortfolio(p);
    setPortfolio({ ...p, positions: [...(p.positions || [])], closed: [...(p.closed || [])], signals: [...(p.signals || [])], equity: [...(p.equity || [])] });
  }

  function applyConfig(next) {
    saveConfig(next);
    configRef.current = next;
    setConfig(next);
  }

  // Dedup feed logging: entries always log; repeats of the same verdict+reason
  // for a mint are quiet for 20 min so the kill feed stays readable.
  function emitSignal(sig) {
    const p = portfolioRef.current;
    if (sig.taken) {
      logSignal(p, sig);
      loggedRef.current.set(sig.mint, { k: 'ENTER', ts: Date.now() });
      return;
    }
    const k = sig.verdict + '|' + (sig.killReason || sig.score);
    const last = loggedRef.current.get(sig.mint);
    if (last && last.k === k && Date.now() - last.ts < LOG_DEDUP_MS) return;
    logSignal(p, sig);
    loggedRef.current.set(sig.mint, { k, ts: Date.now() });
  }

  // ---------------- SCAN → VET → SCORE → TRADE ----------------
  const scanCycle = useCallback(async () => {
    if (pausedRef.current || scanning.current) return;
    scanning.current = true;
    floorEmit('cycle.start', {});
    setSeat('scan', { working: true, val: '…', sub: 'pump.fun firehose + discovery' });
    const p = portfolioRef.current;
    const cfg = configRef.current;
    try {
      const { candidates, discovered } = await scanTokens();
      // Floor: first ~14 candidates become visible chips (real tokens only).
      candidates.slice(0, 14).forEach(t =>
        floorEmit('scan.token', { mint: t.address, symbol: t.symbol, name: t.name, mc: t.mc }));
      setSeat('scan', { live: true, working: false, val: String(discovered), sub: `${candidates.length} enriched · just now` });

      setSeat('vet', { working: true, val: '…', sub: 'free + trade kill' });
      let kills = 0, scored = 0, entries = 0;
      const survivors = [];
      for (const t of candidates) {
        const fk = freeKill(t, cfg);
        if (fk) {
          kills++;
          floorEmit('vet.kill', { mint: t.address, symbol: t.symbol, name: t.name, killPass: 'free', killReason: fk });
          emitSignal(processResult(p, { t, verdict: 'KILLED', killReason: fk, killPass: 'free' }, cfg, { silent: true }).signal);
          continue;
        }
        const tk = tradeKill(t, cfg);
        if (tk) {
          kills++;
          floorEmit('vet.kill', { mint: t.address, symbol: t.symbol, name: t.name, killPass: 'trade', killReason: tk });
          emitSignal(processResult(p, { t, verdict: 'KILLED', killReason: tk, killPass: 'trade' }, cfg, { silent: true }).signal);
          continue;
        }
        survivors.push(t);
      }

      // Rug-kill only the top of the queue (ranked by turnover) — ascending cost.
      survivors.sort((a, b) => b.turnover - a.turnover);
      const vetBatch = survivors.slice(0, 12);
      setSeat('vet', { working: true, val: String(kills), sub: `killed · rug-checking top ${vetBatch.length}` });
      const vetted = await mapPool(vetBatch, 3, t => vetToken(t, cfg));

      // Elite confirmation: only for scorers where the boost could clear the bar.
      const key = getKey();
      let eliteSwaps = null;
      const nearBar = vetted.some(v => v.verdict === 'SCORED' && v.score >= cfg.minTokenScore - cfg.eliteBoost);
      if (key && nearBar) {
        setSeat('score', { working: true, val: '…', sub: 'elite confirmation' });
        eliteSwaps = await fetchEliteSwaps(key);
        eliteSwapsRef.current = eliteSwaps;
      }

      // RESEARCH seat: post-kill-chain, pre-score. Fail-open, never kills —
      // only nudges the score ±10. Runs on kill-chain survivors only.
      const scoredList = [];
      for (let i = 0; i < vetted.length; i++) {
        const v = vetted[i], t = vetBatch[i];
        if (v.verdict === 'KILLED') {
          kills++;
          emitSignal(processResult(p, { t, ...v }, cfg, { silent: true }).signal);
          continue;
        }
        scoredList.push({ t, v });
      }
      let researched = scoredList;
      if (scoredList.length) {
        setSeat('research', { working: true, val: '…', sub: `researching ${scoredList.length}` });
        researched = await mapPool(scoredList, 3, async ({ t, v }) => ({
          t, v, research: await researchToken(t, v.dossier),
        }));
        setSeat('research', { live: true, working: false, val: String(researched.length), sub: 'dossiers read · just now' });
      } else {
        setSeat('research', { live: true, working: false, val: '0', sub: 'no survivors · idle' });
      }

      const scoredVals = [];
      for (const { t, v, research } of researched) {
        scored++;
        scoredVals.push(Math.max(0, Math.min(100, v.score + research.modifier)));
        let eliteHit = false;
        const eliteLabels = [];
        if (eliteSwaps) {
          for (const addr of Object.keys(eliteSwaps)) {
            if ((eliteSwaps[addr].buys || []).some(b => b.mint === t.address)) {
              eliteHit = true;
              eliteLabels.push(eliteSwaps[addr].label);
            }
          }
        }
        const { signal, entered } = processResult(
          p, { t, ...v, eliteHit, eliteLabels, researchMod: research.modifier, researchLine: research.line },
          cfg, { silent: true });
        if (entered) entries++;
        emitSignal(signal);
      }

      const avg = scoredVals.length ? Math.round(scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length) : null;
      setSeat('vet', { live: true, working: false, val: String(kills), sub: 'killed this cycle' });
      setSeat('score', { live: true, working: false, val: avg == null ? '—' : String(avg), sub: `${scored} scored · just now` });
      setSeat('trade', { live: true, val: String((p.positions || []).length), sub: `${entries} entries · ${(p.positions || []).length} open` });
      commitPortfolio();
    } catch {
      setSeat('scan', { working: false, val: 'ERR', sub: 'scan hiccup — retrying' });
    } finally {
      scanning.current = false;
    }
  }, []);

  // ---------------- RISK: price tick + exits ----------------
  const priceTick = useCallback(async () => {
    if (pausedRef.current) return;
    const p = portfolioRef.current;
    const cfg = configRef.current;
    const mints = new Set((p.positions || []).map(x => x.mint));
    for (const s of (p.signals || []).slice(0, 25)) if (s.mint) mints.add(s.mint);
    const arr = [...mints].slice(0, 40);
    if (!arr.length) return;
    try {
      const raw = await fetchTokens(arr);
      const pm = {};
      for (const m of arr) {
        const v = tokenView(raw[m]);
        if (v) pm[m] = v;
      }
      setPriceMap(pm);
      const closedNow = tick(p, pm, eliteSwapsRef.current, cfg);
      snapshotEquity(p, pm);
      setSeat('risk', { live: true, val: String((p.positions || []).length), sub: `${closedNow.length} exits this tick · just now` });
      commitPortfolio();
    } catch { /* a dead tick is fine — next one soon */ }
  }, []);

  // ---------------- loops ----------------
  useEffect(() => {
    scanCycle();
    const t = setInterval(scanCycle, Math.max(20, config.scanIntervalSec) * 1000);
    return () => clearInterval(t);
  }, [scanCycle, config.scanIntervalSec]);

  useEffect(() => {
    priceTick();
    const t = setInterval(priceTick, Math.max(10, config.priceIntervalSec) * 1000);
    return () => clearInterval(t);
  }, [priceTick, config.priceIntervalSec]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') priceTick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [priceTick]);

  function togglePaused() {
    const next = !paused;
    setPaused(next);
    setPausedState(next);
  }

  function doReset(bankroll0) {
    const p = resetPortfolio(bankroll0);
    portfolioRef.current = p;
    loggedRef.current = new Map();
    eliteSwapsRef.current = null;
    commitPortfolio();
  }

  const stats = statsFor(portfolio, priceMap);

  return (
    <>
      <Banner />
      <Header
        equity={stats.equity}
        pnlPct={stats.totalPnlPct}
        openCount={stats.openCount}
        paused={paused}
        onTogglePaused={togglePaused}
        onOpenSettings={() => setSettingsOpen(true)}
        now={now}
        eliteOn={!!keyState}
        roamersOn={roamersOn}
        onToggleRoamers={toggleRoamers}
      />
      <main className="wrap">
        {paused && (
          <div className="panel" style={{ borderColor: 'var(--amb)', textAlign: 'center', color: 'var(--amb)', letterSpacing: 2, fontSize: 11 }}>
            ❚❚ DESK PAUSED — scans and ticks halted
          </div>
        )}
        <Seats seats={seats} />
        <AgentFloor />
        <ResearchTerminal />

        <div className="panel">
          <h2 className="panel-title">◈ Equity · virtual</h2>
          <div className="eq-head">
            <span className={'eq-big ' + (stats.totalPnl >= 0 ? 'v grn' : 'v red')}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(stats.equity)}</span>
            <span className={stats.totalPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
              {stats.totalPnl >= 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(stats.totalPnl)}
              {' '}({stats.totalPnlPct == null ? '—' : (stats.totalPnlPct * 100).toFixed(1) + '%'})
            </span>
            <span style={{ color: 'var(--dim)', fontSize: 11 }}>cash {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(stats.cash)}</span>
          </div>
          <Equity points={portfolio.equity} bankroll0={portfolio.bankroll0} />
          <div className="legend">
            <span><span className="lg grn" />equity</span>
            <span><span className="lg mag" />starting bankroll</span>
          </div>
        </div>

        <SignalFeed signals={portfolio.signals} />
        <Positions positions={portfolio.positions} priceMap={priceMap} />
        <Trades closed={portfolio.closed} />
      </main>

      <footer className="foot">
        ALPHABOT v2 · pump.fun desk · RugCheck + DexScreener · virtual P&amp;L is not real profit — not financial advice
      </footer>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onConfig={applyConfig}
        portfolio={portfolio}
        priceMap={priceMap}
        onReset={doReset}
        paused={paused}
        onTogglePaused={togglePaused}
        keyState={keyState}
        onKeySaved={setKeyState}
      />
      {roamersOn && <Roamers />}
    </>
  );
}
