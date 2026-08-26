import { Candle } from '../../types/market';
import {
  CalibrationProfile,
  CalibrationThresholds,
  CalibrationWeights,
  SetupAnalysisResult,
  SetupDecision,
  SetupInput,
} from '../../types/analyzer';
import { evaluateFactors } from './FactorAnalyzer';
import { calculatePips, getPipScale } from '../marketData/historicalDataGenerator';

export const DEFAULT_WEIGHTS: CalibrationWeights = {
  trend: 15,
  marketStructure: 20,
  momentum: 10,
  volatility: 10,
  supportResistance: 15,
  liquidity: 10,
  tradingSession: 5,
  riskReward: 15,
};

export const DEFAULT_THRESHOLDS: CalibrationThresholds = {
  validScoreThreshold: 70, // >= 70% weighted score
  waitScoreThreshold: 50,  // 50 - 69%
  minRiskRewardRatio: 1.5,
  requireSessionAlignment: false,
  rejectOnOpposingHTFTrend: true,
};

export const DEFAULT_PROFILES: CalibrationProfile[] = [
  {
    id: 'balanced_institutional',
    name: 'Balanced Multi-Factor (Default)',
    description: 'Even distribution across Market Structure, S/R, Trend, and Strict 1:1.5+ Risk/Reward.',
    weights: DEFAULT_WEIGHTS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'ict_liquidity_hunter',
    name: 'Liquidity & Structure Focused',
    description: 'Prioritizes liquidity sweeps, order blocks, structural BOS/CHoCH, and high R:R setups.',
    weights: {
      trend: 10,
      marketStructure: 25,
      momentum: 5,
      volatility: 10,
      supportResistance: 15,
      liquidity: 20,
      tradingSession: 5,
      riskReward: 10,
    },
    thresholds: {
      validScoreThreshold: 72,
      waitScoreThreshold: 52,
      minRiskRewardRatio: 2.0,
      requireSessionAlignment: true,
      rejectOnOpposingHTFTrend: false,
    },
  },
  {
    id: 'conservative_trend',
    name: 'Conservative Trend-Following',
    description: 'Demands strict 200 EMA trend alignment, high volume sessions, and solid S/R protection.',
    weights: {
      trend: 25,
      marketStructure: 15,
      momentum: 15,
      volatility: 10,
      supportResistance: 15,
      liquidity: 5,
      tradingSession: 5,
      riskReward: 10,
    },
    thresholds: {
      validScoreThreshold: 75,
      waitScoreThreshold: 55,
      minRiskRewardRatio: 1.5,
      requireSessionAlignment: false,
      rejectOnOpposingHTFTrend: true,
    },
  },
];

