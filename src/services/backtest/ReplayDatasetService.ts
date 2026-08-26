import {
  BacktestAuditInfo,
  BacktestResult,
  BacktestSummaryStats,
  BacktestTrade,
  CostModelConfig,
  EvaluatedSetupRecord,
  PeriodStabilityRecord,
  RegimePerformanceRecord,
  ReplayDataset,
} from '../../types/backtest';
import { CalibrationThresholds, CalibrationWeights, SetupDecision } from '../../types/analyzer';
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../analyzer/SetupAnalyzerEngine';

const REPLAY_STORAGE_KEY = 'forex_chat_analyzer_latest_replay_dataset_v1';

export interface RecalibrationSimulationResult {
  datasetId: string;
  pair: string;
  timeframe: string;
  splitType: string;
  totalSetups: number;
  originalStats: BacktestSummaryStats;
  calibratedStats: BacktestSummaryStats;
  calibratedTrades: BacktestTrade[];
  isTestPartitionLocked: boolean;
  impactSummary: {
    winRateDelta: number;
    lossRateDelta: number;
    netRDelta: number;
    profitFactorDelta: number;
    expectancyDelta: number;
    tradesExecutedDelta: number;
    badTradesFilteredCount: number; // Setups that were losing before and are now filtered out
    goodTradesFilteredCount: number; // Setups that were winning before and are now filtered out
    newTradesAddedCount: number;
    compositeObjectiveScoreDelta: number;
  };
}

export class ReplayDatasetService {
  private static cachedDataset: ReplayDataset | null = null;

