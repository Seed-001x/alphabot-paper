// RESEARCH seat: post-kill-chain, pre-score dossier reader.
// Runs only on kill-chain survivors (the ~3 per cycle, never the firehose).
// Signals, all free + browser-friendly:
//   a) link discovery — DexScreener pair info: twitter/x, telegram, website
//      presence (presence only; the sites themselves are never fetched — CORS).
//   a1) social hunt fallback (v2.9) — when (a) finds ZERO links, actively
//      hunt: the token's own pump.fun coin page (own socials + description,
//      keyword-scanned) then a DuckDuckGo web search as last resort for an X
//      account. Finds are UNVERIFIED: +1 credit (vs +2 verified), always
//      labeled "(unverified)", never presented as confirmed. Read-only.
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
// Rate limits: 1 fetch/candidate, ≤5 fetches per 60s window, 2s stagger,
// per-session URL dedupe. Fail-open: anything wrong → null ("no data").
const READ_MS = 10000;
const READ_MAX_PER_WINDOW = 5;
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

// ---------------------------------------------------------- social hunt (v2.9)
// Fallback chain for kill-chain survivors with ZERO discovered links.
// Instead of recording "no links" and moving on, the agent actively hunts:
//   a) the token's own pump.fun coin page (own socials + description), then
//   b) a DuckDuckGo web search as a last resort for an X account.
// HONESTY: everything found here is UNVERIFIED — a matching name is not
// proof. Credit is smaller than verified links (+1 vs +2), the research line
// says "(unverified)", and the mini-browser tags these reads visually.
// Read-only: never follows, messages, or otherwise interacts with accounts.
// Same budgets as siteRead: shared r.jina.ai window (≤5/60s), 2s stagger,
// 10s timeout, fail-open everywhere.
const X_PATH_EXCLUDE = /^(search|home|explore|notifications|messages|i|pumpfun|pumpdotfun|intent|share)$/i;
const TG_EXCLUDE = /^(pump_tech_updates|pumpfun|pumpdotfun)$/i;
const NON_PROJECT_DOM = /(pump\.fun|solscan\.io|dexscreener\.com|birdeye\.so|geckoterminal\.com|jup\.ag|raydium\.io|x\.com|twitter\.com|t\.me|t\.co|axiom|gmgn|photon|bullx|padre\.gg|join\.pump\.fun|mypinata\.cloud|images\.pump\.fun|socialimages\.pump\.fun|ipfs\.io|docs\.pump\.fun)/i;

const xHandleRe = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?=[?\/\s)\]"']|$)/gi;
const tgRe = /https?:\/\/(?:www\.)?t\.me\/([A-Za-z0-9_]{5,})/gi;
const urlRe = /https?:\/\/[^\s)\]"']+/gi;

// The pump.fun coin page is noisy (live feed of OTHER coins with their own
// X links). Only links in the coin's own header block count: the h1 title
// line plus the ~10 lines after it (age, mint, social icons, dev row).
function extractCoinSocials(md, t) {
  const lines = md.split('\n');
  const sym = (t.symbol || '').toLowerCase();
  const name = (t.name || '').toLowerCase();
  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s/.test(lines[i])) {
      const low = lines[i].toLowerCase();
      if ((sym && sym.length >= 2 && low.includes(sym)) ||
          (name && name.length >= 3 && low.includes(name))) { hi = i; break; }
    }
  }
  if (hi < 0) return null;
  const block = lines.slice(hi, hi + 12).join('\n');
  const out = { x: null, telegram: null, website: null };
  let m;
  xHandleRe.lastIndex = 0;
  while ((m = xHandleRe.exec(block))) {
    if (X_PATH_EXCLUDE.test(m[1])) continue;
    if (!out.x) out.x = m[1];
  }
  tgRe.lastIndex = 0;
  while ((m = tgRe.exec(block))) {
    if (TG_EXCLUDE.test(m[1])) continue;
    if (!out.telegram) out.telegram = m[1];
  }
  urlRe.lastIndex = 0;
  while ((m = urlRe.exec(block))) {
    const u = m[0].replace(/[.,;!?]+$/, '');
    if (!/^https?:\/\//i.test(u) || NON_PROJECT_DOM.test(u)) continue;
    if (!out.website) out.website = u;
  }
  return out;
}