export class SetupAnalyzerEngine {
  public static analyzeSetup(
    input: SetupInput,
    candles: Candle[],
    weights: CalibrationWeights = DEFAULT_WEIGHTS,
    thresholds: CalibrationThresholds = DEFAULT_THRESHOLDS,
    marketDataStatus: 'AVAILABLE' | 'DATA_UNAVAILABLE' = 'AVAILABLE',
    marketDataSource = 'Curated Historical Data'
  ): SetupAnalysisResult {
    const id = `setup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = Date.now();

    // 1. Data Availability Check
    if (marketDataStatus === 'DATA_UNAVAILABLE' || candles.length < 10) {
      return {
        id,
        timestamp,
        input,
        decision: 'NO TRADE',
        overallScore: 0,
        totalWeightedScore: 0,
        maxPossibleWeightedScore: 100,
        decisionSummary:
          'DATA UNAVAILABLE: Insufficient market data to evaluate setup factors reliably. No trade recommended until real candle history is loaded.',
        keyStrengths: [],
        keyWeaknesses: ['Market data unavailable or fewer than 10 historical bars found.'],
        factors: [],
        riskMetrics: {
          riskPips: 0,
          rewardPips: 0,
          riskRewardRatio: 0,
          isValidGeometry: false,
          geometryError: 'Market data unavailable.',
        },
        marketDataStatus: 'DATA_UNAVAILABLE',
        marketDataSource,
        candlesAnalyzedCount: candles.length,
      };
    }

    // 2. Evaluate all 8 factors
    const evaluation = evaluateFactors(input, candles, weights);

    // Calculate sum of weights and total weighted points
    const totalMaxWeight: number = (Object.values(weights) as number[]).reduce((a, b) => a + b, 0);
    const totalWeightedPoints = evaluation.factors.reduce((sum, f) => sum + f.weightedScore, 0);
    const overallPercentage = totalMaxWeight > 0 ? Number(((totalWeightedPoints / totalMaxWeight) * 100).toFixed(1)) : 0;

    // Account position sizing
    const balance = input.accountBalance ?? 10000;
    const riskPct = input.riskPercent ?? 1.0;
    const accountRiskAmount = Number(((balance * riskPct) / 100).toFixed(2));
    const pipScale = getPipScale(input.pair);
    
    // Approximate standard lot value: $10 per pip for 1.0 lot on standard pairs
    const standardLotPipVal = input.pair.includes('JPY') ? 7.0 : 10.0;
    const suggestedLotSize =
      evaluation.riskPips > 0
        ? Number((accountRiskAmount / (evaluation.riskPips * standardLotPipVal)).toFixed(2))
        : 0.01;

    // Extract Strengths and Weaknesses
    const keyStrengths: string[] = [];
    const keyWeaknesses: string[] = [];

    for (const factor of evaluation.factors) {
      if (factor.status === 'PASS') {
        keyStrengths.push(`${factor.factorName}: ${factor.reasoning}`);
      } else if (factor.status === 'FAIL' || factor.status === 'WARNING') {
        keyWeaknesses.push(`${factor.factorName}: ${factor.reasoning}`);
      }
    }

    // Decision Logic Matrix
    let decision: SetupDecision = 'NO TRADE';
    let decisionSummary = '';

    const trendFactor = evaluation.factors.find(f => f.factorKey === 'trend');
    const rrFactor = evaluation.factors.find(f => f.factorKey === 'riskReward');
    const structureFactor = evaluation.factors.find(f => f.factorKey === 'marketStructure');

    // Hard Rejection rules
    if (!evaluation.geometryValid) {
      decision = 'REJECT';
      decisionSummary = `REJECT: Geometry invalid. ${evaluation.geometryError}`;
    } else if (evaluation.riskRewardRatio < 1.0) {
      decision = 'REJECT';
      decisionSummary = `REJECT: Negative risk/reward ratio (1:${evaluation.riskRewardRatio}). Potential reward is smaller than stop loss risk.`;
    } else if (thresholds.rejectOnOpposingHTFTrend && trendFactor?.status === 'FAIL') {
      decision = 'REJECT';
      decisionSummary = `REJECT: Severe trend conflict. Setup attempts to trade directly into dominant higher-timeframe EMA momentum.`;
    } else if (overallPercentage >= thresholds.validScoreThreshold && evaluation.riskRewardRatio >= thresholds.minRiskRewardRatio) {
      decision = 'VALID SETUP';
      decisionSummary = `VALID SETUP: Confluence score is ${overallPercentage}/100. Trend, market structure, and ${evaluation.riskRewardRatio}:1 R:R confirm an actionable high-probability framework.`;
    } else if (overallPercentage >= thresholds.waitScoreThreshold) {
      decision = 'WAIT';
      decisionSummary = `WAIT: Confluence score is ${overallPercentage}/100. Certain factors are favorable, but key confirmations (such as structure break or liquidity sweep) remain pending. Wait for clearer candle close.`;
    } else if (overallPercentage < 35 || structureFactor?.status === 'FAIL') {
      decision = 'REJECT';
      decisionSummary = `REJECT: Low confluence score (${overallPercentage}/100) and conflicting market structure. Trade parameters show high structural fragility.`;
    } else {
      decision = 'NO TRADE';
      decisionSummary = `NO TRADE: Market evidence is insufficient or contradictory (${overallPercentage}/100). Preserving capital by staying on the sidelines.`;
    }

    const lastCandle = candles[candles.length - 1];

    return {
      id,
      timestamp,
      input,
      decision,
      overallScore: overallPercentage,
      totalWeightedScore: totalWeightedPoints,
      maxPossibleWeightedScore: totalMaxWeight,
      decisionSummary,
      keyStrengths,
      keyWeaknesses,
      factors: evaluation.factors,
      riskMetrics: {
        riskPips: evaluation.riskPips,
        rewardPips: evaluation.rewardPips,
        riskRewardRatio: evaluation.riskRewardRatio,
        accountRiskAmount,
        suggestedLotSize: Math.max(0.01, suggestedLotSize),
        pipValue: standardLotPipVal,
        isValidGeometry: evaluation.geometryValid,
        geometryError: evaluation.geometryError,
      },
      marketDataStatus,
      marketDataSource,
      candlesAnalyzedCount: candles.length,
      indicators: {
        ema20: evaluation.indicators.ema20[candles.length - 1],
        ema50: evaluation.indicators.ema50[candles.length - 1],
        ema200: evaluation.indicators.ema200[candles.length - 1],
        rsi14: evaluation.indicators.rsi14[candles.length - 1],
        atr14: evaluation.indicators.atr14[candles.length - 1],
        currentSession: evaluation.indicators.currentSession.name,
        recentSwingHigh: evaluation.indicators.swingHighs[evaluation.indicators.swingHighs.length - 1]?.price,
        recentSwingLow: evaluation.indicators.swingLows[evaluation.indicators.swingLows.length - 1]?.price,
      },
    };
  }
}
