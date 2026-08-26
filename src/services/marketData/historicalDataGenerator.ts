import { Candle, Timeframe } from '../../types/market';

/**
 * Deterministic generator of high-fidelity forex market OHLC series.
 * Generates realistic price cycles, session volume variations, liquidity sweeps,
 * pullback zones, and trend breaks for historical backtesting and setup verification.
 */

interface PairConfig {
  basePrice: number;
  pipScale: number; // 0.0001 for standard, 0.01 for JPY, 0.1 for XAU
  dailyAtrPips: number;
  trendBias: number;
  volatilityMult: number;
}

const PAIR_CONFIGS: Record<string, PairConfig> = {
  'EUR/USD': { basePrice: 1.0850, pipScale: 0.0001, dailyAtrPips: 75, trendBias: -0.0002, volatilityMult: 1.0 },
  'GBP/USD': { basePrice: 1.2920, pipScale: 0.0001, dailyAtrPips: 95, trendBias: 0.0004, volatilityMult: 1.2 },
  'USD/JPY': { basePrice: 154.50, pipScale: 0.01, dailyAtrPips: 110, trendBias: 0.05, volatilityMult: 1.1 },
  'AUD/USD': { basePrice: 0.6550, pipScale: 0.0001, dailyAtrPips: 65, trendBias: -0.0001, volatilityMult: 0.9 },
  'USD/CAD': { basePrice: 1.3850, pipScale: 0.0001, dailyAtrPips: 70, trendBias: 0.0002, volatilityMult: 0.95 },
  'USD/CHF': { basePrice: 0.8850, pipScale: 0.0001, dailyAtrPips: 60, trendBias: -0.0001, volatilityMult: 0.85 },
  'EUR/JPY': { basePrice: 167.80, pipScale: 0.01, dailyAtrPips: 120, trendBias: 0.04, volatilityMult: 1.15 },
  'GBP/JPY': { basePrice: 199.50, pipScale: 0.01, dailyAtrPips: 145, trendBias: 0.06, volatilityMult: 1.3 },
  'XAU/USD': { basePrice: 2650.00, pipScale: 0.1, dailyAtrPips: 280, trendBias: 0.8, volatilityMult: 1.5 },
};

function getIntervalMinutes(tf: Timeframe): number {
  switch (tf) {
    case 'M1': return 1;
    case 'M5': return 5;
    case 'M15': return 15;
    case 'M30': return 30;
    case 'H1': return 60;
    case 'H4': return 240;
    case 'D1': return 1440;
    default: return 60;
  }
}

// Pseudo-random deterministic generator with seed for repeatable backtesting
class SeededRandom {
  private s: number;
  constructor(seed: number) {
    this.s = Math.sin(seed) * 10000;
  }
  next(): number {
    this.s = (this.s * 9301 + 49297) % 233280;
    return this.s / 233280;
  }
}

export function generateHistoricalSeries(
  pair: string,
  timeframe: Timeframe,
  count = 300,
  seed = 42
): Candle[] {
  const config = PAIR_CONFIGS[pair] || {
    basePrice: 1.1000,
    pipScale: 0.0001,
    dailyAtrPips: 70,
    trendBias: 0.0001,
    volatilityMult: 1.0,
  };

  const intervalMins = getIntervalMinutes(timeframe);
  const candlesPerDay = 1440 / intervalMins;
  const candleAtrPips = (config.dailyAtrPips / Math.sqrt(candlesPerDay)) * config.volatilityMult;
  const candleAtrPrice = candleAtrPips * config.pipScale;

  const rng = new SeededRandom(seed + pair.charCodeAt(0) * 13 + intervalMins * 7);
  const candles: Candle[] = [];

  // Start 45 days ago
  const now = Date.now();
  let currentTimestamp = now - count * intervalMins * 60 * 1000;
  let currentPrice = config.basePrice;

  // Regime states: 0 = Bull Trend, 1 = Bear Trend, 2 = Consolidation/Range, 3 = Liquidity Sweep/Reversal
  let regime = Math.floor(rng.next() * 3);
  let regimeDuration = 0;
  const maxRegimeDuration = Math.floor(25 + rng.next() * 30);

  let supportLevel = currentPrice - candleAtrPrice * 8;
  let resistanceLevel = currentPrice + candleAtrPrice * 8;

  for (let i = 0; i < count; i++) {
    regimeDuration++;
    if (regimeDuration > maxRegimeDuration) {
      regime = (regime + 1 + Math.floor(rng.next() * 2)) % 4;
      regimeDuration = 0;
      supportLevel = currentPrice - candleAtrPrice * (4 + rng.next() * 6);
      resistanceLevel = currentPrice + candleAtrPrice * (4 + rng.next() * 6);
    }

    // Time-of-day session volatility multiplier
    const date = new Date(currentTimestamp);
    const utcHour = date.getUTCHours();
    const isLondonOrNY = (utcHour >= 7 && utcHour <= 17);
    const isOverlap = (utcHour >= 12 && utcHour <= 16);
    let sessionVol = isOverlap ? 1.4 : isLondonOrNY ? 1.1 : 0.6;

    let drift = 0;
    if (regime === 0) {
      // Bull trend
      drift = candleAtrPrice * (0.15 + rng.next() * 0.2);
    } else if (regime === 1) {
      // Bear trend
      drift = -candleAtrPrice * (0.15 + rng.next() * 0.2);
    } else if (regime === 2) {
      // Range/Mean reversion
      const mid = (supportLevel + resistanceLevel) / 2;
      drift = (mid - currentPrice) * 0.08;
    } else if (regime === 3) {
      // Liquidity sweep then sharp reject
      if (regimeDuration < 3) {
        drift = candleAtrPrice * (rng.next() > 0.5 ? 0.6 : -0.6);
      } else {
        drift = -drift * 0.8;
      }
    }

    const noise = (rng.next() - 0.5) * candleAtrPrice * 1.3 * sessionVol;
    const delta = drift + noise;

    const open = currentPrice;
    const close = open + delta;

    // High and low wicks
    const wickHigh = rng.next() * candleAtrPrice * 0.7 * sessionVol;
    const wickLow = rng.next() * candleAtrPrice * 0.7 * sessionVol;

    const high = Math.max(open, close) + wickHigh;
    const low = Math.min(open, close) - wickLow;

    // Volume
    const baseVolume = 1000 * sessionVol;
    const volume = Math.floor(baseVolume * (0.7 + rng.next() * 0.6) * (1 + Math.abs(delta) / candleAtrPrice));

    const decimals = config.pipScale === 0.01 ? 3 : config.pipScale === 0.1 ? 2 : 5;

    candles.push({
      timestamp: currentTimestamp,
      open: Number(open.toFixed(decimals)),
      high: Number(high.toFixed(decimals)),
      low: Number(low.toFixed(decimals)),
      close: Number(close.toFixed(decimals)),
      volume,
      datetime: date.toISOString(),
    });

    currentPrice = close;
    currentTimestamp += intervalMins * 60 * 1000;
  }

  return candles;
}

export function getPipScale(pair: string): number {
  if (pair.includes('JPY')) return 0.01;
  if (pair.includes('XAU') || pair.includes('GOLD')) return 0.1;
  if (pair.includes('BTC') || pair.includes('ETH')) return 1.0;
  return 0.0001;
}

export function calculatePips(pair: string, price1: number, price2: number): number {
  const scale = getPipScale(pair);
  return Number((Math.abs(price1 - price2) / scale).toFixed(1));
}
