// pump.fun discovery + RugCheck enrichment. No key, CORS: * on both.
// Discovery: RugCheck new_tokens firehose → mint ends with "pump" (pump.fun
// mints always carry the pump suffix). Gives exact createAt, creator wallet,
// and mint/freeze authority state for free.
// Enrichment: RugCheck /tokens/{mint}/report — holder distribution, dev
// holdings, risk flags. Unknown fields stay null, never faked.

const RC = 'https://api.rugcheck.xyz/v1';
export const PUMP_SUFFIX = 'pump';
// pump.fun bonding curve completes (graduates to Raydium) at ~$69k mcap.
export const PUMP_GRAD_MC = 69000;

const reportCache = new Map(); // mint -> { report, ts }
const REPORT_TTL = 120000;

// Fresh pump.fun launches, newest first. The firehose only holds the latest
// ~10 tokens chain-wide, so this is the bleeding edge — thin but exact.
export async function fetchFreshPumpCoins(limit = 40) {
  try {
    const r = await fetch(`${RC}/stats/new_tokens`);
    if (!r.ok) return [];
    const arr = await r.json();
    const out = [];
    for (const t of arr || []) {
      const mint = t.mint || '';
      if (!mint.endsWith(PUMP_SUFFIX)) continue;
      out.push({
        address: mint,
        symbol: t.symbol || '???',
        creator: t.creator || null,
        // RugCheck gives authorities as strings; empty = revoked (clean).
        mintAuthOpen: t.mintAuthority ? true : t.mintAuthority === '' ? false : null,
        freezeAuthOpen: t.freezeAuthority ? true : t.freezeAuthority === '' ? false : null,
        createdAt: t.createAt ? Date.parse(t.createAt) : null,
        source: 'pump-fresh',
      });
      if (out.length >= limit) break;
    }
    rememberFresh(out);
    return [...recallFresh(), ...out.filter(o => !recallFresh().some(rf => rf.address === o.address))];
  } catch { return recallFresh(); }
}

// Rolling window: the firehose is a 10-token snapshot, so remember what we've
// seen for 90 minutes — a poll that catches nothing still vets recent launches.
const FRESH_KEY = 'alphabot_pumpfresh_v1';
const FRESH_TTL = 90 * 60 * 1000;
function recallFresh() {
  try {
    const raw = localStorage.getItem(FRESH_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    const now = Date.now();
    return (arr || []).filter(f => f.address && now - (f.seenAt || 0) < FRESH_TTL);
  } catch { return []; }
}
function rememberFresh(coins) {
  try {
    const now = Date.now();
    const seen = new Map(recallFresh().map(f => [f.address, f]));
    for (const c of coins) if (!seen.has(c.address)) seen.set(c.address, { ...c, seenAt: now });
    const pruned = [...seen.values()].filter(f => now - (f.seenAt || 0) < FRESH_TTL).slice(-120);
    localStorage.setItem(FRESH_KEY, JSON.stringify(pruned));
  } catch { /* storage is a nicety, not a dependency */ }
}

// Full holder/risk dossier for one mint. Cached 2 min.
export async function fetchRugReport(mint) {
  const now = Date.now();
  const c = reportCache.get(mint);
  if (c && now - c.ts < REPORT_TTL && c.report) return c.report;
  try {
    const r = await fetch(`${RC}/tokens/${mint}/report`);
    if (!r.ok) return null;
    const d = await r.json();
    const holders = d.topHolders || [];
    const topPct = holders.length ? holders[0].pct : null;
    const top10Pct = holders.length
      ? holders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0)
      : null;
    const creator = d.creator || null;
    const devEntry = creator ? holders.find(h => h.owner === creator) : null;
    const report = {
      topPct,
      top10Pct,
      holderCount: d.totalHolders != null ? d.totalHolders : null,
      devPct: devEntry ? devEntry.pct : null,
      rugged: d.rugged === true,
      risks: (d.risks || []).map(x => x.name).filter(Boolean).slice(0, 6),
      scoreNorm: d.score_normalised != null ? d.score_normalised : null,
      launchpad: d.launchpad || null,
    };
    reportCache.set(mint, { report, ts: now });
    return report;
  } catch { return null; }
}

// Bonding-curve completion % from mcap (on-curve pairs only).
export function curveProgress(mc) {
  if (!(mc > 0)) return null;
  return Math.min(100, (mc / PUMP_GRAD_MC) * 100);
}

// True when this pair is still on the pump.fun bonding curve.
export function isOnCurve(pair) {
  return pair && pair.dexId === 'pump';
}
