// ALPHABOT v2 config — token-first desk. All values editable in Settings.
// Money is virtual (paper trading). Nothing here promises profit.

export const DEFAULT_CONFIG = {
  bankrollSol: 5,    // v3.8: SOL-denominated book — 5 SOL virtual
  bankroll0: 1000,   // USD fallback ONLY if bankrollSol is unset — applies on reset
  // --- SCAN / VET (kill chain, ascending cost) — pump.fun tuned ---
  // v3.10: WIDER NET (user: "quick trades teach the bot") — lower the bar,
  // let scoring decide. Hard kills only for true rug vectors.
  minTokenScore: 55,      // v3.10: was 65 — trade more, learn faster
  minLiquidityUsd: 2000,  // DEX LP floor — GRADUATED coins only (on-curve skip; the curve IS their liquidity)
  minVol24hUsd: 2500,    // v3.10: was 5000 — let the volume filter breathe
  pumpMinMc: 20000,       // on-curve MC floor — the $20k floor IS the newness filter (user's directive)
  pumpMaxMc: 100000,      // v3.12: sub-$100k universe — hard ceiling
  minMc: 50000,           // graduated MC floor
  maxMc: 100000,          // v3.12: sub-$100k universe — hard ceiling
  minAgeMin: 0,           // DISABLED (user's directive) — newborns vetted on merit, never killed for being young
  maxPumpAgeHrs: 48,      // on-curve max age (hours)
  maxAgeDays: 7,          // graduated max age (days)
  minBuys24h: 3,          // v3.10: was 5 — three buys is a market
  requireSells: true,
  maxDevPct: 25,          // dev/creator share cap (%)
  minHolders: 5,          // v3.10: was 10 — five holders is enough to vet on merit
  maxTopHolderPct: 35,    // top holder share cap (%)
  maxTop10Pct: 70,        // top-10 share cap (%)
  eliteBoost: 8,          // score points added on smart-flow confirmation
  // --- TRADE (paper risk engine) ---
  // v3.6 SCALP RETUNE: faster trades → more closed trades → journal fills
  // quicker. TP +30%, SL −15%, trailing −12% arms +10%, 90-min max hold.
  maxPositions: 5,
  // v3.12: sub-$100k universe. Score bands only — no small trades, min 1 SOL.
  // 55–74 → 1.0 SOL · 75–84 → 1.5 SOL · 85+ → 2.0 SOL.
  // (Whale rule retired — nothing over $100k can enter. Early-ape keys kept
  // for tuning but unused in sizing while the universe is sub-$100k.)
  solSizeBase: 1.0,   // v3.9: NO small trades — min 1 SOL per entry
  solSizeMid: 1.5,
  solSizeTop: 2.0,
  // v3.8 EARLY-APE: mc < earlyMcUsd && score ≥ earlyMinScore → earlySolSize SOL
  earlyMcUsd: 100000,
  earlyMinScore: 80,
  earlySolSize: 1.5,
  takeProfit: 0.30,
  stopLoss: 0.15,
  trailingStop: 0.12,
  trailingArmAt: 0.10,
  maxHoldHours: 1.5,
  cooldownMin: 30,
  slippage: 0.05,
  // --- LOOP ---
  scanIntervalSec: 45,
  priceIntervalSec: 20,
};

