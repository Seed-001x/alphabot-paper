// On-chain enrichment via public Solana RPC (no key).
// Used by VET's chain-kill pass: holder concentration + mint/freeze authorities.

const RPCS = [
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
];

async function rpcCall(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  let lastErr = null;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!r.ok) { lastErr = new Error('rpc_' + r.status); continue; }
      const j = await r.json();
      if (j.error) { lastErr = new Error('rpc_' + (j.error.code || 'err')); continue; }
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('rpc_down');
}

// Holder concentration: top-wallet share + top-10 share of supply.
// Returns { topPct, top10Pct } or nulls when the chain won't answer.
export async function holderConcentration(mint) {
  try {
    const [largest, supplyRes] = await Promise.all([
      rpcCall('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]),
      rpcCall('getTokenSupply', [mint, { commitment: 'confirmed' }]),
    ]);
    const accounts = (largest && largest.value) || [];
    const supplyRaw = supplyRes && supplyRes.value;
    const supply = supplyRaw ? Number(supplyRaw.amount) / Math.pow(10, supplyRaw.decimals || 0) : 0;
    if (!accounts.length || !(supply > 0)) return { topPct: null, top10Pct: null };
    const toUi = (a) => Number(a.amount) / Math.pow(10, a.decimals || 0);
    const sorted = accounts.map(toUi).sort((a, b) => b - a);
    const topPct = (sorted[0] / supply) * 100;
    const top10Pct = (sorted.slice(0, 10).reduce((s, v) => s + v, 0) / supply) * 100;
    return { topPct, top10Pct };
  } catch {
    return { topPct: null, top10Pct: null };
  }
}

// Mint layout: bytes 0-3 mintAuthorityOption, 45-48 freezeAuthorityOption (u32 LE).
// Returns { mintAuthOpen, freezeAuthOpen } — nulls when unreadable.
export async function mintAuthorities(mint) {
  try {
    const res = await rpcCall('getAccountInfo', [mint, { encoding: 'base64', commitment: 'confirmed' }]);
    const b64 = res && res.value && res.value.data && res.value.data[0];
    if (!b64 || typeof b64 !== 'string') return { mintAuthOpen: null, freezeAuthOpen: null };
    const bin = atob(b64);
    if (bin.length < 82) return { mintAuthOpen: null, freezeAuthOpen: null };
    const u32 = (o) =>
      bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8) |
      (bin.charCodeAt(o + 2) << 16) | (bin.charCodeAt(o + 3) << 24);
    return { mintAuthOpen: u32(0) !== 0, freezeAuthOpen: u32(45) !== 0 };
  } catch {
    return { mintAuthOpen: null, freezeAuthOpen: null };
  }
}
