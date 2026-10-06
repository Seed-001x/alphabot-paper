// Helius client — wallet transaction history, parsed into buys/sells.
// Runs in the USER'S browser (their IP, their key). CORS: *.
// NOTE: alphaboard-bot never bakes in an API key — it always comes from
// the Settings tab and lives only in this browser's localStorage.

const BASE = 'https://api.helius.xyz';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrFYD4KCoNkY11McCe8BenwNYB';
export const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);

export function getKey() { try { return localStorage.getItem('alphabot_helius_key') || ''; } catch { return ''; } }
export function setKey(k) { try { localStorage.setItem('alphabot_helius_key', (k || '').trim()); } catch {} }
export function clearKey() { try { localStorage.removeItem('alphabot_helius_key'); } catch {} }

export async function fetchWalletTxns(address, key, limit = 40) {
  const url = `${BASE}/v0/addresses/${address}/transactions?api-key=${encodeURIComponent(key)}&limit=${limit}`;
  const r = await fetch(url);
  if (r.status === 401 || r.status === 403) throw new Error('bad_key');
  if (!r.ok) throw new Error('helius_' + r.status);
  return r.json();
}

// Parse enhanced Helius txns into buys/sells for one wallet.
// Buy = wallet received token T, paid SOL and/or USDC.
export function parseSwaps(txns, wallet) {
  const buys = [], sells = [];
  for (const tx of txns || []) {
    if (tx.type !== 'SWAP') continue;
    const ts = (tx.timestamp || 0) * 1000;
    if (!ts) continue;
    const sig = tx.signature;
    const tIn = (tx.tokenTransfers || []).filter(t => t.toUserAccount === wallet && t.mint !== SOL_MINT && (t.tokenAmount || 0) > 0);
    const tOut = (tx.tokenTransfers || []).filter(t => t.fromUserAccount === wallet && (t.tokenAmount || 0) > 0);
    const solOut = (tx.nativeTransfers || []).filter(t => t.fromUserAccount === wallet).reduce((s, t) => s + (t.amount || 0), 0) / 1e9;
    if (!tIn.length) continue;
    // Split spend evenly if (rarely) multiple tokens bought in one tx.
    const per = tIn.length;
    for (const t of tIn) {
      const usdcOut = tOut.find(x => x.mint === USDC_MINT);
      buys.push({
        mint: t.mint, ts, sig,
        tokensIn: t.tokenAmount,
        solSpent: solOut / per,
        usdcSpent: usdcOut ? usdcOut.tokenAmount / per : 0,
      });
    }
    for (const t of tOut) {
      if (t.mint === USDC_MINT || t.mint === SOL_MINT) continue;
      sells.push({ mint: t.mint, ts, sig, tokensOut: t.tokenAmount });
    }
  }
  return { buys, sells };
}

// Activity-derived stats for the scoring engine (PnL/winRate stay null -> GMGN fills if reachable).
export function activityStats(buys, sells) {
  const all = [...buys, ...sells];
  const lastActiveTs = all.length ? Math.max(...all.map(t => t.ts)) : null;
  return {
    pnlUsd: null,
    winRate: null,
    trades: all.length,
    buys: buys.length,
    sells: sells.length,
    lastActiveTs,
    volumeUsd: null, // needs SOL price; filled by caller
  };
}
