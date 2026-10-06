// RESEARCH seat: post-kill-chain, pre-score dossier reader.
// Runs only on kill-chain survivors (the ~3 per cycle, never the firehose).
// Signals, all free + browser-friendly:
//   a) link discovery — DexScreener pair info: twitter/x, telegram, website
//      presence (presence only; the sites themselves are never fetched — CORS).
//   b) creator ledger — desk-local history of pump.fun creator addresses:
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
import { floorEmit } from './floorBus.js';

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
  const siteUrl = (websites || []).map(w => w.url).find(u =>
    u && /^https?:\/\//i.test(u) && !/dexscreener|birdeye|rugcheck|solscan/i.test(u)) || null;
  return { hasTwitter, hasTelegram, hasWebsite, siteUrl };
}

function metaCheck(t) {
  const sym = (t.symbol || '').toUpperCase();
  const name = t.name || '';
  const copycat = COPYCATS.has(sym);
  const sane = !copycat && sym.length >= 2 && sym.length <= 12 &&
    name.length >= 2 && name.length <= 48 && /^[A-Za-z0-9 $._-]+$/.test(sym);
  return { image: !!t.image, copycat, sane };
}

// ---------------------------------------------------------- site reader
// (v2.5) Real page fetch for candidates that have a website link.
// Via the r.jina.ai reader proxy (CORS-open, returns page markdown as text).
// Plain-text keyword scan only — never rendered as HTML (XSS-safe by design).
// Rate limits: 1 fetch/candidate, ≤3 fetches per 60s window, 2s stagger,
// per-session URL dedupe. Fail-open: anything wrong → null ("no data").
const READ_MS = 10000;
const READ_MAX_PER_WINDOW = 3;
const READ_WINDOW_MS = 60000;
const READ_STAGGER_MS = 2000;
const readUrls = new Set();
let readWindow = { start: 0, count: 0 };
let lastReadAt = 0;
let readChain = Promise.resolve();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TRUST_KWS = ['audit', 'audited', 'liquidity lock', 'locked liquidity', 'whitepaper', 'docs', 'roadmap', 'team', 'github', 'open source'];
const RISK_KWS = ['guaranteed', '100x', '1000x', 'moon', 'elon', 'presale bonus', 'send sol', 'double your'];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scanKeywords(text) {
  const hits = [];
  const scan = (kw, kind) => {
    let m;
    try { m = text.match(new RegExp(`\\b${escRe(kw)}\\b`, 'gi')); }
    catch { return; }
    if (m && m.length) hits.push({ kw, kind, count: m.length });
  };
  TRUST_KWS.forEach(k => scan(k, 'trust'));
  RISK_KWS.forEach(k => scan(k, 'risk'));
  return hits;
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

// Always resolves. Returns null when skipped/failed (fail-open).
async function siteRead(url, t, tag) {
  const domain = domainOf(url);
  const now = Date.now();
  if (now - readWindow.start > READ_WINDOW_MS) readWindow = { start: now, count: 0 };
  if (readWindow.count >= READ_MAX_PER_WINDOW) {
    rlog('  └ read → fetch budget spent this cycle', 'dim');
    return null;
  }
  if (readUrls.has(url)) return null;

  // Serialize + stagger so concurrent research calls can't burst the proxy.
  return scheduleRead(async () => {
    const gap = READ_STAGGER_MS - (Date.now() - lastReadAt);
    if (gap > 0) await sleep(gap);
    lastReadAt = Date.now();
    readWindow.count += 1;
    readUrls.add(url);

    emit('bread-start', { mint: t.address, symbol: t.symbol, url, domain });
    rlog(`  └ read → fetching ${domain}…`, 'dim');
    let raw;
    try {
      raw = await withTimeout(
        fetch(`https://r.jina.ai/${url}`).then(r => {
          if (!r.ok) throw new Error(`reader ${r.status}`);
          return r.text();
        }),
        READ_MS
      );
    } catch (e) {
      rlog(`  └ read → ${domain} unreadable (${e.message || 'timeout'})`, 'dim');
      emit('bread-fail', { mint: t.address, symbol: t.symbol, url, domain, reason: e.message || 'timeout' });
      return null;
    }
    const text = (raw || '').split('\n').filter(l => l.trim()).slice(0, 40).join('\n').slice(0, 4000);
    if (!text.trim()) {
      rlog(`  └ read → ${domain} empty`, 'dim');
      emit('bread-fail', { mint: t.address, symbol: t.symbol, url, domain, reason: 'empty' });
      return null;
    }

    const hits = scanKeywords(text);
    const found = new Set(hits.map(h => h.kw));
    let delta = 0;
    const why = [];
    if (found.has('whitepaper') || found.has('docs')) { delta += 2; why.push('docs/whitepaper'); }
    if (found.has('audit')) { delta += 2; why.push('audit'); }
    const riskOcc = hits.filter(h => h.kind === 'risk').reduce((a, h) => a + h.count, 0);
    if (riskOcc >= 3) { delta -= 4; why.push(`${riskOcc} risk hits`); }

    const verdict = delta !== 0
      ? `${delta > 0 ? '+' : ''}${delta} · ${why.join(', ')}`
      : `+0 · clean read`;
    const tone = delta > 0 ? 'grn' : delta < 0 ? 'red' : 'dim';
    rlog(`  └ read → ${domain}: ${hits.length} keyword hits → ${verdict}`, tone);
    emit('bread-done', {
      mint: t.address, symbol: t.symbol, url, domain,
      text, hits, delta, verdict, trustN: hits.filter(h => h.kind === 'trust').length,
      riskN: hits.filter(h => h.kind === 'risk').length,
    });
    return { delta, verdict };
  });
}

function scheduleRead(fn) {
  const p = readChain.then(fn);
  readChain = p.catch(() => {});
  return p;
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
  floorEmit('research.start', { mint: t.address, symbol: t.symbol, name: t.name });

  // (a) link discovery
  let links = null;
  if (Date.now() < deadline) {
    try {
      links = await linkCheck(t.address);
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

  // (a2) site read — real page fetch + keyword scan (v2.5)
  // Only when the candidate has a website link. Fail-open: skipped/failed
  // reads contribute nothing and never block the pipeline.
  if (links && links.siteUrl && Date.now() < deadline) {
    const res = await siteRead(links.siteUrl, t, tag);
    if (res) {
      modifier += res.delta;
      bits.push(`read: ${res.verdict}`);
      bumpStats({ checks: stats.checks + 1 });
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
  floorEmit('research.done', { mint: t.address, symbol: t.symbol, name: t.name, modifier, line: bits.join(' · ') });
  return { modifier, line: bits.join(' · '), checks: bits.length };
}

export async function researchToken(t, dossier) {
  try {
    return await withTimeout(researchInner(t, dossier), TOTAL_MS);
  } catch {
    rlog(`▸ ${short(t.address)} ${t.symbol || '???'} · research timeout → +0`, 'dim');
    floorEmit('research.done', { mint: t.address, symbol: t.symbol, name: t.name, modifier: 0, line: 'no data' });
    return { modifier: 0, line: 'no data', checks: 0 };
  }
}
