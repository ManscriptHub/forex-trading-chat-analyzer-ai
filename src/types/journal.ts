import { SetupAnalysisResult, SetupDecision, TradeDirection } from './analyzer';

export type JournalOutcome = 'PENDING' | 'WIN' | 'LOSS' | 'BREAKEVEN' | 'CANCELLED';

export interface JournalEntry {
  id: string;
  createdAt: number;
  pair: string;
  timeframe: string;
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  decision: SetupDecision;
  overallScore: number;
  riskRewardRatio: number;
  reasoning: string;
  factorsSummary: string[];
  userNotes?: string;
  tags?: string[];
  
  // Real outcome tracking
  outcome: JournalOutcome;
  exitPrice?: number;
  closedAt?: number;
  realizedR?: number; // e.g. +2.0 or -1.0
  pnlAmount?: number;
  pnlPips?: number;
  postTradeReview?: string;
  
  // Full analysis snapshot
  analysisSnapshot?: SetupAnalysisResult;
}

export interface JournalStats {
  totalEntries: number;
  closedTradesCount: number;
  pendingTradesCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  cancelled: number;
  winRate: number; // in percentage
  netR: number; // cumulative R
  averageR: number;
  expectancy: number; // Expectancy per trade in R
  profitFactor: number;
  validSetupsWinRate: number;
}
