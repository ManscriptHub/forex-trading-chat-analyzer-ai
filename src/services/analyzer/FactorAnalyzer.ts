import { Candle } from '../../types/market';
import { FactorScore, SetupInput, TradeDirection, CalibrationWeights } from '../../types/analyzer';
import { computeIndicatorSnapshot, IndicatorSnapshot } from './technicalIndicators';
import { calculatePips, getPipScale } from '../marketData/historicalDataGenerator';

export function evaluateFactors(
  input: SetupInput,
  candles: Candle[],
  weights: CalibrationWeights
): {
  factors: FactorScore[];
  indicators: IndicatorSnapshot;
  geometryValid: boolean;
  geometryError?: string;
  riskPips: number;
  rewardPips: number;
  riskRewardRatio: number;
} {
  const isBuy = input.direction === 'BUY';
  const pipScale = getPipScale(input.pair);
  
  // 1. Geometry Validation
  let geometryValid = true;
  let geometryError: string | undefined;

  if (isBuy) {
    if (input.stopLoss >= input.entryPrice) {
      geometryValid = false;
      geometryError = 'Invalid Buy geometry: Stop Loss must be strictly below Entry Price.';
    } else if (input.takeProfit <= input.entryPrice) {
      geometryValid = false;
      geometryError = 'Invalid Buy geometry: Take Profit must be strictly above Entry Price.';
    }
  } else {
    if (input.stopLoss <= input.entryPrice) {
      geometryValid = false;
      geometryError = 'Invalid Sell geometry: Stop Loss must be strictly above Entry Price.';
    } else if (input.takeProfit >= input.entryPrice) {
      geometryValid = false;
      geometryError = 'Invalid Sell geometry: Take Profit must be strictly below Entry Price.';
    }
  }

  const riskDist = Math.abs(input.entryPrice - input.stopLoss);
  const rewardDist = Math.abs(input.takeProfit - input.entryPrice);
  const riskPips = Number((riskDist / pipScale).toFixed(1));
  const rewardPips = Number((rewardDist / pipScale).toFixed(1));
  const riskRewardRatio = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 0;

  const indicators = computeIndicatorSnapshot(candles);
  const factors: FactorScore[] = [];

  const lastIndex = candles.length - 1;
  const lastClose = candles.length > 0 ? candles[lastIndex].close : input.entryPrice;
  const lastIndIdx = indicators.ema20.length - 1;
  const ema20 = indicators.ema20[lastIndIdx] ?? lastClose;
  const ema50 = indicators.ema50[lastIndIdx] ?? lastClose;
  const ema200 = indicators.ema200[lastIndIdx] ?? lastClose;
  const rsi = indicators.rsi14[lastIndIdx] ?? 50;
  const atr = indicators.atr14[lastIndIdx] ?? (pipScale * 20);
  const atrPips = Number((atr / pipScale).toFixed(1));

  // -------------------------------------------------------------
  // FACTOR 1: TREND
  // -------------------------------------------------------------
  {
    const maxScore = 10;
    let score = 5;
    let status: 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING' = 'NEUTRAL';
    let reasoning = '';

    const isBullAlignment = ema20 > ema50 && ema50 > ema200;
    const isBearAlignment = ema20 < ema50 && ema50 < ema200;
    const isPriceAbove200 = input.entryPrice > ema200;

    if (isBuy) {
      if (isBullAlignment && isPriceAbove200) {
        score = 10;
        status = 'PASS';
        reasoning = `Strong bullish trend alignment across 20/50/200 EMAs. Entry (${input.entryPrice.toFixed(4)}) is above 200 EMA (${ema200.toFixed(4)}), confirming institutional trend direction.`;
      } else if (input.entryPrice > ema50) {
        score = 7;
        status = 'PASS';
        reasoning = `Moderate bullish momentum above 50 EMA (${ema50.toFixed(4)}), though 200 EMA remains a key baseline.`;
      } else if (!isPriceAbove200 && isBearAlignment) {
        score = 1;
        status = 'FAIL';
        reasoning = `Severe trend conflict: Attempting BUY against full bearish EMA stack below 200 EMA (${ema200.toFixed(4)}). High failure probability.`;
      } else {
        score = 4;
        status = 'WARNING';
        reasoning = `Trend is mixed/compressed with EMAs entwined. Limited directional trend support.`;
      }
    } else {
      // Sell
      if (isBearAlignment && !isPriceAbove200) {
        score = 10;
        status = 'PASS';
        reasoning = `Strong bearish trend alignment across 20/50/200 EMAs. Entry (${input.entryPrice.toFixed(4)}) is cleanly below 200 EMA (${ema200.toFixed(4)}).`;
      } else if (input.entryPrice < ema50) {
        score = 7;
        status = 'PASS';
        reasoning = `Moderate bearish structure below 50 EMA (${ema50.toFixed(4)}). Trend supports short bias.`;
      } else if (isPriceAbove200 && isBullAlignment) {
        score = 1;
        status = 'FAIL';
        reasoning = `Severe trend conflict: Attempting SELL against strong bullish stack above 200 EMA (${ema200.toFixed(4)}).`;
      } else {
        score = 4;
        status = 'WARNING';
        reasoning = `EMAs flat and entangled; lack of distinct bearish momentum.`;
      }
    }

    const weight = weights.trend;
    factors.push({
      factorKey: 'trend',
      factorName: 'Trend Alignment',
      score,
      maxScore,
      weight,
      weightedScore: Number(((score / maxScore) * weight).toFixed(1)),
      maxWeightedScore: weight,
      status,
      reasoning,
      details: { ema20, ema50, ema200, isBullAlignment, isBearAlignment },
    });
  }

  // -------------------------------------------------------------
  // FACTOR 2: MARKET STRUCTURE (BOS / Swing Points)
  // -------------------------------------------------------------
  {
    const maxScore = 10;
    let score = 5;
    let status: 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING' = 'NEUTRAL';
    let reasoning = '';

    const structure = indicators.marketStructure;
    if (isBuy) {
      if (structure === 'BULLISH') {
        score = 10;
        status = 'PASS';
        reasoning = 'Clean Higher-High / Higher-Low (HH/HL) market structure confirmed. Recent swing lows protected.';
      } else if (structure === 'RANGING') {
        score = 5;
        status = 'NEUTRAL';
        reasoning = 'Market is consolidating within established boundaries. Structure lacks distinct directional continuation.';
      } else if (structure === 'CHOPPY') {
        score = 3;
        status = 'WARNING';
        reasoning = 'Market is expanding with erratic swings (highs and lows expanding), increasing false breakout risk.';
      } else {
        score = 2;
        status = 'FAIL';
        reasoning = 'Market structure is strictly Bearish (Lower Highs and Lower Lows). Buying into lower-low sequence without confirmed CHoCH.';
      }
    } else {
      // Sell
      if (structure === 'BEARISH') {
        score = 10;
        status = 'PASS';
        reasoning = 'Clean Lower-High / Lower-Low (LH/LL) structural flow confirmed. Swing highs intact.';
      } else if (structure === 'RANGING') {
        score = 5;
        status = 'NEUTRAL';
        reasoning = 'Market is in a range box without clear structural displacement.';
      } else if (structure === 'CHOPPY') {
        score = 3;
        status = 'WARNING';
        reasoning = 'Choppy expanding swings detected; price action lacks clear invalidation points.';
      } else {
        score = 2;
        status = 'FAIL';
        reasoning = 'Market structure is Bullish (Higher Highs / Higher Lows). Shorting into unbroken bullish expansion.';
      }
    }

    const weight = weights.marketStructure;
    factors.push({
      factorKey: 'marketStructure',
      factorName: 'Market Structure & Swings',
      score,
      maxScore,
      weight,
      weightedScore: Number(((score / maxScore) * weight).toFixed(1)),
      maxWeightedScore: weight,
      status,
      reasoning,
      details: { structure, swingHighsCount: indicators.swingHighs.length, swingLowsCount: indicators.swingLows.length },
    });
  }

  // -------------------------------------------------------------
  // FACTOR 3: MOMENTUM (RSI & Velocity)
  // -------------------------------------------------------------
  {
    const maxScore = 10;
    let score = 5;
    let status: 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING' = 'NEUTRAL';
    let reasoning = '';

    if (isBuy) {
      if (rsi >= 48 && rsi <= 68) {
        score = 9;
        status = 'PASS';
        reasoning = `Healthy bullish momentum (RSI: ${rsi.toFixed(1)}). Ample expansion room before reaching extreme overbought threshold (>70).`;
      } else if (rsi < 32) {
        score = 6;
        status = 'NEUTRAL';
        reasoning = `RSI (${rsi.toFixed(1)}) is oversold. Potential mean-reversion bounce, but momentum remains downward until confirmed turn.`;
      } else if (rsi > 72) {
        score = 3;
        status = 'WARNING';
        reasoning = `RSI (${rsi.toFixed(1)}) is severely overbought. High risk of immediate pullback or long liquidation right at entry.`;
      } else {
        score = 5;
        status = 'NEUTRAL';
        reasoning = `Neutral RSI reading (${rsi.toFixed(1)}). Momentum is balanced.`;
      }
    } else {
      // Sell
      if (rsi >= 32 && rsi <= 52) {
        score = 9;
        status = 'PASS';
        reasoning = `Healthy bearish momentum (RSI: ${rsi.toFixed(1)}). Solid continuation room above oversold boundary (<30).`;
      } else if (rsi > 68) {
        score = 6;
        status = 'NEUTRAL';
        reasoning = `RSI (${rsi.toFixed(1)}) is overbought. Good counter-trend zone, but sellers have not yet demonstrated downward impulse.`;
      } else if (rsi < 28) {
        score = 3;
        status = 'WARNING';
        reasoning = `RSI (${rsi.toFixed(1)}) is deeply oversold. Selling at the bottom of the move carries high snapback risk.`;
      } else {
        score = 5;
        status = 'NEUTRAL';
        reasoning = `RSI (${rsi.toFixed(1)}) sits in the mid-band; momentum is non-committal.`;
      }
    }

    const weight = weights.momentum;
    factors.push({
      factorKey: 'momentum',
      factorName: 'Momentum & RSI Health',
      score,
      maxScore,
      weight,
      weightedScore: Number(((score / maxScore) * weight).toFixed(1)),
      maxWeightedScore: weight,
      status,
      reasoning,
      details: { rsi: Number(rsi.toFixed(1)) },
    });
  }

  // -------------------------------------------------------------
  // FACTOR 4: VOLATILITY & ATR PROPORTIONALITY
  // -------------------------------------------------------------
  {
    const maxScore = 10;
    let score = 6;
    let status: 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING' = 'PASS';
    let reasoning = '';

    // Check if Stop Loss is reasonably scaled to 14-period ATR (not 0.1 ATR which gets stopped by spread, not 10 ATR which is too wide)
    const slInAtr = atr > 0 ? (riskDist / atr) : 1;

    if (slInAtr >= 0.7 && slInAtr <= 2.5) {
      score = 10;
      status = 'PASS';
      reasoning = `Stop loss (${riskPips} pips, ${slInAtr.toFixed(2)}x ATR) matches normal market volatility. Protects against noise while maintaining tight invalidation.`;
    } else if (slInAtr < 0.4) {
      score = 3;
      status = 'WARNING';
      reasoning = `Stop loss (${riskPips} pips, ${slInAtr.toFixed(2)}x ATR) is dangerously tight for ${input.pair} volatility (${atrPips} pip 14-ATR). High likelihood of being stopped out by standard spread/noise.`;
    } else if (slInAtr > 3.5) {
      score = 4;
      status = 'NEUTRAL';
      reasoning = `Stop loss (${riskPips} pips, ${slInAtr.toFixed(2)}x ATR) is unusually wide relative to current volatility (${atrPips} pips ATR), dampening R-multiple efficiency.`;
    } else {
      score = 7;
      status = 'PASS';
      reasoning = `Stop loss is reasonably proportioned to current 14-period ATR (${atrPips} pips).`;
    }

    const weight = weights.volatility;
    factors.push({
      factorKey: 'volatility',
      factorName: 'Volatility & Invalidation Room',
      score,
      maxScore,
      weight,
      weightedScore: Number(((score / maxScore) * weight).toFixed(1)),
      maxWeightedScore: weight,
      status,
      reasoning,
      details: { atrPips, slInAtr: Number(slInAtr.toFixed(2)) },
    });
  }

  // -------------------------------------------------------------
  // FACTOR 5: SUPPORT & RESISTANCE CONFLUENCE
  // -------------------------------------------------------------
  {
    const maxScore = 10;
    let score = 5;
    let status: 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING' = 'NEUTRAL';
    let reasoning = '';

    const nearestSupport = indicators.supportLevels[0];
    const nearestResistance = indicators.resistanceLevels[0];

    if (isBuy) {
      if (nearestSupport && Math.abs(input.entryPrice - nearestSupport) < atr * 1.2 && input.stopLoss <= nearestSupport) {
        score = 10;
        status = 'PASS';
        reasoning = `Excellent S/R structure: Entry is anchored directly above major support (${nearestSupport.toFixed(4)}) with Stop Loss protected safely behind the zone.`;
      } else if (nearestResistance && (nearestResistance - input.entryPrice) < riskDist * 0.8) {
        score = 2;
        status = 'FAIL';
        reasoning = `Hazardous S/R trap: Entry is firing directly into nearby resistance ceiling (${nearestResistance.toFixed(4)}). Room before obstacle is smaller than stop distance.`;
      } else if (nearestSupport && input.entryPrice > nearestSupport) {
        score = 7;
        status = 'PASS';
        reasoning = `Entry is positioned above identified swing support (${nearestSupport.toFixed(4)}).`;
      } else {
        score = 5;
        status = 'NEUTRAL';
        reasoning = 'No immediate conflicting resistance nearby, though entry is not directly anchored to fresh support.';
      }
    } else {
      // Sell
      if (nearestResistance && Math.abs(input.entryPrice - nearestResistance) < atr * 1.2 && input.stopLoss >= nearestResistance) {
        score = 10;
        status = 'PASS';
        reasoning = `Excellent S/R structure: Entry sits directly below confirmed resistance (${nearestResistance.toFixed(4)}) with Stop Loss protected above it.`;
      } else if (nearestSupport && (input.entryPrice - nearestSupport) < riskDist * 0.8) {
        score = 2;
        status = 'FAIL';
        reasoning = `Hazardous S/R trap: Selling directly into support floor (${nearestSupport.toFixed(4)}) with inadequate clearance before target.`;
      } else if (nearestResistance && input.entryPrice < nearestResistance) {
        score = 7;
        status = 'PASS';
        reasoning = `Entry is positioned below swing resistance level (${nearestResistance.toFixed(4)}).`;
      } else {
        score = 5;
        status = 'NEUTRAL';
        reasoning = 'Adequate clearance above support floor; neutral S/R barrier.';
      }
    }

    const weight = weights.supportResistance;
    factors.push({
      factorKey: 'supportResistance',
      factorName: 'Support & Resistance Proximity',
      score,
      maxScore,
      weight,
      weightedScore: Number(((score / maxScore) * weight).toFixed(1)),
      maxWeightedScore: weight,
      status,
      reasoning,
      details: { nearestSupport, nearestResistance },
    });
  }

  // -------------------------------------------------------------
  // FACTOR 6: LIQUIDITY & SWEEP DYNAMICS
  // -------------------------------------------------------------
  {
    const maxScore = 10;
    let score = 5;
    let status: 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING' = 'NEUTRAL';
    let reasoning = '';

    const sweeps = indicators.recentLiquiditySweeps;
    const hasLowSweep = sweeps.some(s => s.type === 'LOW_SWEEP');
    const hasHighSweep = sweeps.some(s => s.type === 'HIGH_SWEEP');

    if (isBuy) {
      if (hasLowSweep) {
        score = 10;
        status = 'PASS';
        reasoning = 'Recent liquidity sweep detected below key lows with rejection close. Buy stops/liquidity purged prior to entry.';
      } else if (hasHighSweep) {
        score = 3;
        status = 'WARNING';
        reasoning = 'High liquidity sweep occurred recently, suggesting smart money may be initiating sell-side distribution.';
      } else {
        score = 6;
        status = 'NEUTRAL';
        reasoning = 'Standard liquidity conditions. No recent sweep trap or adverse hunt identified.';
      }
    } else {
      // Sell
      if (hasHighSweep) {
        score = 10;
        status = 'PASS';
        reasoning = 'Recent high liquidity sweep confirmed (stops triggered at highs with immediate rejection). High-probability distribution entry.';
      } else if (hasLowSweep) {
        score = 3;
        status = 'WARNING';
        reasoning = 'Low liquidity sweep occurred recently; risk of sudden institutional absorption/bounce.';
      } else {
        score = 6;
        status = 'NEUTRAL';
        reasoning = 'Standard liquidity environment without recent extreme hunts.';
      }
    }

    const weight = weights.liquidity;
    factors.push({
      factorKey: 'liquidity',
      factorName: 'Liquidity Pools & Sweeps',
      score,
      maxScore,
      weight,
      weightedScore: Number(((score / maxScore) * weight).toFixed(1)),
      maxWeightedScore: weight,
      status,
      reasoning,
      details: { sweepsCount: sweeps.length, hasLowSweep, hasHighSweep },
    });
  }

  // -------------------------------------------------------------
  // FACTOR 7: TRADING SESSION
  // -------------------------------------------------------------
  {
    const maxScore = 10;
    let score = 5;
    let status: 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING' = 'NEUTRAL';
    let reasoning = '';

    const session = indicators.currentSession;
    if (session.name.includes('Overlap')) {
      score = 10;
      status = 'PASS';
      reasoning = `High liquidity window: ${session.name}. Tight spreads, genuine institutional volume, and cleanest price delivery.`;
    } else if (session.isHighVolume) {
      score = 8;
      status = 'PASS';
      reasoning = `Active market window: ${session.name}. Favorable execution liquidity for major pairs.`;
    } else if (session.name.includes('Asian')) {
      // Asian session is OK for AUD, NZD, JPY, lower for EUR, GBP
      if (input.pair.includes('JPY') || input.pair.includes('AUD') || input.pair.includes('NZD')) {
        score = 7;
        status = 'PASS';
        reasoning = `${session.name} is active for ${input.pair}. Normal session volume expected.`;
      } else {
        score = 4;
        status = 'WARNING';
        reasoning = `${session.name} typically exhibits low volatility & range containment for ${input.pair}. Breakouts often lack follow-through until London open.`;
      }
    } else {
      score = 2;
      status = 'WARNING';
      reasoning = `Off-peak interbank rollover window. Wider broker spreads, lower depth, and increased slippage risk.`;
    }

    const weight = weights.tradingSession;
    factors.push({
      factorKey: 'tradingSession',
      factorName: 'Trading Session & Liquidity Window',
      score,
      maxScore,
      weight,
      weightedScore: Number(((score / maxScore) * weight).toFixed(1)),
      maxWeightedScore: weight,
      status,
      reasoning,
      details: { sessionName: session.name, isHighVolume: session.isHighVolume },
    });
  }

  // -------------------------------------------------------------
  // FACTOR 8: RISK / REWARD RATIO
  // -------------------------------------------------------------
  {
    const maxScore = 10;
    let score = 0;
    let status: 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING' = 'FAIL';
    let reasoning = '';

    if (!geometryValid) {
      score = 0;
      status = 'FAIL';
      reasoning = geometryError || 'Invalid price geometry. Stop Loss and Take Profit are mathematically inverted.';
    } else if (riskRewardRatio >= 3.0) {
      score = 10;
      status = 'PASS';
      reasoning = `Exceptional Risk/Reward ratio of 1:${riskRewardRatio} (${riskPips} pips risk vs ${rewardPips} pips reward). Allows strong positive expectancy even with sub-40% win rate.`;
    } else if (riskRewardRatio >= 2.0) {
      score = 9;
      status = 'PASS';
      reasoning = `Strong Risk/Reward ratio of 1:${riskRewardRatio} (${riskPips} pips risk vs ${rewardPips} pips reward). Solid mathematical edge.`;
    } else if (riskRewardRatio >= 1.5) {
      score = 7;
      status = 'PASS';
      reasoning = `Acceptable standard Risk/Reward ratio of 1:${riskRewardRatio} (${riskPips} pips risk vs ${rewardPips} pips reward). Meets minimum 1:1.5 threshold.`;
    } else if (riskRewardRatio >= 1.0) {
      score = 3;
      status = 'WARNING';
      reasoning = `Sub-optimal Risk/Reward ratio of 1:${riskRewardRatio} (${riskPips} pips risk vs ${rewardPips} pips reward). Below recommended 1:1.5 baseline; requires high win rate to break even.`;
    } else {
      score = 1;
      status = 'FAIL';
      reasoning = `Negative asymmetry: Risk/Reward is 1:${riskRewardRatio} (${riskPips} pips risk vs only ${rewardPips} pips reward). Risking more than the potential payoff is a negative expectancy habit.`;
    }

    const weight = weights.riskReward;
    factors.push({
      factorKey: 'riskReward',
      factorName: 'Risk-to-Reward Geometry',
      score,
      maxScore,
      weight,
      weightedScore: Number(((score / maxScore) * weight).toFixed(1)),
      maxWeightedScore: weight,
      status,
      reasoning,
      details: { riskPips, rewardPips, riskRewardRatio },
    });
  }

  return {
    factors,
    indicators,
    geometryValid,
    geometryError,
    riskPips,
    rewardPips,
    riskRewardRatio,
  };
}