function extractDescription(md) {
  const lines = md.split('\n');
  const si = lines.findIndex(l => /^###\s*Description/i.test(l.trim()));
  if (si < 0) return '';
  const out = [];
  for (let i = si + 1; i < lines.length && out.join('\n').length < 2000; i++) {
    if (/^###\s/.test(lines[i])) break;
    if (lines[i].trim()) out.push(lines[i].trim());
  }
  return out.join('\n').slice(0, 2000);
}

// Reads the token's own pump.fun page. Returns { socials, kwDelta, kwVerdict }
// or null. Emits the same bread-* events as siteRead so the mini-browser and
// crawler wall show the read happening with the real coin URL.
async function coinPageRead(t) {
  const url = `https://pump.fun/coin/${t.address}`;
  const now = Date.now();
  if (now - readWindow.start > READ_WINDOW_MS) readWindow = { start: now, count: 0 };
  if (readWindow.count >= READ_MAX_PER_WINDOW) {
    rlog('  └ hunt → fetch budget spent this cycle', 'dim');
    return null;
  }
  if (readUrls.has(url)) return null;

  return scheduleRead(async () => {
    const gap = READ_STAGGER_MS - (Date.now() - lastReadAt);
    if (gap > 0) await sleep(gap);
    lastReadAt = Date.now();
    readWindow.count += 1;
    readUrls.add(url);

    emit('bread-start', { mint: t.address, symbol: t.symbol, url, domain: 'pump.fun', hunt: true });
    rlog('  └ hunt → reading coin page…', 'dim');
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
      rlog(`  └ hunt → coin page unreadable (${e.message || 'timeout'})`, 'dim');
      emit('bread-fail', { mint: t.address, symbol: t.symbol, url, domain: 'pump.fun', reason: e.message || 'timeout' });
      return null;
    }

    const socials = extractCoinSocials(raw, t) || { x: null, telegram: null, website: null };
    const desc = extractDescription(raw);
    // Focused read: only THIS coin's header + description are shown/scored.
    // The rest of the page is other coins' live feeds — scoring it would
    // attribute strangers' keywords to this token.
    const focusText = [desc ? `Description: ${desc}` : '',
      socials.x ? `X: https://x.com/${socials.x}` : '',
      socials.telegram ? `Telegram: https://t.me/${socials.telegram}` : '',
      socials.website ? `Website: ${socials.website}` : '']
      .filter(Boolean).join('\n').slice(0, 4000);

    const hits = scanKeywords(focusText);
    const found = new Set(hits.map(h => h.kw));
    let delta = 0;
    const why = [];
    if (found.has('whitepaper') || found.has('docs')) { delta += 2; why.push('docs/whitepaper'); }
    if (found.has('audit')) { delta += 2; why.push('audit'); }
    const riskOcc = hits.filter(h => h.kind === 'risk').reduce((a, h) => a + h.count, 0);
    if (riskOcc >= 3) { delta -= 4; why.push(`${riskOcc} risk hits`); }
    const kwVerdict = delta !== 0
      ? `${delta > 0 ? '+' : ''}${delta} · ${why.join(', ')}`
      : (focusText.trim() ? '+0 · clean read' : '+0 · no description');
    const tone = delta > 0 ? 'grn' : delta < 0 ? 'red' : 'dim';
    rlog(`  └ hunt → coin page: ${hits.length} keyword hits → ${kwVerdict}`, tone);
    emit('bread-done', {
      mint: t.address, symbol: t.symbol, url, domain: 'pump.fun',
      text: focusText || '— coin page loaded, no description or socials in header —',
      hits, delta, verdict: kwVerdict, unverified: true, hunt: true,
      trustN: hits.filter(h => h.kind === 'trust').length,
      riskN: hits.filter(h => h.kind === 'risk').length,
    });
    return { socials, kwDelta: delta, kwVerdict };
  });
}

// Last resort: web search for the project's X account. Decodes DuckDuckGo's
// uddg redirect params to real URLs, then matches x.com handles against the
// token's symbol/name. A matching name is NOT proof — result is unverified.
async function ddgHunt(t) {
  const q = encodeURIComponent(`${t.symbol || ''} ${t.name || ''} solana`.trim());
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  const now = Date.now();
  if (now - readWindow.start > READ_WINDOW_MS) readWindow = { start: now, count: 0 };
  if (readWindow.count >= READ_MAX_PER_WINDOW) {
    rlog('  └ hunt → fetch budget spent this cycle', 'dim');
    return null;
  }
  if (readUrls.has(url)) return null;

  return scheduleRead(async () => {
    const gap = READ_STAGGER_MS - (Date.now() - lastReadAt);
    if (gap > 0) await sleep(gap);
    lastReadAt = Date.now();
    readWindow.count += 1;
    readUrls.add(url);

    emit('bread-start', { mint: t.address, symbol: t.symbol, url, domain: 'duckduckgo.com', hunt: true });
    rlog('  └ hunt → searching web for X account…', 'dim');
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
      rlog(`  └ hunt → search failed (${e.message || 'timeout'})`, 'dim');
      emit('bread-fail', { mint: t.address, symbol: t.symbol, url, domain: 'duckduckgo.com', reason: e.message || 'timeout' });
      return null;
    }

    const urls = [];
    const uddgRe = /uddg=([^&\s)"']+)/g;
    let m;
    while ((m = uddgRe.exec(raw))) {
      try { urls.push(decodeURIComponent(m[1])); } catch { /* bad escape */ }
    }
    const sym = (t.symbol || '').toLowerCase();
    const nameToks = (t.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(s => s.length >= 3);
    let best = null, bestScore = 0;
    xHandleRe.lastIndex = 0;
    for (const u of urls) {
      xHandleRe.lastIndex = 0;
      const xm = xHandleRe.exec(u);
      if (!xm || X_PATH_EXCLUDE.test(xm[1])) continue;
      const hl = xm[1].toLowerCase();
      let s = 0;
      if (sym && sym.length >= 2 && hl.includes(sym)) s = 3;
      else if (nameToks.some(tok => hl.includes(tok))) s = 2;
      if (s > bestScore) { bestScore = s; best = { handle: xm[1], url: u }; }
    }

    const text = (raw || '').split('\n').filter(l => l.trim()).slice(0, 40).join('\n').slice(0, 4000);
    if (best) {
      const verdict = `possible X: @${best.handle} (unverified)`;
      rlog(`  └ hunt → search: @${best.handle} (unverified)`, 'grn');
      emit('bread-done', {
        mint: t.address, symbol: t.symbol, url, domain: 'duckduckgo.com',
        text, hits: [], delta: 0, verdict, unverified: true, hunt: true,
      });
      return best;
    }
    rlog('  └ hunt → search: no X match', 'dim');
    emit('bread-done', {
      mint: t.address, symbol: t.symbol, url, domain: 'duckduckgo.com',
      text, hits: [], delta: 0, verdict: 'no X match', unverified: true, hunt: true,
    });
    return null;
  });
}

// The fallback chain itself. Returns { delta, line, count } or null.
// Always resolves. Never throws.
async function socialHunt(t, deadline) {
  rlog('  └ hunt → 0 links, hunting socials…', 'dim');
  floorEmit('hunt.start', { mint: t.address, symbol: t.symbol, name: t.name });
  const parts = [];
  let delta = 0;
  let foundX = false;

  // 1) the token's own pump.fun page: own socials + description
  if (Date.now() < deadline) {
    const coin = await coinPageRead(t);
    if (coin) {
      const s = coin.socials;
      if (s.x) { delta += 1; foundX = true; parts.push(`possible X: @${s.x} (unverified)`); }
      if (s.telegram) { delta += 1; parts.push('possible tg (unverified)'); }
      if (s.website) { delta += 1; parts.push('possible site (unverified)'); }
      if (coin.kwDelta) { delta += coin.kwDelta; parts.push(`read: ${coin.kwVerdict}`); }
      bumpStats({ links: stats.links + (s.x || s.telegram || s.website ? 1 : 0) });
    }
  }

  // 2) last resort: web search for an X account
  if (!foundX && Date.now() < deadline) {
    const ddg = await ddgHunt(t);
    if (ddg) {
      delta += 1; foundX = true;
      parts.push(`possible X: @${ddg.handle} (unverified, search)`);
    }
  }

  const result = parts.length || delta !== 0
    ? { delta, line: `hunt: ${parts.length ? parts.join(' · ') : 'no socials found'}`, count: parts.length }
    : null;
  rlog(`  └ hunt → ${result ? parts.join(' · ') : 'nothing found'}`, result ? 'grn' : 'dim');
  floorEmit('hunt.done', { mint: t.address, symbol: t.symbol, name: t.name, found: !!result, line: result ? result.line : 'no socials found' });
  return result;
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
  let zeroLinks = false;
  if (Date.now() < deadline) {
    try {
      links = await linkCheck(t.address);
      bumpStats({ checks: stats.checks + 1 });
      const found = [];
      if (links.hasTwitter) { modifier += 2; found.push('twitter'); }
      if (links.hasTelegram) { modifier += 2; found.push('telegram'); }
      if (links.hasWebsite) { modifier += 2; found.push('site'); }
      bumpStats({ links: stats.links + found.length });
      zeroLinks = found.length === 0;
      bits.push(found.length ? `links: ${found.join('+')}` : 'links: none');
      rlog(`  └ links → ${found.length ? found.join(' + ') : 'none found'}`, found.length ? 'grn' : 'dim');
    } catch {
      bumpStats({ checks: stats.checks + 1 });
      bits.push('links: ?');
      rlog('  └ links → no data', 'dim');
    }
  }

  // (a1) SOCIAL HUNT FALLBACK (v2.9): zero discovered links → actively hunt
  // instead of moving on. Coin page first (own socials + description), then
  // a web search as last resort for an X account. Finds are UNVERIFIED:
  // smaller credit (+1 vs +2), never presented as confirmed.
  // Mutually exclusive with the (a2) website read below (that only runs when
  // a website link was already found), so still ≤1 page read per candidate
  // here, plus at most one search fetch.
  if (links && zeroLinks && Date.now() < deadline) {
    try {
      const hunt = await socialHunt(t, deadline);
      bumpStats({ checks: stats.checks + 1 });
      if (hunt) {
        modifier += hunt.delta;
        bits.push(hunt.line);
      } else {
        bits.push('hunt: no socials found');
      }
    } catch {
      bits.push('hunt: ?');
      rlog('  └ hunt → error, skipping', 'dim');
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
        const ctag = `creator ${creator.slice(0, 3)}…`;
        if (e.launches > SERIAL_LAUNCHES) {
          modifier -= 4;
          bumpStats({ creatorsFlagged: stats.creatorsFlagged + 1 });
          bits.push(`creator: serial launcher (${e.launches} launches)`);
          rlog(`  └ creator ${short(creator)} → SERIAL (${e.launches} launches) −4`, 'red');
          floorEmit('ledger.check', { mint: t.address, symbol: t.symbol, tag: ctag, launches: e.launches, verdict: 'serial' });
        } else if (e.launches > 1) {
          modifier += 2;
          bits.push(`creator: ${e.launches} launches, clean`);
          rlog(`  └ creator ${short(creator)} → ${e.launches} launches, clean +2`, 'grn');
          floorEmit('ledger.check', { mint: t.address, symbol: t.symbol, tag: ctag, launches: e.launches, verdict: 'clean' });
        } else {
          bits.push('creator: first seen');
          rlog(`  └ creator ${short(creator)} → first seen`, 'dim');
          floorEmit('ledger.check', { mint: t.address, symbol: t.symbol, tag: ctag, launches: 1, verdict: 'first' });
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
