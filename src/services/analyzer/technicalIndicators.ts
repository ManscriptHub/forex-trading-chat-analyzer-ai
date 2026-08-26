import { Candle } from '../../types/market';

export interface IndicatorSnapshot {
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi14: number[];
  atr14: number[];
  swingHighs: { index: number; price: number; timestamp: number }[];
  swingLows: { index: number; price: number; timestamp: number }[];
  supportLevels: number[];
  resistanceLevels: number[];
  recentLiquiditySweeps: { index: number; type: 'HIGH_SWEEP' | 'LOW_SWEEP'; price: number; timestamp: number }[];
  marketStructure: 'BULLISH' | 'BEARISH' | 'RANGING' | 'CHOPPY';
  currentSession: { name: string; isHighVolume: boolean; description: string };
}

export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];

  // Seed with SMA of first 'period' values or first value
  const seedLength = Math.min(period, values.length);
  const seedSum = values.slice(0, seedLength).reduce((acc, v) => acc + v, 0);
  let currentEMA = seedSum / seedLength;
  
  for (let i = 0; i < values.length; i++) {
    if (i < seedLength) {
      ema.push(currentEMA);
    } else {
      currentEMA = values[i] * k + currentEMA * (1 - k);
      ema.push(currentEMA);
    }
  }
  return ema;
}

export function calculateRSI(closes: number[], period = 14): number[] {
  if (closes.length < 2) return closes.map(() => 50);

  const rsi: number[] = [50];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = 1; i < closes.length; i++) {
    if (i <= period) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    } else {
      const gain = gains[i - 1];
      const loss = losses[i - 1];
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }

  return rsi;
}

export function calculateATR(candles: Candle[], period = 14): number[] {
  if (candles.length === 0) return [];
  const tr: number[] = [candles[0].high - candles[0].low];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const trueRange = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    tr.push(trueRange);
  }

  return calculateEMA(tr, period);
}

export function findSwingPoints(candles: Candle[], window = 3) {
  const swingHighs: { index: number; price: number; timestamp: number }[] = [];
  const swingLows: { index: number; price: number; timestamp: number }[] = [];

  for (let i = window; i < candles.length - window; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;

    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= window; j++) {
      if (candles[i - j].high >= currentHigh || candles[i + j].high >= currentHigh) {
        isHigh = false;
      }
      if (candles[i - j].low <= currentLow || candles[i + j].low <= currentLow) {
        isLow = false;
      }
    }

    if (isHigh) {
      swingHighs.push({ index: i, price: currentHigh, timestamp: candles[i].timestamp });
    }
    if (isLow) {
      swingLows.push({ index: i, price: currentLow, timestamp: candles[i].timestamp });
    }
  }

  return { swingHighs, swingLows };
}

export function detectSession(timestamp: number): { name: string; isHighVolume: boolean; description: string } {
  const date = new Date(timestamp);
  const hour = date.getUTCHours();

  if (hour >= 12 && hour < 16) {
    return {
      name: 'London / NY Overlap',
      isHighVolume: true,
      description: 'Peak global liquidity and highest momentum expansion window (12:00 - 16:00 UTC).',
    };
  }
  if (hour >= 7 && hour < 12) {
    return {
      name: 'London Session',
      isHighVolume: true,
      description: 'High volume European open, frequently establishes daily trend direction (07:00 - 12:00 UTC).',
    };
  }
  if (hour >= 16 && hour < 21) {
    return {
      name: 'New York Afternoon',
      isHighVolume: true,
      description: 'Moderate to high volume US afternoon session (16:00 - 21:00 UTC).',
    };
  }
  if (hour >= 0 && hour < 7) {
    return {
      name: 'Asian Session (Tokyo/Sydney)',
      isHighVolume: false,
      description: 'Often consolidation / range-bound accumulation, prone to false breakouts before London (00:00 - 07:00 UTC).',
    };
  }
  return {
    name: 'Off-Peak Interbank Close',
    isHighVolume: false,
    description: 'Thin spreads and reduced market depth (21:00 - 24:00 UTC). Risk of erratic slippage.',
  };
}

