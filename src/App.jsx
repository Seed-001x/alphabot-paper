// ALPHABOT v2 — token-first paper-trading desk. Neon UI, honest numbers.
// SCAN (DexScreener discovery) → VET (kill chain, ascending cost) → SCORE (0–100)
// → TRADE (paper entries) → RISK (rule exits). Fake money, real signals.

import { useState, useEffect, useCallback, useRef } from 'react';
import { loadConfig, saveConfig } from './lib/config.js';
import { getKey, STABLE_MINTS } from './lib/helius.js';
import { fetchTokens, tokenView, solPrice, lastSolPrice } from './lib/dexscreener.js';
import { isOnCurve, curveProgress } from './lib/pumpfun.js';
import { scanTokens, freeKill, tradeKill, vetToken } from './lib/pipeline.js';
import { researchToken } from './lib/research.js';
import { warmCalloutCache } from './lib/callouts.js';
import { judgeToken } from './lib/aiJudge.js';
import { probePumpPortal } from './lib/pumpportal.js';
import { Q } from './lib/queues.js';
import { logKill, logTradeEntry, logTradeExit, confirmKills } from './lib/learning.js';
import { startFlowWatch } from './lib/flowWatch.js';
import { floorEmit } from './lib/floorBus.js';
import {
  getBackendUrl, setBackendUrl, fetchHealth, fetchState, fetchEvents,
  isFresh,
} from './lib/backend.js';
import CommandCenter from './components/CommandCenter.jsx';
import { ELITE } from './lib/elite.js';
import { fetchWalletTxns, parseSwaps } from './lib/helius.js';
import {
  loadPortfolio, savePortfolio, resetPortfolio,
  isPaused, setPaused, processResult, logSignal, tick, snapshotEquity,
  statsFor, fmtAgo,
} from './lib/paper.js';
import { Banner } from './components/Chrome.jsx';
import { Positions, Trades } from './components/Feed.jsx';
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
      out[w.address] = { buys, sells };
    } catch { /* one failing address never kills the desk */ }
  });
  return out;
}

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [portfolio, setPortfolio] = useState(() => loadPortfolio(loadConfig(), lastSolPrice()));
  const [paused, setPausedState] = useState(isPaused());
  const [priceMap, setPriceMap] = useState({});
  const [seats, setSeats] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyState, setKeyState] = useState(getKey());
  const [now, setNow] = useState(Date.now());
  // v3.8 BACKEND MODE: when the server desk is alive and fresh (< 3 min),
  // the UI renders the server's snapshot and the local pipeline stays OFF.
  // Anything else → local mode, exactly as before. Fail-open, never blank.
  const [backendUrl, setBackendUrlState] = useState(getBackendUrl);
  const [backend, setBackend] = useState({ mode: 'local', health: null, data: null, checkedAt: 0, url: getBackendUrl() });
  const backendRef = useRef(backend);
  const seenEvRef = useRef(new Set()); // dedupe for translated server events

  const portfolioRef = useRef(portfolio);
  const configRef = useRef(config);
  const pausedRef = useRef(paused);
  const eliteSwapsRef = useRef(null);
  const loggedRef = useRef(new Map());
  // Smart-flow injection queue: mints detected by the silent flow watcher.
  // They enter the normal DD pipeline with zero shortcuts — just a tag.
  const flowQueueRef = useRef([]);
  const flowSeenRef = useRef(new Map()); // mint -> ts (90-min dedupe)
  const scanning = useRef(false);
  portfolioRef.current = portfolio;
  configRef.current = config;
  pausedRef.current = paused;
  backendRef.current = backend;

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

  // ---------------- v3.8 BACKEND MODE ----------------
  // Health gate: server mode only when /health is ok AND the server ran a
  // cycle within the last 3 min (free tier sleeps — staleness ⇒ local mode).
  const checkBackend = useCallback(async () => {
    const url = getBackendUrl();
    // Explicitly disabled → stay local, no network calls at all.
    if (!url) {
      setBackend(prev => (prev.mode === 'local'
        ? { ...prev, checkedAt: Date.now(), url: null }
        : { mode: 'local', health: null, data: null, checkedAt: Date.now(), url: null }));
      return;
    }
    try {
      const h = await fetchHealth(url);
      if (isFresh(h)) {
        const s = await fetchState(url);
        setBackend({ mode: 'server', health: h, data: s, checkedAt: Date.now(), url });
        return;
      }
    } catch { /* fail-open → local */ }
    setBackend(prev => (prev.mode === 'local'
      ? { ...prev, checkedAt: Date.now(), url }
      : { mode: 'local', health: null, data: null, checkedAt: Date.now(), url }));
  }, []);

  // Server event kinds → the floor's event shapes (backend uses `kind`).
  const KIND_MAP = { 'flow.mint': 'flow.inject' };
  const pollBackendEvents = useCallback(async () => {
    const b = backendRef.current;
    if (b.mode !== 'server' || !b.url) return;
    try {
      const evs = await fetchEvents(b.url, 60);
      const fresh = [];
      for (const e of evs) {
        if (!e || !e.kind || !e.ts) continue;
        const key = e.kind + '|' + e.ts + '|' + (e.mint || '');
        if (seenEvRef.current.has(key)) continue;
        fresh.push(e);
      }
      fresh.reverse(); // oldest-first so the floor animates in order
      for (const e of fresh) {
        const key = e.kind + '|' + e.ts + '|' + (e.mint || '');
        seenEvRef.current.add(key);
        const { kind, ...rest } = e; // rest.ts preserved by floorEmit's spread
        floorEmit(KIND_MAP[kind] || kind, rest);
      }
      if (seenEvRef.current.size > 3000) {
        const it = seenEvRef.current.values();
        for (let i = 0; i < 1000; i++) {
          const v = it.next().value;
          if (v === undefined) break;
          seenEvRef.current.delete(v);
        }
      }
    } catch { /* a dead poll is fine — next one soon */ }
  }, []);

  // Display-only price refresh for open positions in server mode.
  // NOT the pipeline: no scanning, no entries, no exits, no learning writes.
  const serverPriceTick = useCallback(async () => {
    const b = backendRef.current;
    if (b.mode !== 'server' || !b.data) return;
    const mints = [...new Set((b.data.portfolio.positions || []).map(x => x.mint))].slice(0, 40);
    if (!mints.length) return;
    try {
      const raw = await fetchTokens(mints);
      const pm = {};
      for (const m of mints) {
        const v = tokenView(raw[m]);
        if (v) pm[m] = v;
      }
      setPriceMap(pm);
    } catch { /* fail-open */ }
  }, []);

  function onBackendUrlSaved(u) {
    setBackendUrl(u);
    setBackendUrlState(getBackendUrl());
    setBackend({ mode: 'local', health: null, data: null, checkedAt: 0, url: getBackendUrl() });
  }

  // ---------------- SCAN → VET → SCORE → TRADE ----------------
  const scanCycle = useCallback(async () => {
    // v3.8: the local pipeline NEVER runs in server mode (no double trading).
    if (pausedRef.current || scanning.current || backendRef.current.mode === 'server') return;
    scanning.current = true;
    floorEmit('cycle.start', {});
    setSeat('scan', { working: true, val: '…', sub: 'pump.fun firehose + discovery' });
    const p = portfolioRef.current;
    const cfg = configRef.current;
    try {
      const { candidates, discovered } = await scanTokens();
      // Smart-flow injections: mints the silent layer saw bought. Enriched
      // here, then they run the exact same kill chain as everything else.
      {
        const nowQ = Date.now();
        for (const [m, ts] of flowSeenRef.current) if (nowQ - ts > 90 * 60000) flowSeenRef.current.delete(m);
        const fresh = [];
        while (flowQueueRef.current.length && fresh.length < 10) {
          const m = flowQueueRef.current.shift();
          if (!m || flowSeenRef.current.has(m)) continue;
          flowSeenRef.current.set(m, nowQ);
          fresh.push(m);
        }
        if (fresh.length) {
          try {
            const raw = await fetchTokens(fresh);
            for (const m of fresh) {
              const pair = raw[m];
              if (!pair) continue;
              const addr = m;
              const isPump = addr.endsWith('pump') || isOnCurve(pair);
              if (!isPump || STABLE_MINTS.has(addr)) continue;
              const t = tokenView(pair);
              if (!t || !t.price || !t.mc) continue;
              const dup = candidates.find(c => c.address === addr);
              if (dup) { dup.flowTag = true; continue; }
              const graduated = !isOnCurve(pair);
              candidates.push({
                ...t, source: 'flow', graduated,
                curvePct: graduated ? 100 : curveProgress(t.mc),
                flowTag: true,
              });
            }
            candidates.sort((a, b) => b.turnover - a.turnover);
          } catch { /* enrichment failure: flow mints wait for next cycle */ }
        }
      }
      // Floor: first ~14 candidates become visible chips (real tokens only).
      // v3.5 — STAGE QUEUES: scan pushes into Q.vet; each stage drains at its
      // own pace so slow research never blocks scanning. Stage logic untouched.
      for (const t of candidates) Q.vet.push(t);
      candidates.slice(0, 14).forEach(t =>
        floorEmit('scan.token', { mint: t.address, symbol: t.symbol, name: t.name, mc: t.mc, flow: !!t.flowTag }));
      setSeat('scan', { live: true, working: false, val: String(discovered), sub: `${candidates.length} enriched · vet q${Q.vet.size}` });

      let kills = 0, scored = 0, entries = 0;

      // VET stage: free + trade kill (cheap, sync). Survivors → Q.rug.
      setSeat('vet', { working: true, val: '…', sub: `free + trade kill · q${Q.vet.size}` });
      for (const t of Q.vet.drain(30)) {
        const fk = freeKill(t, cfg);
        if (fk) {
          kills++;
          logKill(t, 'free', fk);
          floorEmit('vet.kill', { mint: t.address, symbol: t.symbol, name: t.name, killPass: 'free', killReason: fk });
          emitSignal(processResult(p, { t, verdict: 'KILLED', killReason: fk, killPass: 'free' }, cfg, { silent: true }).signal);
          continue;
        }
        const tk = tradeKill(t, cfg);
        if (tk) {
          kills++;
          logKill(t, 'trade', tk);
          floorEmit('vet.kill', { mint: t.address, symbol: t.symbol, name: t.name, killPass: 'trade', killReason: tk });
          emitSignal(processResult(p, { t, verdict: 'KILLED', killReason: tk, killPass: 'trade' }, cfg, { silent: true }).signal);
          continue;
        }
        Q.rug.push(t);
      }

      // RUG stage: top of Q.rug by turnover (ascending cost). vetToken runs
      // the rug dossier pass; kills logged, survivors → Q.research.
      const rugBatch = Q.rug.drain(12);
      rugBatch.sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
      const rugNow = rugBatch.slice(0, 8);
      Q.rug.unshiftFront(rugBatch.slice(8));
      setSeat('vet', { working: true, val: String(kills), sub: `killed · rug-checking ${rugNow.length} · q${Q.rug.size}` });
      const vetted = await mapPool(rugNow, 3, t => vetToken(t, cfg));
      for (let i = 0; i < vetted.length; i++) {
        const v = vetted[i], t = rugNow[i];
        if (v.verdict === 'KILLED') {
          kills++;
          logKill(t, v.killPass || 'rug', v.killReason);
          emitSignal(processResult(p, { t, ...v }, cfg, { silent: true }).signal);
          continue;
        }
        Q.research.push({ t, v });
      }

      // RESEARCH stage: drains at its own pace — page reads are slow and must
      // never block scanning. Fail-open, never kills — only nudges ±10.
      const resBatch = Q.research.drain(5);
      if (resBatch.length) {
        setSeat('research', { working: true, val: '…', sub: `researching ${resBatch.length} · q${Q.research.size}` });
        warmCalloutCache(); // v3.4: fetch callout channel previews once per cycle
        const researched = await mapPool(resBatch, 3, async ({ t, v }) => {
          const research = await researchToken(t, v.dossier);
          // AI JUDGE seat: judgment numbers only, after keyword research.
          // No key → no-op. Never kills, never gates — just a modifier.
          const judge = await judgeToken(t, v.dossier, research);
          return { t, v, research, judge };
        });
        setSeat('research', { live: true, working: false, val: String(researched.length), sub: 'dossiers read · just now' });
        for (const r of researched) Q.score.push(r);
      } else {
        setSeat('research', { live: true, working: false, val: '0', sub: `idle · q${Q.research.size}` });
      }

      // SCORE/TRADE stage.
      const scoreBatch = Q.score.drain(12);
      // SOL price once per cycle for SOL-denominated position sizing (cached 2m).
      let spx = null;
      try { spx = await solPrice(); } catch { spx = null; }
      // Elite confirmation: only for scorers where the boost could clear the bar.
      const key = getKey();
      let eliteSwaps = null;
      const nearBar = scoreBatch.some(({ v }) => v.verdict === 'SCORED' && v.score >= cfg.minTokenScore - cfg.eliteBoost);
      if (key && nearBar) {
        setSeat('score', { working: true, val: '…', sub: 'elite confirmation' });
        eliteSwaps = await fetchEliteSwaps(key);
        eliteSwapsRef.current = eliteSwaps;
      }

      const scoredVals = [];
      for (const { t, v, research, judge } of scoreBatch) {
        scored++;
        // Combined research budget stays ±10 (keyword research + callouts + AI judge).
        const combinedMod = Math.max(-10, Math.min(10, (research.modifier || 0) + (judge.modifier || 0)));
        scoredVals.push(Math.max(0, Math.min(100, v.score + combinedMod)));
        let eliteHit = false;
        if (eliteSwaps) {
          for (const addr of Object.keys(eliteSwaps)) {
            if ((eliteSwaps[addr].buys || []).some(b => b.mint === t.address)) { eliteHit = true; break; }
          }
        }
        const { signal, entered } = processResult(
          p, {
            t, ...v, eliteHit, flowTag: !!t.flowTag,
            researchMod: combinedMod, researchLine: research.line,
            calloutLine: research.calloutLine || null,
            judgeMod: judge.modifier || 0, judgeLine: judge.line,
          },
          cfg, { silent: true, solPrice: spx });
        if (entered) {
          entries++;
          // v3.5 trade journal: snapshot the full decision context at entry.
          logTradeEntry({
            mint: t.address, symbol: t.symbol || '???', entryMc: signal.entryMc ?? t.mc ?? null,
            score: v.score, breakdown: v.breakdown || null, feeds: t.feeds || null,
            researchMod: combinedMod, researchLine: research.line || null,
            creator: t.creator || null,
          });
          Q.trade.push({ mint: t.address, symbol: t.symbol || '???', ts: Date.now() });
        }
        emitSignal(signal);
      }

      // v3.5 — slow background pass: confirm a few open kills per cycle.
      try { await confirmKills(); } catch { /* fail-open */ }

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

  // ---------------- smart-flow watcher: silent background layer ----------------
  // Dormant without a Helius key. v3.8: also dormant in server mode — the
  // server runs its own watcher with the server-side key (no double burn).
  useEffect(() => {
    if (backend.mode === 'server') return undefined;
    const key = getKey();
    if (!key) return undefined;
    const h = startFlowWatch(key, (mint) => {
      if (!mint) return;
      flowQueueRef.current.push(mint);
      floorEmit('flow.inject', { mint });
    });
    return () => h.stop();
  }, [keyState, backend.mode]);

  // ---------------- RISK: price tick + exits ----------------
  const priceTick = useCallback(async () => {
    // v3.8: no local repricing/exits in server mode — the server does it.
    if (pausedRef.current || backendRef.current.mode === 'server') return;
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
      // v3.5 trade journal: append outcomes to entries at exit.
      for (const tr of closedNow) {
        try {
          logTradeExit(tr);
          Q.risk.push({ mint: tr.mint, symbol: tr.symbol || '???', pnlPct: tr.multiple != null ? (tr.multiple - 1) * 100 : null, ts: Date.now() });
        } catch { /* fail-open */ }
      }
      snapshotEquity(p, pm);
      setSeat('risk', { live: true, val: String((p.positions || []).length), sub: `${closedNow.length} exits this tick · just now` });
      commitPortfolio();
    } catch { /* a dead tick is fine — next one soon */ }
  }, []);

  // ---------------- loops ----------------
  // v3.8: local loops run ONLY in local mode, and only after the first
  // backend health check has resolved (so server mode never double-runs).
  useEffect(() => {
    if (backend.mode !== 'local' || !backend.checkedAt) return undefined;
    probePumpPortal(); // PumpPortal WS probe (in-browser; fail-open)
    scanCycle();
    const t = setInterval(scanCycle, Math.max(20, config.scanIntervalSec) * 1000);
    return () => clearInterval(t);
  }, [scanCycle, config.scanIntervalSec, backend.mode, backend.checkedAt]);

  useEffect(() => {
    if (backend.mode !== 'local' || !backend.checkedAt) return undefined;
    priceTick();
    const t = setInterval(priceTick, Math.max(10, config.priceIntervalSec) * 1000);
    return () => clearInterval(t);
  }, [priceTick, config.priceIntervalSec, backend.mode, backend.checkedAt]);

  // v3.8: backend health gate — on load and every 30s. One quiet poll;
  // never tries to wake a sleeping free-tier service aggressively.
  useEffect(() => {
    checkBackend();
    const t = setInterval(checkBackend, 30000);
    return () => clearInterval(t);
  }, [checkBackend, backendUrl]);

  // v3.8: in server mode, stream the server's events into the floor (10s)
  // and keep position prices fresh for display (30s). Read-only.
  useEffect(() => {
    if (backend.mode !== 'server') return undefined;
    pollBackendEvents();
    serverPriceTick();
    const e = setInterval(pollBackendEvents, 10000);
    const p = setInterval(serverPriceTick, 30000);
    return () => { clearInterval(e); clearInterval(p); };
  }, [backend.mode, pollBackendEvents, serverPriceTick]);

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

  async function doReset() {
    // v3.8: SOL-denominated book — fetch live SOL once so the USD book value
    // is honest at creation. Falls back through last-known → 150.
    let spx = null;
    try { spx = await solPrice(); } catch { spx = null; }
    const p = resetPortfolio(config, spx);
    portfolioRef.current = p;
    loggedRef.current = new Map();
    eliteSwapsRef.current = null;
    commitPortfolio();
  }

  const localStats = statsFor(portfolio, priceMap);
  // v3.8: in server mode the desk renders the server's snapshot; the local
  // portfolio/ledgers sit untouched in localStorage.
  const isServer = backend.mode === 'server' && !!(backend.data && backend.data.portfolio);
  const dispPortfolio = isServer ? backend.data.portfolio : portfolio;
  const dispStats = isServer
    ? (backend.data.stats || statsFor(backend.data.portfolio, priceMap))
    : localStats;
  const effPaused = isServer ? false : paused; // server mode is read-only
  const backendModeInfo = {
    mode: backend.mode,
    lastCycleTs: backend.health ? backend.health.lastCycleTs : null,
    url: backend.url,
  };

  return (
    <>
      <Banner />
      <CommandCenter
        portfolio={dispPortfolio}
        priceMap={priceMap}
        stats={dispStats}
        now={now}
        paused={effPaused}
        onTogglePaused={isServer ? () => {} : togglePaused}
        onOpenSettings={() => setSettingsOpen(true)}
        flowOn={isServer ? !!((backend.data.keys || {}).helius) : !!keyState}
        backendMode={backendModeInfo}
        readOnly={isServer}
        serverBrain={isServer ? backend.data.brain : null}
        serverExitRules={isServer ? backend.data.exitRules : null}
        feedRows={isServer ? backend.data.feeds : null}
        feedTs={isServer ? backend.data.ts : null}
      />
      <main className="wrap">
        {effPaused && (
          <div className="panel" style={{ borderColor: 'var(--amb)', textAlign: 'center', color: 'var(--amb)', letterSpacing: 2, fontSize: 11 }}>
            ❚❚ DESK PAUSED — scans and ticks halted
          </div>
        )}
        {isServer && (
          <div className="panel" style={{ borderColor: 'rgba(61,255,143,.25)', textAlign: 'center', color: 'var(--grn)', letterSpacing: 2, fontSize: 10 }}>
            ◈ SERVER DESK — rendering the 24/7 pipeline · read-only · local mode takes over if it goes stale
          </div>
        )}
        <Positions positions={dispPortfolio.positions} priceMap={priceMap} />
        <Trades closed={dispPortfolio.closed} />
      </main>

      <footer className="foot">
        ALPHABOT v2 · pump.fun desk · RugCheck + DexScreener · virtual P&amp;L is not real profit — not financial advice
      </footer>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onConfig={applyConfig}
        portfolio={dispPortfolio}
        priceMap={priceMap}
        onReset={doReset}
        paused={effPaused}
        onTogglePaused={isServer ? () => {} : togglePaused}
        keyState={keyState}
        onKeySaved={setKeyState}
        readOnly={isServer}
        backendUrl={backendUrl}
        onBackendUrl={onBackendUrlSaved}
        backendMode={backendModeInfo}
      />
    </>
  );
}
