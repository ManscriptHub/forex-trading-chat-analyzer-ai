import { Candle, DatasetKind } from './market';
import {
  FactorKey,
  FactorStatus,
  SetupAnalysisResult,
  SetupDecision,
  TradeDirection,
  CalibrationWeights,
  CalibrationThresholds,
} from './analyzer';

export interface CostModelConfig {
  spreadPips: number; // Bid/Ask spread (e.g. 1.0 pips)
  commissionPips: number; // Commission per round turn in pips (e.g. 0.4 pips = ~$4/lot)
  slippagePips: number; // Execution entry + exit slippage in pips (e.g. 0.2 pips)
}

export interface BacktestTrade {
  id: string;
  setupIndex: number;
  entryTimestamp: number;
  entryDatetime: string;
  exitTimestamp?: number;
  exitDatetime?: string;
  pair: string;
  timeframe: string;
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  decision: SetupDecision;
  overallScore: number; // 0 to 100 confluence score (NOT win probability)
  riskRewardRatio: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'TIMEOUT_CLOSE' | 'FILTERED_OUT';
  realizedR: number; // Net realized R after all friction
  grossR?: number; // Gross R before friction
  exitPrice: number;
  holdingCandles: number;
  pnlPips: number;
  frictionalCostPips: number;
  marketRegimeAtEntry?: string;
  analysis: SetupAnalysisResult;
  resolutionPath?: { candleIndex: number; high: number; low: number; close: number; timestamp: number }[];
}

export type DataSplitType = 'ALL' | 'TRAIN' | 'VALIDATION' | 'TEST';

export interface BacktestSplitConfig {
  trainPercent: number; // e.g. 60
  validationPercent: number; // e.g. 20
  testPercent: number; // e.g. 20
  activeSplit: DataSplitType;
}

export interface PeriodStabilityRecord {
  periodName: string;
  startDate: string;
  endDate: string;
  startIndex: number;
  endIndex: number;
  tradesCount: number;
  winRate: number;
  lossRate: number;
  netR: number;
  averageR: number;
  profitFactor: number;
  maxDrawdownR: number;
  expectancy: number;
}

export interface RegimePerformanceRecord {
  regime: 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE_CONSOLIDATION' | 'HIGH_VOLATILITY';
  label: string;
  description: string;
  tradesCount: number;
  winRate: number;
  netR: number;
  profitFactor: number;
  expectancy: number;
  avgHoldingBars: number;
}

export interface BacktestAuditInfo {
  datasetName: string;
  datasetKind: DatasetKind;
  pair: string;
  timeframe: string;
  totalBars: number;
  dateRange: { start: string; end: string };
  partition: DataSplitType;
  partitionBars: number;
  costModel: CostModelConfig;
  totalFrictionPipsPerTrade: number;
  weightsUsed: CalibrationWeights;
  thresholdsUsed: CalibrationThresholds;
  syntheticDisclaimer?: string;
  isLookAheadFree: boolean;
  evaluatedTimestamp: number;
}

export interface BacktestSummaryStats {
  totalSetups: number;
  validSetupsCount: number;
  waitSetupsCount: number;
  rejectedSetupsCount: number;
  noTradeCount: number;
  filterRatePercent: number; // % of evaluated setups filtered out
  executedTradesCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number; // 0 to 100%
  lossRate: number; // 0 to 100%
  breakevenRate: number; // 0 to 100%
  averageR: number;
  averageWinR: number;
  averageLossR: number;
  netR: number; // Sum of net R-multiples
  grossNetRDrag: number; // Total R lost to spread, commission & slippage
  expectancy: number; // in R per trade: (WinRate * AvgWin) - (LossRate * AvgLoss)
  profitFactor: number; // Gross R wins / Gross R losses
  maxDrawdownR: number; // Maximum peak-to-trough in R
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  averageHoldingCandles: number;
  averageWinHoldingCandles: number;
  averageLossHoldingCandles: number;
  stabilityScore: number; // 0 to 100% measure of consistency across chronological chunks
  periodStability: PeriodStabilityRecord[];
  regimePerformance: RegimePerformanceRecord[];
  sampleSize: number;
  equityCurve: { tradeIndex: number; timestamp: number; cumulativeR: number; drawdownR: number }[];
}

export interface EvaluatedSetupRecord {
  id: string;
  stepIndex: number;
  timestamp: number;
  datetime?: string;
  pair: string;
  timeframe: string;
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  marketRegime?: string;
  factorScores: {
    factorKey: FactorKey;
    factorName: string;
    rawScore: number;
    maxScore: number;
    status: FactorStatus;
    reasoning: string;
  }[];
  initialDecision: SetupDecision;
  initialScore: number; // 0 to 100 score
  outcomeIfExecuted?: {
    outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'TIMEOUT_CLOSE';
    realizedR: number;
    exitPrice: number;
    exitIndex: number;
    exitTimestamp: number;
    holdingCandles: number;
    pnlPips: number;
  };
}

export interface ReplayStepSnapshot {
  stepIndex: number;
  candle: Candle;
  analysis?: SetupAnalysisResult;
  executedTrade?: BacktestTrade;
  activeTradeStatus?: {
    tradeId: string;
    direction: TradeDirection;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    holdingCandles: number;
    currentUnrealizedR: number;
  } | null;
  resolvedTrade?: BacktestTrade | null;
}

export interface BacktestResult {
  pair: string;
  timeframe: string;
  totalCandles: number;
  splitType: DataSplitType;
  splitRange: { startIndex: number; endIndex: number; startTime: string; endTime: string };
  costModel: CostModelConfig;
  auditInfo: BacktestAuditInfo;
  stats: BacktestSummaryStats;
  trades: BacktestTrade[];
  replaySteps?: ReplayStepSnapshot[];
  evaluatedSetups?: EvaluatedSetupRecord[];
  ranAt: number;
  isLookAheadFree: boolean;
}

export interface ReplayDataset {
  id: string;
  pair: string;
  timeframe: string;
  splitType: DataSplitType;
  recordedAt: number;
  totalCandles: number;
  costModel: CostModelConfig;
  auditInfo: BacktestAuditInfo;
  weightsUsed: CalibrationWeights;
  thresholdsUsed: CalibrationThresholds;
  stats: BacktestSummaryStats;
  trades: BacktestTrade[];
  evaluatedSetups: EvaluatedSetupRecord[];
}
