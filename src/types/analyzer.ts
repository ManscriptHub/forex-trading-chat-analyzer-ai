import { Candle, Timeframe } from './market';

export type TradeDirection = 'BUY' | 'SELL';

export type SetupDecision = 'VALID SETUP' | 'WAIT' | 'REJECT' | 'NO TRADE';

export type FactorStatus = 'PASS' | 'NEUTRAL' | 'FAIL' | 'WARNING';

export type FactorKey =
  | 'trend'
  | 'marketStructure'
  | 'momentum'
  | 'volatility'
  | 'supportResistance'
  | 'liquidity'
  | 'tradingSession'
  | 'riskReward';

export interface FactorScore {
  factorKey: FactorKey;
  factorName: string;
  score: number; // e.g. 0 to maxScore
  maxScore: number;
  weight: number; // from calibration
  weightedScore: number;
  maxWeightedScore: number;
  status: FactorStatus;
  reasoning: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface SetupInput {
  pair: string;
  timeframe: Timeframe;
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  sessionTime?: string; // Optional custom time or defaults to current
  accountBalance?: number;
  riskPercent?: number; // e.g. 1% or 2%
}

export interface RiskMetrics {
  riskPips: number;
  rewardPips: number;
  riskRewardRatio: number;
  accountRiskAmount?: number;
  suggestedLotSize?: number;
  pipValue?: number;
  isValidGeometry: boolean; // e.g. Buy SL must be below entry, TP above entry
  geometryError?: string;
}

export interface SetupAnalysisResult {
  id: string;
  timestamp: number;
  input: SetupInput;
  decision: SetupDecision;
  overallScore: number; // 0 to 100
  totalWeightedScore: number;
  maxPossibleWeightedScore: number;
  decisionSummary: string;
  keyWeaknesses: string[];
  keyStrengths: string[];
  factors: FactorScore[];
  riskMetrics: RiskMetrics;
  marketDataStatus: 'AVAILABLE' | 'DATA_UNAVAILABLE';
  marketDataSource: string;
  candlesAnalyzedCount: number;
  indicators?: {
    ema20?: number;
    ema50?: number;
    ema200?: number;
    rsi14?: number;
    atr14?: number;
    currentSession?: string;
    recentSwingHigh?: number;
    recentSwingLow?: number;
    distanceToKeySR?: number;
  };
}

export interface CalibrationWeights {
  trend: number;              // default 15
  marketStructure: number;    // default 20
  momentum: number;           // default 10
  volatility: number;         // default 10
  supportResistance: number;  // default 15
  liquidity: number;          // default 10
  tradingSession: number;     // default 5
  riskReward: number;         // default 15
}

export interface CalibrationThresholds {
  validScoreThreshold: number; // e.g. 70 (out of 100)
  waitScoreThreshold: number;  // e.g. 50 (50-69 is WAIT, <50 is REJECT or NO TRADE)
  minRiskRewardRatio: number;  // e.g. 1.5
  requireSessionAlignment: boolean;
  rejectOnOpposingHTFTrend: boolean;
}

export interface CalibrationProfile {
  id: string;
  name: string;
  description: string;
  weights: CalibrationWeights;
  thresholds: CalibrationThresholds;
}