export const RISK_META = {
  bankrollSol: { label: 'Starting bankroll', unit: 'SOL', min: 0.1, max: 100, hint: 'Applies on reset only. Virtual SOL — USD book value set at live SOL price.' },
  minTokenScore: { label: 'Min token score', unit: '0–100', min: 0, max: 100, hint: 'v3.10: 55 — trade more, learn faster (quick trades teach the bot).' },
  minLiquidityUsd: { label: 'Min liquidity', unit: 'USD', min: 0, max: 1000000, hint: 'Free-kill floor — GRADUATED coins only (on-curve skip; the curve is their liquidity).' },
  minVol24hUsd: { label: 'Min 24h volume', unit: 'USD', min: 0, max: 5000000, hint: 'v3.10: $2.5k — let the volume filter breathe.' },
  pumpMinMc: { label: 'Pump min MC (on-curve)', unit: 'USD', min: 0, max: 1000000, hint: 'Free-kill floor for bonding-curve coins.' },
  pumpMaxMc: { label: 'Pump max MC (on-curve)', unit: 'USD', min: 10000, max: 500000, hint: 'v3.12: hard ceiling $100k — sub-100k universe only.' },
  minMc: { label: 'Min market cap (graduated)', unit: 'USD', min: 0, max: 10000000, hint: 'Free-kill floor for graduated coins.' },
  maxMc: { label: 'Max market cap (graduated)', unit: 'USD', min: 20000, max: 500000, hint: 'v3.12: hard ceiling $100k — sub-100k universe only.' },
  minAgeMin: { label: 'Min coin age', unit: 'minutes', min: 0, max: 600, hint: '0 = disabled. Newborns are vetted on merit (MC/vol/holders), never killed for youth.' },
  maxPumpAgeHrs: { label: 'Max pump age (on-curve)', unit: 'hours', min: 1, max: 240, hint: 'Free-kill ceiling for bonding-curve coins.' },
  maxAgeDays: { label: 'Max age (graduated)', unit: 'days', min: 1, max: 90, hint: 'Free-kill ceiling for graduated coins.' },
  minBuys24h: { label: 'Min 24h buys', unit: 'count', min: 1, max: 1000, hint: 'v3.10: 3 — three buys is a market.' },
  maxDevPct: { label: 'Max dev share', unit: '%', min: 5, max: 100, hint: 'Kill if the dev/creator holds more than this.' },
  minHolders: { label: 'Min holders', unit: 'count', min: 1, max: 500, hint: 'v3.10: 5 — five holders is enough to vet on merit.' },
  maxTopHolderPct: { label: 'Max top-holder share', unit: '%', min: 5, max: 100, hint: 'Kill if the biggest holder owns more than this.' },
  maxTop10Pct: { label: 'Max top-10 share', unit: '%', min: 10, max: 100, hint: 'Kill if the top 10 own more than this.' },
  eliteBoost: { label: 'Smart-flow boost', unit: 'points', min: 0, max: 25, hint: 'Added to score on smart-flow confirmation.' },
  maxPositions: { label: 'Max open positions', unit: 'count', min: 1, max: 25, hint: '5 — min 1 SOL/trade on a 5-SOL book.' },
  solSizeBase: { label: 'Size · score 55–74', unit: 'SOL', min: 0.1, max: 5, hint: 'NO small trades — min 1 SOL per entry.' },
  solSizeMid: { label: 'Size · score 75–84', unit: 'SOL', min: 0.1, max: 5, hint: 'Mid-conviction entries.' },
  solSizeTop: { label: 'Size · score 85+', unit: 'SOL', min: 0.1, max: 5, hint: 'Highest-conviction entries.' },
  earlyMcUsd: { label: 'Early-ape MC ceiling', unit: 'USD', min: 10000, max: 1000000, hint: 'Kept for tuning — unused in sizing while the universe is sub-$100k.' },
  earlyMinScore: { label: 'Early-ape min score', unit: '0–100', min: 0, max: 100, hint: 'Kept for tuning — unused in sizing while the universe is sub-$100k.' },
  earlySolSize: { label: 'Early-ape size', unit: 'SOL', min: 0.1, max: 10, hint: 'Kept for tuning — unused in sizing while the universe is sub-$100k.' },
  takeProfit: { label: 'Take profit', unit: '% gain', min: 5, max: 500, pct: true, hint: 'Exit when multiple hits this gain.' },
  stopLoss: { label: 'Stop loss', unit: '% drop', min: 5, max: 90, pct: true, hint: 'Exit when multiple drops this much.' },
  trailingStop: { label: 'Trailing stop', unit: '% from peak', min: 5, max: 80, pct: true, hint: 'Exit on this pullback from peak multiple.' },
  maxHoldHours: { label: 'Max hold time', unit: 'hours', min: 1, max: 72, hint: 'Force-exit after this long.' },
  cooldownMin: { label: 'Token cooldown', unit: 'minutes', min: 5, max: 240, hint: 'Wait after exiting before re-entering a token.' },
  scanIntervalSec: { label: 'Scan interval', unit: 'seconds', min: 20, max: 300, hint: 'How often the desk scans for fresh tokens.' },
  priceIntervalSec: { label: 'Price tick', unit: 'seconds', min: 10, max: 120, hint: 'How often open positions are repriced.' },
};

const CONFIG_KEY = 'alphabot_config_v2';
export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}
export function saveConfig(c) { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch {} }
