// ALPHABOT v2 config — token-first desk. All values editable in Settings.
// Money is virtual (paper trading). Nothing here promises profit.

export const DEFAULT_CONFIG = {
  bankrollSol: 5,    // v3.8: SOL-denominated book — 5 SOL virtual (whale-ape 2.5 SOL = 50% of book, user's chosen aggression)
  bankroll0: 1000,   // USD fallback ONLY if bankrollSol is unset — applies on reset
  // --- SCAN / VET (kill chain, ascending cost) — pump.fun tuned ---
  minTokenScore: 65,      // entry: token score must clear this (after elite boost)
  minLiquidityUsd: 3000,
  minVol24hUsd: 10000,
  pumpMinMc: 5000,        // on-curve MC floor
  pumpMaxMc: 2000000,     // on-curve MC cap (curve completes ~$69k; cap keeps it early)
  minMc: 50000,           // graduated MC floor
  maxMc: 30000000,        // graduated MC cap
  minAgeMin: 5,
  maxPumpAgeHrs: 48,      // on-curve max age (hours)
  maxAgeDays: 7,          // graduated max age (days)
  minBuys24h: 10,
  requireSells: true,
  maxDevPct: 25,          // dev/creator share cap (%)
  minHolders: 25,         // holder count floor
  maxTopHolderPct: 35,    // top holder share cap (%)
  maxTop10Pct: 70,        // top-10 share cap (%)
  eliteBoost: 8,          // score points added on smart-flow confirmation
  // --- TRADE (paper risk engine) ---
  // v3.6 SCALP RETUNE: faster trades → more closed trades → journal fills
  // quicker. TP +30%, SL −15%, trailing −12% arms +10%, 90-min max hold.
  maxPositions: 8,
  // v3.7: SOL-denominated position sizing, scaled by conviction (score band).
  // 65–74 → 0.2 SOL · 75–84 → 0.35 SOL · 85+ → 0.5 SOL. Replaces positionPct.
  solSizeBase: 0.2,
  solSizeMid: 0.35,
  solSizeTop: 0.5,
  // v3.8 WHALE-APE: mc > whaleMcUsd && vol24h/mc ≥ whaleTurnoverMin → whaleSolSize SOL
  whaleMcUsd: 500000,
  whaleTurnoverMin: 1.0,
  whaleSolSize: 2.5,
  // v3.8 EARLY-APE: mc < earlyMcUsd && score ≥ earlyMinScore → earlySolSize SOL
  earlyMcUsd: 100000,
  earlyMinScore: 80,
  earlySolSize: 1.0,
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
  minTokenScore: { label: 'Min token score', unit: '0–100', min: 0, max: 100, hint: 'Entry bar for the 0–100 token score (after elite boost).' },
  minLiquidityUsd: { label: 'Min liquidity', unit: 'USD', min: 0, max: 1000000, hint: 'Free-kill floor.' },
  minVol24hUsd: { label: 'Min 24h volume', unit: 'USD', min: 0, max: 5000000, hint: 'Free-kill floor.' },
  pumpMinMc: { label: 'Pump min MC (on-curve)', unit: 'USD', min: 0, max: 1000000, hint: 'Free-kill floor for bonding-curve coins.' },
  pumpMaxMc: { label: 'Pump max MC (on-curve)', unit: 'USD', min: 10000, max: 10000000, hint: 'Free-kill ceiling for bonding-curve coins (curve completes ~$69k).' },
  minMc: { label: 'Min market cap (graduated)', unit: 'USD', min: 0, max: 10000000, hint: 'Free-kill floor for graduated coins.' },
  maxMc: { label: 'Max market cap (graduated)', unit: 'USD', min: 100000, max: 200000000, hint: 'Free-kill ceiling — keeps entries early.' },
  minAgeMin: { label: 'Min coin age', unit: 'minutes', min: 1, max: 600, hint: 'Skip brand-new launches (sniper/launch chaos).' },
  maxPumpAgeHrs: { label: 'Max pump age (on-curve)', unit: 'hours', min: 1, max: 240, hint: 'Free-kill ceiling for bonding-curve coins.' },
  maxAgeDays: { label: 'Max age (graduated)', unit: 'days', min: 1, max: 90, hint: 'Free-kill ceiling for graduated coins.' },
  minBuys24h: { label: 'Min 24h buys', unit: 'count', min: 1, max: 1000, hint: 'Needs real buy pressure.' },
  maxDevPct: { label: 'Max dev share', unit: '%', min: 5, max: 100, hint: 'Kill if the dev/creator holds more than this.' },
  minHolders: { label: 'Min holders', unit: 'count', min: 1, max: 500, hint: 'Kill thin holder counts.' },
  maxTopHolderPct: { label: 'Max top-holder share', unit: '%', min: 5, max: 100, hint: 'Kill if the biggest holder owns more than this.' },
  maxTop10Pct: { label: 'Max top-10 share', unit: '%', min: 10, max: 100, hint: 'Kill if the top 10 own more than this.' },
  eliteBoost: { label: 'Smart-flow boost', unit: 'points', min: 0, max: 25, hint: 'Added to score on smart-flow confirmation.' },
  maxPositions: { label: 'Max open positions', unit: 'count', min: 1, max: 25, hint: 'Concurrent position cap.' },
  solSizeBase: { label: 'Size · score 65–74', unit: 'SOL', min: 0.01, max: 5, hint: 'Position size for base-conviction entries.' },
  solSizeMid: { label: 'Size · score 75–84', unit: 'SOL', min: 0.01, max: 5, hint: 'Position size for mid-conviction entries.' },
  solSizeTop: { label: 'Size · score 85+', unit: 'SOL', min: 0.01, max: 5, hint: 'Position size for highest-conviction entries.' },
  whaleMcUsd: { label: 'Whale MC trigger', unit: 'USD', min: 50000, max: 10000000, hint: 'Whale-ape: MC above this with high volume → whale size.' },
  whaleTurnoverMin: { label: 'Whale volume trigger (turnover = vol24h/mc)', unit: 'ratio', min: 0.1, max: 10, hint: 'Whale-ape: 24h volume ÷ MC must clear this.' },
  whaleSolSize: { label: 'Whale size', unit: 'SOL', min: 0.1, max: 10, hint: 'Position size for whale-ape entries (overrides score bands).' },
  earlyMcUsd: { label: 'Early-ape MC ceiling', unit: 'USD', min: 10000, max: 1000000, hint: 'Early-ape: MC below this with a strong score → early size.' },
  earlyMinScore: { label: 'Early-ape min score', unit: '0–100', min: 0, max: 100, hint: 'Early-ape: score must clear this.' },
  earlySolSize: { label: 'Early-ape size', unit: 'SOL', min: 0.1, max: 10, hint: 'Position size for early-ape entries (overrides score bands).' },
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
