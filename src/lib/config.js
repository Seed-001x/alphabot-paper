// ALPHABOT v2 config — token-first desk. All values editable in Settings.
// Money is virtual (paper trading). Nothing here promises profit.

export const DEFAULT_CONFIG = {
  bankroll0: 1000,
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
  maxTopHolderPct: 35,    // top wallet share cap (%)
  maxTop10Pct: 70,        // top-10 share cap (%)
  eliteBoost: 8,          // score points added on elite-wallet confirmation
  // --- TRADE (paper risk engine) ---
  maxPositions: 8,
  positionPct: 0.02,
  takeProfit: 0.60,
  stopLoss: 0.35,
  trailingStop: 0.25,
  trailingArmAt: 0.20,
  maxHoldHours: 6,
  cooldownMin: 30,
  slippage: 0.05,
  // --- LOOP ---
  scanIntervalSec: 45,
  priceIntervalSec: 20,
};

export const RISK_META = {
  bankroll0: { label: 'Starting bankroll', unit: 'USD', min: 10, max: 1000000, hint: 'Applies on reset only. Virtual money.' },
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
  maxTopHolderPct: { label: 'Max top-holder share', unit: '%', min: 5, max: 100, hint: 'Kill if the biggest wallet owns more than this.' },
  maxTop10Pct: { label: 'Max top-10 share', unit: '%', min: 10, max: 100, hint: 'Kill if the top 10 own more than this.' },
  eliteBoost: { label: 'Elite confirmation boost', unit: 'points', min: 0, max: 25, hint: 'Added to score when an elite wallet holds the token.' },
  maxPositions: { label: 'Max open positions', unit: 'count', min: 1, max: 25, hint: 'Concurrent position cap.' },
  positionPct: { label: 'Position size', unit: '% of cash', min: 1, max: 5, pct: true, hint: 'Risk per trade, as % of cash.' },
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