export function computeIndicatorSnapshot(candles: Candle[]): IndicatorSnapshot {
  if (candles.length === 0) {
    return {
      ema20: [],
      ema50: [],
      ema200: [],
      rsi14: [],
      atr14: [],
      swingHighs: [],
      swingLows: [],
      supportLevels: [],
      resistanceLevels: [],
      recentLiquiditySweeps: [],
      marketStructure: 'RANGING',
      currentSession: { name: 'Unknown', isHighVolume: false, description: 'No candle data available.' },
    };
  }

  const closes = candles.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi14 = calculateRSI(closes, 14);
  const atr14 = calculateATR(candles, 14);

  const { swingHighs, swingLows } = findSwingPoints(candles, 3);

  // Group swing points into S/R clusters
  const lastPrice = closes[closes.length - 1];
  const supportLevels = swingLows
    .map(s => s.price)
    .filter(p => p < lastPrice)
    .slice(-4)
    .sort((a, b) => b - a);

  const resistanceLevels = swingHighs
    .map(s => s.price)
    .filter(p => p > lastPrice)
    .slice(-4)
    .sort((a, b) => a - b);

  // Liquidity sweeps in last 20 candles
  const recentLiquiditySweeps: { index: number; type: 'HIGH_SWEEP' | 'LOW_SWEEP'; price: number; timestamp: number }[] = [];
  const startCheck = Math.max(0, candles.length - 20);

  for (let i = startCheck; i < candles.length; i++) {
    const c = candles[i];
    const prevHighs = candles.slice(Math.max(0, i - 15), i).map(x => x.high);
    const prevLows = candles.slice(Math.max(0, i - 15), i).map(x => x.low);

    if (prevHighs.length > 5) {
      const highestPrior = Math.max(...prevHighs);
      // High pierced highest prior, but close ended below it (Sweep & reject)
      if (c.high > highestPrior && c.close < highestPrior && (c.high - c.close) > (c.close - c.low)) {
        recentLiquiditySweeps.push({ index: i, type: 'HIGH_SWEEP', price: c.high, timestamp: c.timestamp });
      }
    }

    if (prevLows.length > 5) {
      const lowestPrior = Math.min(...prevLows);
      // Low pierced lowest prior, but close ended above it
      if (c.low < lowestPrior && c.close > lowestPrior && (c.close - c.low) > (c.high - c.close)) {
        recentLiquiditySweeps.push({ index: i, type: 'LOW_SWEEP', price: c.low, timestamp: c.timestamp });
      }
    }
  }

  // Market structure analysis (Higher Highs / Higher Lows vs Lower Highs / Lower Lows)
  let marketStructure: 'BULLISH' | 'BEARISH' | 'RANGING' | 'CHOPPY' = 'RANGING';
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastSH = swingHighs[swingHighs.length - 1].price;
    const prevSH = swingHighs[swingHighs.length - 2].price;
    const lastSL = swingLows[swingLows.length - 1].price;
    const prevSL = swingLows[swingLows.length - 2].price;

    if (lastSH > prevSH && lastSL > prevSL) {
      marketStructure = 'BULLISH';
    } else if (lastSH < prevSH && lastSL < prevSL) {
      marketStructure = 'BEARISH';
    } else if (lastSH > prevSH && lastSL < prevSL) {
      marketStructure = 'CHOPPY'; // Expanding range
    } else {
      marketStructure = 'RANGING';
    }
  }

  const lastCandle = candles[candles.length - 1];
  const currentSession = detectSession(lastCandle.timestamp);

  return {
    ema20,
    ema50,
    ema200,
    rsi14,
    atr14,
    swingHighs,
    swingLows,
    supportLevels,
    resistanceLevels,
    recentLiquiditySweeps,
    marketStructure,
    currentSession,
  };
}
