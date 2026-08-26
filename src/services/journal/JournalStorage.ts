import { JournalEntry, JournalOutcome, JournalStats } from '../../types/journal';
import { SetupAnalysisResult } from '../../types/analyzer';
import { calculatePips, getPipScale } from '../marketData/historicalDataGenerator';

const STORAGE_KEY = 'forex_chat_analyzer_journal_v1';

export class JournalStorage {
  public static getEntries(): JournalEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this.getDefaultSampleEntries();
      return JSON.parse(raw);
    } catch {
      return this.getDefaultSampleEntries();
    }
  }

  public static saveEntries(entries: JournalEntry[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.error('Failed to save journal to localStorage', e);
    }
  }

  public static addEntryFromAnalysis(
    analysis: SetupAnalysisResult,
    userNotes?: string,
    tags: string[] = []
  ): JournalEntry {
    const entry: JournalEntry = {
      id: `j_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      createdAt: Date.now(),
      pair: analysis.input.pair,
      timeframe: analysis.input.timeframe,
      direction: analysis.input.direction,
      entryPrice: analysis.input.entryPrice,
      stopLoss: analysis.input.stopLoss,
      takeProfit: analysis.input.takeProfit,
      decision: analysis.decision,
      overallScore: analysis.overallScore,
      riskRewardRatio: analysis.riskMetrics.riskRewardRatio,
      reasoning: analysis.decisionSummary,
      factorsSummary: analysis.factors.map(f => `${f.factorName}: ${f.score}/${f.maxScore} (${f.status})`),
      userNotes,
      tags,
      outcome: 'PENDING',
      analysisSnapshot: analysis,
    };

    const entries = this.getEntries();
    entries.unshift(entry);
    this.saveEntries(entries);
    return entry;
  }

  public static updateOutcome(
    entryId: string,
    outcome: JournalOutcome,
    exitPrice?: number,
    postTradeReview?: string
  ): JournalEntry | null {
    const entries = this.getEntries();
    const idx = entries.findIndex(e => e.id === entryId);
    if (idx === -1) return null;

    const entry = entries[idx];
    entry.outcome = outcome;
    entry.closedAt = Date.now();
    if (exitPrice !== undefined) entry.exitPrice = exitPrice;
    if (postTradeReview !== undefined) entry.postTradeReview = postTradeReview;

    const isBuy = entry.direction === 'BUY';
    const pipScale = getPipScale(entry.pair);
    const riskDistance = Math.abs(entry.entryPrice - entry.stopLoss);

    if (outcome === 'WIN') {
      entry.exitPrice = exitPrice ?? entry.takeProfit;
      entry.realizedR = entry.riskRewardRatio;
      entry.pnlPips = Number((Math.abs(entry.takeProfit - entry.entryPrice) / pipScale).toFixed(1));
    } else if (outcome === 'LOSS') {
      entry.exitPrice = exitPrice ?? entry.stopLoss;
      entry.realizedR = -1.0;
      entry.pnlPips = -Number((Math.abs(entry.entryPrice - entry.stopLoss) / pipScale).toFixed(1));
    } else if (outcome === 'BREAKEVEN') {
      entry.exitPrice = exitPrice ?? entry.entryPrice;
      entry.realizedR = 0;
      entry.pnlPips = 0;
    } else if (outcome === 'CANCELLED') {
      entry.realizedR = 0;
      entry.pnlPips = 0;
    } else if (exitPrice !== undefined && riskDistance > 0) {
      // Manual partial exit price
      const diff = entry.exitPrice! - entry.entryPrice;
      const directionalDiff = isBuy ? diff : -diff;
      entry.realizedR = Number((directionalDiff / riskDistance).toFixed(2));
      entry.pnlPips = Number((directionalDiff / pipScale).toFixed(1));
    }

    entries[idx] = entry;
    this.saveEntries(entries);
    return entry;
  }

  public static deleteEntry(entryId: string): void {
    const entries = this.getEntries().filter(e => e.id !== entryId);
    this.saveEntries(entries);
  }

  public static calculateStats(entries: JournalEntry[]): JournalStats {
    const totalEntries = entries.length;
    const closed = entries.filter(e => e.outcome !== 'PENDING' && e.outcome !== 'CANCELLED');
    const wins = closed.filter(e => e.outcome === 'WIN');
    const losses = closed.filter(e => e.outcome === 'LOSS');
    const breakevens = closed.filter(e => e.outcome === 'BREAKEVEN');
    const cancelled = entries.filter(e => e.outcome === 'CANCELLED').length;
    const pendingTradesCount = entries.filter(e => e.outcome === 'PENDING').length;

    let cumulativeR = 0;
    let grossWinR = 0;
    let grossLossR = 0;

    for (const trade of closed) {
      const r = trade.realizedR ?? 0;
      cumulativeR += r;
      if (r > 0) grossWinR += r;
      if (r < 0) grossLossR += Math.abs(r);
    }

    const closedCount = closed.length;
    const winRate = closedCount > 0 ? Number(((wins.length / closedCount) * 100).toFixed(1)) : 0;
    const averageR = closedCount > 0 ? Number((cumulativeR / closedCount).toFixed(2)) : 0;
    const averageWinR = wins.length > 0 ? grossWinR / wins.length : 0;
    const averageLossR = losses.length > 0 ? grossLossR / losses.length : 0;

    const winProb = wins.length / (closedCount || 1);
    const lossProb = losses.length / (closedCount || 1);
    const expectancy = Number(((winProb * averageWinR) - (lossProb * averageLossR)).toFixed(2));
    const profitFactor = grossLossR > 0 ? Number((grossWinR / grossLossR).toFixed(2)) : grossWinR > 0 ? 99.9 : 0;

    const validClosed = closed.filter(e => e.decision === 'VALID SETUP');
    const validWins = validClosed.filter(e => e.outcome === 'WIN').length;
    const validSetupsWinRate = validClosed.length > 0 ? Number(((validWins / validClosed.length) * 100).toFixed(1)) : 0;

    return {
      totalEntries,
      closedTradesCount: closedCount,
      pendingTradesCount,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      cancelled,
      winRate,
      netR: Number(cumulativeR.toFixed(2)),
      averageR,
      expectancy,
      profitFactor,
      validSetupsWinRate,
    };
  }

  private static getDefaultSampleEntries(): JournalEntry[] {
    const now = Date.now();
    return [
      {
        id: 'sample_1',
        createdAt: now - 86400000 * 2,
        pair: 'EUR/USD',
        timeframe: 'H1',
        direction: 'BUY',
        entryPrice: 1.0845,
        stopLoss: 1.0815,
        takeProfit: 1.0910,
        decision: 'VALID SETUP',
        overallScore: 84.5,
        riskRewardRatio: 2.17,
        reasoning: 'VALID SETUP: Confluence score is 84.5/100. Trend, market structure, and 2.17:1 R:R confirm an actionable high-probability framework.',
        factorsSummary: ['Trend Alignment: 10/10 (PASS)', 'Market Structure: 10/10 (PASS)', 'Risk-to-Reward: 9/10 (PASS)'],
        userNotes: 'Clean liquidity purge below previous Asian low followed by aggressive London expansion.',
        outcome: 'WIN',
        exitPrice: 1.0910,
        closedAt: now - 86400000 * 1.5,
        realizedR: 2.17,
        pnlPips: 65,
        postTradeReview: 'Hit full TP at NY open. Maintained trade discipline.',
      },
      {
        id: 'sample_2',
        createdAt: now - 86400000 * 4,
        pair: 'GBP/JPY',
        timeframe: 'M15',
        direction: 'SELL',
        entryPrice: 199.20,
        stopLoss: 199.65,
        takeProfit: 198.10,
        decision: 'VALID SETUP',
        overallScore: 78.0,
        riskRewardRatio: 2.44,
        reasoning: 'VALID SETUP: Bearish structure break with high-volume rejection wick at Asian high.',
        factorsSummary: ['Market Structure: 10/10 (PASS)', 'Liquidity Pools: 10/10 (PASS)', 'Risk-to-Reward: 9/10 (PASS)'],
        userNotes: 'Short scalp after high liquidity grab.',
        outcome: 'WIN',
        exitPrice: 198.10,
        closedAt: now - 86400000 * 3.8,
        realizedR: 2.44,
        pnlPips: 110,
        postTradeReview: 'Strong momentum down into London fixing.',
      },
      {
        id: 'sample_3',
        createdAt: now - 86400000 * 6,
        pair: 'USD/JPY',
        timeframe: 'H1',
        direction: 'BUY',
        entryPrice: 154.20,
        stopLoss: 153.80,
        takeProfit: 154.90,
        decision: 'WAIT',
        overallScore: 54.0,
        riskRewardRatio: 1.75,
        reasoning: 'WAIT: Trend mixed, approaching resistance ceiling with moderate divergence.',
        factorsSummary: ['Trend Alignment: 4/10 (WARNING)', 'Momentum: 5/10 (NEUTRAL)', 'Risk-to-Reward: 7/10 (PASS)'],
        userNotes: 'Premature entry taken despite WAIT status.',
        outcome: 'LOSS',
        exitPrice: 153.80,
        closedAt: now - 86400000 * 5.6,
        realizedR: -1.0,
        pnlPips: -40,
        postTradeReview: 'Lesson: Ignored analyzer WAIT warning. Market stalled at resistance and reversed.',
      },
    ];
  }
}