  /**
   * Saves a backtest replay dataset so it is available for calibration.
   */
  public static saveReplayDataset(
    result: BacktestResult,
    weights: CalibrationWeights,
    thresholds: CalibrationThresholds
  ): ReplayDataset {
    const dataset: ReplayDataset = {
      id: `replay_${result.pair.replace('/', '_')}_${result.timeframe}_${result.splitType}_${Date.now()}`,
      pair: result.pair,
      timeframe: result.timeframe,
      splitType: result.splitType,
      recordedAt: Date.now(),
      totalCandles: result.totalCandles,
      costModel: result.costModel,
      auditInfo: result.auditInfo,
      weightsUsed: { ...weights },
      thresholdsUsed: { ...thresholds },
      stats: result.stats,
      trades: result.trades,
      evaluatedSetups: result.evaluatedSetups || [],
    };

    this.cachedDataset = dataset;
    try {
      localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(dataset));
    } catch (e) {
      console.warn('Replay storage quota exceeded, kept in memory cache', e);
    }
    return dataset;
  }

  /**
   * Retrieves the latest stored replay dataset.
   */
  public static getLatestReplayDataset(): ReplayDataset | null {
    if (this.cachedDataset) return this.cachedDataset;
    try {
      const raw = localStorage.getItem(REPLAY_STORAGE_KEY);
      if (!raw) return null;
      this.cachedDataset = JSON.parse(raw);
      return this.cachedDataset;
    } catch {
      return null;
    }
  }

  /**
   * Clear the active replay dataset
   */
  public static clearDataset(): void {
    this.cachedDataset = null;
    try {
      localStorage.removeItem(REPLAY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  /**
   * Runs an instantaneous offline recalibration simulation on the replay dataset.
   * Multi-metric evaluation: Net R, Expectancy, Profit Factor, Drawdown, and Bad Trades Filtered.
   */
  public static simulateRecalibration(
    dataset: ReplayDataset,
    newWeights: CalibrationWeights,
    newThresholds: CalibrationThresholds
  ): RecalibrationSimulationResult {
    const totalMaxWeight = (Object.values(newWeights) as number[]).reduce((a, b) => a + b, 0);
    const calibratedTrades: BacktestTrade[] = [];

    let totalSetups = 0;
    let validSetupsCount = 0;
    let waitSetupsCount = 0;
    let rejectedSetupsCount = 0;
    let noTradeCount = 0;

    let badTradesFiltered = 0;
    let goodTradesFiltered = 0;
    let newTradesAdded = 0;

    // Track original trade map by stepIndex and direction
    const originalTradeMap = new Map<string, BacktestTrade>();
    for (const t of dataset.trades) {
      originalTradeMap.set(`${t.setupIndex}_${t.direction}`, t);
    }

    for (const setup of dataset.evaluatedSetups) {
      totalSetups++;

      // Compute newly weighted score
      let weightedPoints = 0;
      for (const f of setup.factorScores) {
        const factorWeight = newWeights[f.factorKey] ?? 0;
        const normalizedRatio = f.maxScore > 0 ? f.rawScore / f.maxScore : 0;
        weightedPoints += normalizedRatio * factorWeight;
      }

      const scorePct = totalMaxWeight > 0 ? Number(((weightedPoints / totalMaxWeight) * 100).toFixed(1)) : 0;

      // Determine new decision
      let newDecision: SetupDecision = 'NO TRADE';
      const trendFactor = setup.factorScores.find(f => f.factorKey === 'trend');
      const structureFactor = setup.factorScores.find(f => f.factorKey === 'marketStructure');

      if (setup.riskRewardRatio < 1.0) {
        newDecision = 'REJECT';
      } else if (newThresholds.rejectOnOpposingHTFTrend && trendFactor?.status === 'FAIL') {
        newDecision = 'REJECT';
      } else if (scorePct >= newThresholds.validScoreThreshold && setup.riskRewardRatio >= newThresholds.minRiskRewardRatio) {
        newDecision = 'VALID SETUP';
      } else if (scorePct >= newThresholds.waitScoreThreshold) {
        newDecision = 'WAIT';
      } else if (scorePct < 35 || structureFactor?.status === 'FAIL') {
        newDecision = 'REJECT';
      } else {
        newDecision = 'NO TRADE';
      }

      const key = `${setup.stepIndex}_${setup.direction}`;
      const origTrade = originalTradeMap.get(key);

      if (newDecision === 'VALID SETUP') {
        validSetupsCount++;

        // If this setup was executed originally or has an outcome resolved
        if (setup.outcomeIfExecuted) {
          const out = setup.outcomeIfExecuted;
          calibratedTrades.push({
            id: `recal_${setup.id}`,
            setupIndex: setup.stepIndex,
            entryTimestamp: setup.timestamp,
            entryDatetime: setup.datetime || new Date(setup.timestamp).toISOString(),
            exitTimestamp: out.exitTimestamp,
            pair: setup.pair,
            timeframe: setup.timeframe,
            direction: setup.direction,
            entryPrice: setup.entryPrice,
            stopLoss: setup.stopLoss,
            takeProfit: setup.takeProfit,
            decision: 'VALID SETUP',
            overallScore: scorePct,
            riskRewardRatio: setup.riskRewardRatio,
            outcome: out.outcome,
            realizedR: out.realizedR,
            exitPrice: out.exitPrice,
            holdingCandles: out.holdingCandles,
            pnlPips: out.pnlPips,
            frictionalCostPips: dataset.costModel ? (dataset.costModel.spreadPips + dataset.costModel.commissionPips + dataset.costModel.slippagePips) : 1.5,
            marketRegimeAtEntry: setup.marketRegime,
            analysis: {
              id: `analysis_${setup.id}`,
              timestamp: setup.timestamp,
              input: {
                pair: setup.pair,
                timeframe: setup.timeframe as any,
                direction: setup.direction,
                entryPrice: setup.entryPrice,
                stopLoss: setup.stopLoss,
                takeProfit: setup.takeProfit,
              },
              decision: 'VALID SETUP',
              overallScore: scorePct,
              totalWeightedScore: weightedPoints,
              maxPossibleWeightedScore: totalMaxWeight,
              decisionSummary: `VALID SETUP in recalibration (${scorePct}/100)`,
              keyStrengths: [],
              keyWeaknesses: [],
              factors: setup.factorScores.map(f => ({
                factorKey: f.factorKey,
                factorName: f.factorName,
                score: f.rawScore,
                maxScore: f.maxScore,
                weight: newWeights[f.factorKey] ?? 0,
                weightedScore: Number(((f.rawScore / f.maxScore) * (newWeights[f.factorKey] ?? 0)).toFixed(2)),
                maxWeightedScore: newWeights[f.factorKey] ?? 0,
                status: f.status,
                reasoning: f.reasoning,
              })),
              riskMetrics: {
                riskPips: Math.abs(setup.entryPrice - setup.stopLoss),
                rewardPips: Math.abs(setup.takeProfit - setup.entryPrice),
                riskRewardRatio: setup.riskRewardRatio,
                isValidGeometry: true,
              },
              marketDataStatus: 'AVAILABLE',
              marketDataSource: 'Replay Recalibration Dataset',
              candlesAnalyzedCount: setup.stepIndex + 1,
            },
          });

          if (!origTrade) {
            newTradesAdded++;
          }
        }
      } else if (newDecision === 'WAIT') {
        waitSetupsCount++;
        if (origTrade) {
          if (origTrade.outcome === 'LOSS') badTradesFiltered++;
          if (origTrade.outcome === 'WIN') goodTradesFiltered++;
        }
      } else if (newDecision === 'REJECT') {
        rejectedSetupsCount++;
        if (origTrade) {
          if (origTrade.outcome === 'LOSS') badTradesFiltered++;
          if (origTrade.outcome === 'WIN') goodTradesFiltered++;
        }
      } else {
        noTradeCount++;
        if (origTrade) {
          if (origTrade.outcome === 'LOSS') badTradesFiltered++;
          if (origTrade.outcome === 'WIN') goodTradesFiltered++;
        }
      }
    }

    const calibratedStats = this.computeStatsFromTrades(
      calibratedTrades,
      totalSetups,
      validSetupsCount,
      waitSetupsCount,
      rejectedSetupsCount,
      noTradeCount
    );

    const origStats = dataset.stats;

    // Composite objective score: Expectancy * 0.4 + NetR * 0.3 + (1 - Drawdown/20) * 0.3
    const origObj = (origStats.expectancy * 10) + (origStats.netR * 0.5) - (origStats.maxDrawdownR * 0.8);
    const calObj = (calibratedStats.expectancy * 10) + (calibratedStats.netR * 0.5) - (calibratedStats.maxDrawdownR * 0.8);

    return {
      datasetId: dataset.id,
      pair: dataset.pair,
      timeframe: dataset.timeframe,
      splitType: dataset.splitType,
      totalSetups,
      originalStats: origStats,
      calibratedStats,
      calibratedTrades,
      isTestPartitionLocked: dataset.splitType === 'TEST',
      impactSummary: {
        winRateDelta: Number((calibratedStats.winRate - origStats.winRate).toFixed(1)),
        lossRateDelta: Number((calibratedStats.lossRate - origStats.lossRate).toFixed(1)),
        netRDelta: Number((calibratedStats.netR - origStats.netR).toFixed(2)),
        profitFactorDelta: Number((calibratedStats.profitFactor - origStats.profitFactor).toFixed(2)),
        expectancyDelta: Number((calibratedStats.expectancy - origStats.expectancy).toFixed(2)),
        tradesExecutedDelta: calibratedStats.executedTradesCount - origStats.executedTradesCount,
        badTradesFilteredCount: badTradesFiltered,
        goodTradesFilteredCount: goodTradesFiltered,
        newTradesAddedCount: newTradesAdded,
        compositeObjectiveScoreDelta: Number((calObj - origObj).toFixed(2)),
      },
    };
  }

  private static computeStatsFromTrades(
    trades: BacktestTrade[],
    totalSetups: number,
    validSetupsCount: number,
    waitSetupsCount: number,
    rejectedSetupsCount: number,
    noTradeCount: number
  ): BacktestSummaryStats {
    const executedTradesCount = trades.length;
    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let grossWinR = 0;
    let grossLossR = 0;
    let cumulativeR = 0;
    let peakR = 0;
    let maxDrawdownR = 0;

    let currentWinStreak = 0;
    let maxConsecutiveWins = 0;
    let currentLossStreak = 0;
    let maxConsecutiveLosses = 0;

    let totalHoldingCandles = 0;
    let totalWinHolding = 0;
    let totalLossHolding = 0;

    const equityCurve: { tradeIndex: number; timestamp: number; cumulativeR: number; drawdownR: number }[] = [
      { tradeIndex: 0, timestamp: trades[0]?.entryTimestamp || Date.now(), cumulativeR: 0, drawdownR: 0 },
    ];

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const r = t.realizedR;
      cumulativeR += r;
      totalHoldingCandles += t.holdingCandles;

      if (cumulativeR > peakR) peakR = cumulativeR;
      const dd = peakR - cumulativeR;
      if (dd > maxDrawdownR) maxDrawdownR = dd;

      equityCurve.push({
        tradeIndex: i + 1,
        timestamp: t.exitTimestamp || t.entryTimestamp,
        cumulativeR: Number(cumulativeR.toFixed(2)),
        drawdownR: Number(dd.toFixed(2)),
      });

      if (r > 0.1) {
        wins++;
        grossWinR += r;
        totalWinHolding += t.holdingCandles;
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxConsecutiveWins) maxConsecutiveWins = currentWinStreak;
      } else if (r < -0.1) {
        losses++;
        grossLossR += Math.abs(r);
        totalLossHolding += t.holdingCandles;
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
      } else {
        breakevens++;
      }
    }

    const winRate = executedTradesCount > 0 ? Number(((wins / executedTradesCount) * 100).toFixed(1)) : 0;
    const lossRate = executedTradesCount > 0 ? Number(((losses / executedTradesCount) * 100).toFixed(1)) : 0;
    const breakevenRate = executedTradesCount > 0 ? Number(((breakevens / executedTradesCount) * 100).toFixed(1)) : 0;

    const averageR = executedTradesCount > 0 ? Number((cumulativeR / executedTradesCount).toFixed(2)) : 0;
    const averageWinR = wins > 0 ? Number((grossWinR / wins).toFixed(2)) : 0;
    const averageLossR = losses > 0 ? Number((grossLossR / losses).toFixed(2)) : 0;

    const winProb = wins / (executedTradesCount || 1);
    const lossProb = losses / (executedTradesCount || 1);
    const expectancy = Number(((winProb * averageWinR) - (lossProb * averageLossR)).toFixed(2));
    const profitFactor = grossLossR > 0 ? Number((grossWinR / grossLossR).toFixed(2)) : grossWinR > 0 ? 99.9 : 0;

    const averageHoldingCandles = executedTradesCount > 0 ? Number((totalHoldingCandles / executedTradesCount).toFixed(1)) : 0;
    const averageWinHoldingCandles = wins > 0 ? Number((totalWinHolding / wins).toFixed(1)) : 0;
    const averageLossHoldingCandles = losses > 0 ? Number((totalLossHolding / losses).toFixed(1)) : 0;

    const filterRatePercent = totalSetups > 0
      ? Number((((totalSetups - validSetupsCount) / totalSetups) * 100).toFixed(1))
      : 0;

    return {
      totalSetups,
      validSetupsCount,
      waitSetupsCount,
      rejectedSetupsCount,
      noTradeCount,
      filterRatePercent,
      executedTradesCount,
      wins,
      losses,
      breakevens,
      winRate,
      lossRate,
      breakevenRate,
      averageR,
      averageWinR,
      averageLossR,
      netR: Number(cumulativeR.toFixed(2)),
      grossNetRDrag: 0,
      expectancy,
      profitFactor,
      maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
      maxConsecutiveWins,
      maxConsecutiveLosses,
      averageHoldingCandles,
      averageWinHoldingCandles,
      averageLossHoldingCandles,
      stabilityScore: 100,
      periodStability: [],
      regimePerformance: [],
      sampleSize: executedTradesCount,
      equityCurve,
    };
  }
}
