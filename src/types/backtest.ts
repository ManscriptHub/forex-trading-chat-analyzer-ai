import { Candle } from './market';
import { SetupAnalysisResult, SetupDecision, TradeDirection } from './analyzer';

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
  overallScore: number;
  riskRewardRatio: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'TIMEOUT_CLOSE' | 'FILTERED_OUT';
  realizedR: number; // e.g. +2.0 R, -1.0 R, 0 R
  exitPrice: number;
  holdingCandles: number;
  pnlPips: number;
  analysis: SetupAnalysisResult;
}

export type DataSplitType = 'ALL' | 'TRAIN' | 'VALIDATION' | 'TEST';

export interface BacktestSplitConfig {
  trainPercent: number; // e.g. 60
  validationPercent: number; // e.g. 20
  testPercent: number; // e.g. 20
  activeSplit: DataSplitType;
}

export interface BacktestSummaryStats {
  totalSetups: number;
  validSetupsCount: number;
  waitSetupsCount: number;
  rejectedSetupsCount: number;
  noTradeCount: number;
  executedTradesCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number; // 0 to 100%
  averageR: number;
  averageWinR: number;
  averageLossR: number;
  netR: number; // Sum of R-multiples
  expectancy: number; // in R per trade: (WinRate * AvgWin) - (LossRate * AvgLoss)
  profitFactor: number; // Gross R wins / Gross R losses
  maxDrawdownR: number; // Maximum peak-to-trough in R
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  sampleSize: number;
  equityCurve: { tradeIndex: number; timestamp: number; cumulativeR: number; drawdownR: number }[];
}

export interface BacktestResult {
  pair: string;
  timeframe: string;
  totalCandles: number;
  splitType: DataSplitType;
  splitRange: { startIndex: number; endIndex: number; startTime: string; endTime: string };
  stats: BacktestSummaryStats;
  trades: BacktestTrade[];
  ranAt: number;
  isLookAheadFree: boolean;
}
