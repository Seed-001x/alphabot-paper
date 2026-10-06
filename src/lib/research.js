// RESEARCH seat: post-kill-chain, pre-score dossier reader.
// Runs only on kill-chain survivors (the ~3 per cycle, never the firehose).
// Signals, all free + browser-friendly:
//   a) link discovery — DexScreener pair info: twitter/x, telegram, website
//      presence (presence only; the sites themselves are never fetched — CORS).
//   b) creator ledger — desk-local history of pump.fun creator wallets:
//      launch counts observed by this desk. Serial launchers (>5) flagged.
//      (No public creator-history API exists; the ledger is honest about that.)
//   c) metadata quality — image presence, name/symbol sanity, copycat-ticker
//      heuristic against major Solana memes.
//
// Output: a score modifier clamped to [-10, +10] plus a human-readable line.
// SAFETY: research NEVER kills a candidate and NEVER overrides the kill
// chain — it only nudges the score. Fail-open: any error or timeout returns
// modifier 0 ("no data") and the pipeline continues untouched.
// Hard budgets: 8s per fetch, 20s total per candidate.

import { fetchTokens } from './dexscreener.js';

const FETCH_MS = 8000;
const TOTAL_MS = 20000;
const SERIAL_LAUNCHES = 5;
const LEDGER_KEY = 'alphabot_creator_ledger_v1';
const LEDGER_MAX = 500;

// Major Solana meme tickers — exact symbol match on a fresh token is a
// copycat heuristic, labeled as such, never a verdict.
const COPYCATS = new Set([
  'BONK', 'WIF', 'POPCAT', 'MEW', 'BOME', 'SLERF', 'PENGU', 'JUP', 'RAY',
  'PYTH', 'JTO', 'ORCA', 'GOAT', 'ACT', 'FWOG', 'MICHI', 'MUMU', 'NEIRO',
  'MOODENG', 'CHILLGUY', 'PNUT', 'FARTCOIN', 'TRUMP', 'MELANIA',
]);

// ---------------------------------------------------------- live event bus
// The terminal UI subscribes; research emits streaming log lines + counters.
const listeners = new Set();
const stats = { dossiers: 0, checks: 0, links: 0, creatorsFlagged: 0 };
export function subscribeResearch(cb) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function getResearchStats() { return { ...stats }; }
function emit(type, payload) {
  for (const cb of listeners) { try { cb({ type, ...payload }); } catch { /* UI is a nicety */ } }
}
function bumpStats(patch) {
  Object.assign(stats, patch);
  emit('stats', { stats: getResearchStats() });
}
function rlog(text, tone) {
  emit('line', { text, tone: tone || '' });
}

const short = (a) => (a && a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : (a || '?'));

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);

// ---------------------------------------------------------- creator ledger
// Desk-local: every researched candidate records its creator once per mint.
// Outcomes are kill-chain verdicts observed by this desk — honest scope.
function loadLedger() {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || {}; }
  catch { return {}; }
}
function saveLedger(l) {
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(l)); }
  catch { /* storage is a nicety */ }
}
function noteCreatorLaunch(creator, mint) {
  if (!creator) return null;
  const l = loadLedger();
  const e = l[creator] || { launches: 0, seen: {} };
  if (!e.seen[mint]) { e.seen[mint] = 1; e.launches += 1; }
  e.lastSeen = Date.now();
  l[creator] = e;
  const keys = Object.keys(l);
  if (keys.length > LEDGER_MAX) delete l[keys[0]];
  saveLedger(l);
  return e;
}

// ---------------------------------------------------------- sub-checks
async function linkCheck(address) {
  // DexScreener batch endpoint is cached 60s — usually a free hit.
  const raw = await withTimeout(fetchTokens([address]), FETCH_MS);
  const pair = raw[address];
  if (!pair) throw new Error('no pair');
  const info = pair.info || {};
  const socials = info.socials || [];
  const websites = info.websites || [];
  const hasTwitter = socials.some(s =>
    /twitter/i.test(s.type || '') || /(twitter\.com|x\.com)/i.test(s.url || ''));
  const hasTelegram = socials.some(s =>
    /telegram/i.test(s.type || '') || /t\.me|telegram/i.test(s.url || ''));
  const hasWebsite = (websites || []).some(w =>
    w.url && !/dexscreener|birdeye|rugcheck|solscan/i.test(w.url));
  return { hasTwitter, hasTelegram, hasWebsite };
}

