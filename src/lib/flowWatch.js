// flowWatch — silent smart-money flow watcher ("backend" signal layer).
// Watches the curated FLOW_ADDRS set for fresh SOL→token buys and injects
// the mint into the normal DD pipeline (VET kill chain → RESEARCH → SCORE).
// It never scores, never boosts, never decides — it is a DISCOVERY source
// only. Dormant without a Helius key. Fail-open on every error.
//
// Credit discipline: rotation of 20 addresses per loop, one loop per ~3 min
// (full rotation ≈ 24 min). One cheap getSignaturesForAddress (limit 3) per
// address per loop; the parsed-txn fetch happens ONLY when a new signature
// appears. ~400 sig-list calls/hour + a handful of parses on real activity.

import { FLOW_ADDRS } from './flowAddrs.js';
import { parseSwaps, STABLE_MINTS, SOL_MINT } from './helius.js';

const BATCH = 20;
const LOOP_MS = 180000;
const SIG_LIMIT = 3;
const REQ_TIMEOUT_MS = 10000;

const LS_CURSOR = 'alphabot_flow_cursor';
const LS_SIGS = 'alphabot_flow_sigs';
const LS_REQS = 'alphabot_flow_reqs';

function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : v; } catch { return fb; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function getReqs() { return Number(lsGet(LS_REQS, 0)) || 0; }
function bumpReqs(n = 1) { lsSet(LS_REQS, String(getReqs() + n)); }

// Session request counter for the Settings readout.
export function getFlowStats() {
  return { requests: getReqs(), batch: BATCH, loopMin: Math.round(LOOP_MS / 60000) };
}

function loadSigMap() {
  try {
    const m = JSON.parse(lsGet(LS_SIGS, '{}'));
    return (m && typeof m === 'object') ? m : {};
  } catch { return {}; }
}
function saveSigMap(m) {
  const keys = Object.keys(m);
  if (keys.length > FLOW_ADDRS.length + 10) {
    for (const k of keys.slice(0, keys.length - FLOW_ADDRS.length - 10)) delete m[k];
  }
  lsSet(LS_SIGS, JSON.stringify(m));
}

async function rpcCall(key, method, params, timeoutMs = REQ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    bumpReqs(1);
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error('rpc_' + r.status);
    const j = await r.json();
    if (j.error) throw new Error('rpc_err');
    return j.result;
  } finally { clearTimeout(to); }
}

async function fetchParsedTxn(key, sig, timeoutMs = REQ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    bumpReqs(1);
    const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactions: [sig] }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error('helius_' + r.status);
    return r.json();
  } finally { clearTimeout(to); }
}

// Start the watcher. onMint(mint) fires for each detected SOL→token buy.
// Returns { stop, active }. No key → dormant no-op.
export function startFlowWatch(key, onMint) {
  if (!key) return { stop() {}, active: false };
  let alive = true;
  let timer = 0;

  async function loopOnce() {
    if (!alive) return;
    const sigs = loadSigMap();
    let cursor = Number(lsGet(LS_CURSOR, 0)) || 0;
    const batch = [];
    for (let i = 0; i < BATCH; i++) batch.push(FLOW_ADDRS[(cursor + i) % FLOW_ADDRS.length]);
    cursor = (cursor + BATCH) % FLOW_ADDRS.length;
    lsSet(LS_CURSOR, String(cursor));

    for (const addr of batch) {
      if (!alive) break;
      try {
        const list = await rpcCall(key, 'getSignaturesForAddress', [addr, { limit: SIG_LIMIT }]);
        if (!Array.isArray(list) || !list.length) continue;
        const newest = list[0] && list[0].signature;
        if (!newest || sigs[addr] === newest) continue;
        sigs[addr] = newest; // record before parse — a parse failure never re-triggers
        try {
          const txns = await fetchParsedTxn(key, newest);
          const { buys } = parseSwaps(txns, addr);
          for (const b of buys) {
            if (!b || !b.mint || b.mint === SOL_MINT || STABLE_MINTS.has(b.mint)) continue;
            try { onMint(b.mint); } catch {}
          }
        } catch { /* parse failure: skip silently */ }
      } catch { /* one address failing never kills the loop */ }
    }
    saveSigMap(sigs);
  }

  (async () => {
    await new Promise(r => setTimeout(r, 15000)); // let first paint + scan land first
    if (!alive) return;
    await loopOnce().catch(() => {});
    if (alive) timer = setInterval(() => { loopOnce().catch(() => {}); }, LOOP_MS);
  })();

  return {
    active: true,
    stop() { alive = false; if (timer) clearInterval(timer); },
  };
}