function metaCheck(t) {
  const sym = (t.symbol || '').toUpperCase();
  const name = t.name || '';
  const copycat = COPYCATS.has(sym);
  const sane = !copycat && sym.length >= 2 && sym.length <= 12 &&
    name.length >= 2 && name.length <= 48 && /^[A-Za-z0-9 $._-]+$/.test(sym);
  return { image: !!t.image, copycat, sane };
}

// ---------------------------------------------------------- main entry
// researchToken(t, dossier) -> { modifier, line, checks }
// Always resolves. Never throws. Never kills.
async function researchInner(t, dossier) {
  const deadline = Date.now() + TOTAL_MS;
  const tag = `${short(t.address)} ${t.symbol || '???'}`;
  const bits = [];
  let modifier = 0;

  rlog(`▸ ${tag} · opening dossier…`, 'dim');

  // (a) link discovery
  if (Date.now() < deadline) {
    try {
      const links = await linkCheck(t.address);
      bumpStats({ checks: stats.checks + 1 });
      const found = [];
      if (links.hasTwitter) { modifier += 2; found.push('twitter'); }
      if (links.hasTelegram) { modifier += 2; found.push('telegram'); }
      if (links.hasWebsite) { modifier += 2; found.push('site'); }
      bumpStats({ links: stats.links + found.length });
      bits.push(found.length ? `links: ${found.join('+')}` : 'links: none');
      rlog(`  └ links → ${found.length ? found.join(' + ') : 'none found'}`, found.length ? 'grn' : 'dim');
    } catch {
      bumpStats({ checks: stats.checks + 1 });
      bits.push('links: ?');
      rlog('  └ links → no data', 'dim');
    }
  }

  // (b) creator ledger
  if (Date.now() < deadline) {
    try {
      const creator = t.creator || null;
      bumpStats({ checks: stats.checks + 1 });
      if (creator) {
        const e = noteCreatorLaunch(creator, t.address);
        if (e.launches > SERIAL_LAUNCHES) {
          modifier -= 4;
          bumpStats({ creatorsFlagged: stats.creatorsFlagged + 1 });
          bits.push(`creator: serial launcher (${e.launches} launches)`);
          rlog(`  └ creator ${short(creator)} → SERIAL (${e.launches} launches) −4`, 'red');
        } else if (e.launches > 1) {
          modifier += 2;
          bits.push(`creator: ${e.launches} launches, clean`);
          rlog(`  └ creator ${short(creator)} → ${e.launches} launches, clean +2`, 'grn');
        } else {
          bits.push('creator: first seen');
          rlog(`  └ creator ${short(creator)} → first seen`, 'dim');
        }
      } else {
        bits.push('creator: ?');
        rlog('  └ creator → unknown', 'dim');
      }
    } catch {
      bits.push('creator: ?');
    }
  }

  // (c) metadata quality (no fetch — pure inspection)
  if (Date.now() < deadline) {
    bumpStats({ checks: stats.checks + 1 });
    const meta = metaCheck(t);
    if (meta.copycat) {
      modifier -= 4;
      bits.push('meta: copycat ticker?');
      rlog('  └ meta → copycat-ticker heuristic −4', 'red');
    } else {
      if (meta.image) modifier += 1;
      if (meta.sane) modifier += 1;
      bits.push(`meta: ${meta.image ? 'img' : 'no-img'}${meta.sane ? '' : ' · sketchy name'}`);
      rlog(`  └ meta → ${meta.image ? 'has image' : 'no image'}${meta.sane ? '' : ', sketchy name'}`, 'dim');
    }
  }

  modifier = Math.max(-10, Math.min(10, modifier));
  bumpStats({ dossiers: stats.dossiers + 1 });
  const arrow = modifier > 0 ? `+${modifier}` : `${modifier}`;
  const tone = modifier > 0 ? 'grn' : modifier < 0 ? 'red' : 'dim';
  rlog(`▸ ${tag} · ${bits.join(' · ')} → ${arrow}`, tone);
  return { modifier, line: bits.join(' · '), checks: bits.length };
}

export async function researchToken(t, dossier) {
  try {
    return await withTimeout(researchInner(t, dossier), TOTAL_MS);
  } catch {
    rlog(`▸ ${short(t.address)} ${t.symbol || '???'} · research timeout → +0`, 'dim');
    return { modifier: 0, line: 'no data', checks: 0 };
  }
}
