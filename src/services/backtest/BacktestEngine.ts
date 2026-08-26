import { Candle } from '../../types/market';
import {
  BacktestResult,
  BacktestSummaryStats,
  BacktestTrade,
  DataSplitType,
} from '../../types/backtest';
import {
  CalibrationThresholds,
  CalibrationWeights,
  SetupInput,
  TradeDirection,
} from '../../types/analyzer';
import { SetupAnalyzerEngine, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../analyzer/SetupAnalyzerEngine';
import { getPipScale } from '../marketData/historicalDataGenerator';

export interface BacktestOptions {
  pair: string;
  timeframe: string;
  candles: Candle[];
  weights?: CalibrationWeights;
  thresholds?: CalibrationThresholds;
  splitType?: DataSplitType;
  trainPct?: number; // default 60%
  valPct?: number;   // default 20%
  testPct?: number;  // default 20%
  minHoldingCandles?: number;
  maxHoldingCandles?: number; // default 40 candles before timeout close
  stepStep?: number; // step size in candles, e.g. every 2-4 candles to scan for structural setups
}

export class BacktestEngine {
  /**
   * Runs a strictly chronological walk-forward simulation.
   * Guarantees ZERO lookahead bias by:
   * 1. Passing only `candles.slice(0, currentIdx + 1)` into SetupAnalyzerEngine.
   * 2. Future candles `candles.slice(currentIdx + 1)` are strictly used only for post-entry resolution.
   */
  public static runBacktest(options: BacktestOptions): BacktestResult {
    const {
      pair,
      timeframe,
      candles,
      weights = DEFAULT_WEIGHTS,
      thresholds = DEFAULT_THRESHOLDS,
      splitType = 'ALL',
      trainPct = 60,
      valPct = 20,
      testPct = 20,
      maxHoldingCandles = 35,
    } = options;

    const totalCandles = candles.length;
    if (totalCandles < 50) {
      return this.emptyResult(pair, timeframe, splitType);
    }

    // 1. Calculate Split Ranges
    const trainEnd = Math.floor(totalCandles * (trainPct / 100));
    const valEnd = Math.floor(totalCandles * ((trainPct + valPct) / 100));

    let startIndex = 30; // warm-up period for EMAs/RSI
    let endIndex = totalCandles - 1;

    if (splitType === 'TRAIN') {
      startIndex = 30;
      endIndex = trainEnd;
    } else if (splitType === 'VALIDATION') {
      startIndex = Math.max(30, trainEnd);
      endIndex = valEnd;
    } else if (splitType === 'TEST') {
      startIndex = Math.max(30, valEnd);
      endIndex = totalCandles - 1;
    }

    const pipScale = getPipScale(pair);
    const trades: BacktestTrade[] = [];
    let activeTrade: {
      trade: BacktestTrade;
      resolved: boolean;
      entryIdx: number;
    } | null = null;

    let totalSetupsEvaluated = 0;
    let validSetupsCount = 0;
    let waitSetupsCount = 0;
    let rejectedSetupsCount = 0;
    let noTradeCount = 0;

    // 2. Chronological Walk-Forward Loop
    for (let i = startIndex; i < endIndex; i++) {
      const currentCandle = candles[i];

      // If a trade is currently open, resolve it against candle i first
      if (activeTrade && !activeTrade.resolved) {
        const t = activeTrade.trade;
        const isBuy = t.direction === 'BUY';
        let hitTP = false;
        let hitSL = false;

        // Check intra-candle high/low for TP/SL hits
        if (isBuy) {
          if (currentCandle.low <= t.stopLoss) {
            hitSL = true;
          }
          if (currentCandle.high >= t.takeProfit) {
            hitTP = true;
          }
        } else {
          // Sell
          if (currentCandle.high >= t.stopLoss) {
            hitSL = true;
          }
          if (currentCandle.low <= t.takeProfit) {
            hitTP = true;
          }
        }

        const holding = i - activeTrade.entryIdx;

        if (hitSL && hitTP) {
          // Conservative assumption when both extremes hit in one bar: SL hit first
          t.outcome = 'LOSS';
          t.realizedR = -1.0;
          t.exitPrice = t.stopLoss;
          t.exitTimestamp = currentCandle.timestamp;
          t.exitDatetime = currentCandle.datetime;
          t.holdingCandles = holding;
          t.pnlPips = Number(((t.exitPrice - t.entryPrice) * (isBuy ? 1 : -1) / pipScale).toFixed(1));
          activeTrade.resolved = true;
          trades.push(t);
          activeTrade = null;
        } else if (hitSL) {
          t.outcome = 'LOSS';
          t.realizedR = -1.0;
          t.exitPrice = t.stopLoss;
          t.exitTimestamp = currentCandle.timestamp;
          t.exitDatetime = currentCandle.datetime;
          t.holdingCandles = holding;
          t.pnlPips = Number(((t.exitPrice - t.entryPrice) * (isBuy ? 1 : -1) / pipScale).toFixed(1));
          activeTrade.resolved = true;
          trades.push(t);
          activeTrade = null;
        } else if (hitTP) {
          t.outcome = 'WIN';
          t.realizedR = t.riskRewardRatio;
          t.exitPrice = t.takeProfit;
          t.exitTimestamp = currentCandle.timestamp;
          t.exitDatetime = currentCandle.datetime;
          t.holdingCandles = holding;
          t.pnlPips = Number(((t.exitPrice - t.entryPrice) * (isBuy ? 1 : -1) / pipScale).toFixed(1));
          activeTrade.resolved = true;
          trades.push(t);
          activeTrade = null;
        } else if (holding >= maxHoldingCandles) {
          // Time-based exit at current market close
          const diff = currentCandle.close - t.entryPrice;
          const pnlDirectional = isBuy ? diff : -diff;
          const riskDistance = Math.abs(t.entryPrice - t.stopLoss);
          const rOutcome = riskDistance > 0 ? Number((pnlDirectional / riskDistance).toFixed(2)) : 0;

          t.outcome = rOutcome > 0.3 ? 'WIN' : rOutcome < -0.3 ? 'LOSS' : 'BREAKEVEN';
          t.realizedR = rOutcome;
          t.exitPrice = currentCandle.close;
          t.exitTimestamp = currentCandle.timestamp;
          t.exitDatetime = currentCandle.datetime;
          t.holdingCandles = holding;
          t.pnlPips = Number((pnlDirectional / pipScale).toFixed(1));
          activeTrade.resolved = true;
          trades.push(t);
          activeTrade = null;
        }
      }

      // If no active trade, scan for trade setup at the close of candle i
      if (!activeTrade) {
        // STRICT LOOK-AHEAD PREVENTION: Slicing candles exactly up to index i (inclusive)
        const availableCandles = candles.slice(0, i + 1);

        // Generate dynamic setup parameters based on current price structure
        const lastBar = availableCandles[availableCandles.length - 1];
        const prevBars = availableCandles.slice(-15);
        const highestHigh = Math.max(...prevBars.map(b => b.high));
        const lowestLow = Math.min(...prevBars.map(b => b.low));
        
        // Approximate ATR
        const recentRanges = prevBars.map(b => b.high - b.low);
        const localAtr = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;

        // Try both BUY and SELL candidate setups
        const candidateDirections: TradeDirection[] = ['BUY', 'SELL'];

        for (const dir of candidateDirections) {
          totalSetupsEvaluated++;
          const isBuy = dir === 'BUY';
          const entryPrice = lastBar.close;
          
          let stopLoss: number;
          let takeProfit: number;

          if (isBuy) {
            stopLoss = Number((Math.min(lowestLow, entryPrice - localAtr * 1.4)).toFixed(5));
            const risk = entryPrice - stopLoss;
            takeProfit = Number((entryPrice + risk * 2.0).toFixed(5));
          } else {
            stopLoss = Number((Math.max(highestHigh, entryPrice + localAtr * 1.4)).toFixed(5));
            const risk = stopLoss - entryPrice;
            takeProfit = Number((entryPrice - risk * 2.0).toFixed(5));
          }

          const setupInput: SetupInput = {
            pair,
            timeframe: timeframe as any,
            direction: dir,
            entryPrice,
            stopLoss,
            takeProfit,
          };

          const analysis = SetupAnalyzerEngine.analyzeSetup(
            setupInput,
            availableCandles,
            weights,
            thresholds,
            'AVAILABLE',
            'Curated Historical Walk-Forward'
          );

          if (analysis.decision === 'VALID SETUP') {
            validSetupsCount++;
            // Execute trade
            const newTrade: BacktestTrade = {
              id: `bt_${pair}_${i}_${dir}`,
              setupIndex: i,
              entryTimestamp: currentCandle.timestamp,
              entryDatetime: currentCandle.datetime || new Date(currentCandle.timestamp).toISOString(),
              pair,
              timeframe,
              direction: dir,
              entryPrice,
              stopLoss,
              takeProfit,
              decision: 'VALID SETUP',
              overallScore: analysis.overallScore,
              riskRewardRatio: analysis.riskMetrics.riskRewardRatio,
              outcome: 'WIN', // will be resolved
              realizedR: 0,
              exitPrice: 0,
              holdingCandles: 0,
              pnlPips: 0,
              analysis,
            };

            activeTrade = {
              trade: newTrade,
              resolved: false,
              entryIdx: i,
            };
            break; // Stop evaluating second direction for this bar once valid setup is triggered
          } else if (analysis.decision === 'WAIT') {
            waitSetupsCount++;
          } else if (analysis.decision === 'REJECT') {
            rejectedSetupsCount++;
          } else {
            noTradeCount++;
          }
        }
      }
    }

    // 3. Compile Statistics
    const stats = this.computeSummaryStats(
      trades,
      totalSetupsEvaluated,
      validSetupsCount,
      waitSetupsCount,
      rejectedSetupsCount,
      noTradeCount
    );

    const startCandle = candles[startIndex];
    const endCandle = candles[endIndex];

    return {
      pair,
      timeframe,
      totalCandles: endIndex - startIndex + 1,
      splitType,
      splitRange: {
        startIndex,
        endIndex,
        startTime: startCandle?.datetime || new Date(startCandle?.timestamp || 0).toISOString(),
        endTime: endCandle?.datetime || new Date(endCandle?.timestamp || 0).toISOString(),
      },
      stats,
      trades,
      ranAt: Date.now(),
      isLookAheadFree: true,
    };
  }

  private static computeSummaryStats(
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

    const equityCurve: { tradeIndex: number; timestamp: number; cumulativeR: number; drawdownR: number }[] = [
      { tradeIndex: 0, timestamp: trades[0]?.entryTimestamp || Date.now(), cumulativeR: 0, drawdownR: 0 },
    ];

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const r = t.realizedR;
      cumulativeR += r;

      if (cumulativeR > peakR) {
        peakR = cumulativeR;
      }
      const dd = peakR - cumulativeR;
      if (dd > maxDrawdownR) {
        maxDrawdownR = dd;
      }

      equityCurve.push({
        tradeIndex: i + 1,
        timestamp: t.exitTimestamp || t.entryTimestamp,
        cumulativeR: Number(cumulativeR.toFixed(2)),
        drawdownR: Number(dd.toFixed(2)),
      });

      if (r > 0.1) {
        wins++;
        grossWinR += r;
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxConsecutiveWins) maxConsecutiveWins = currentWinStreak;
      } else if (r < -0.1) {
        losses++;
        grossLossR += Math.abs(r);
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
      } else {
        breakevens++;
      }
    }

    const winRate = executedTradesCount > 0 ? Number(((wins / executedTradesCount) * 100).toFixed(1)) : 0;
    const averageR = executedTradesCount > 0 ? Number((cumulativeR / executedTradesCount).toFixed(2)) : 0;
    const averageWinR = wins > 0 ? Number((grossWinR / wins).toFixed(2)) : 0;
    const averageLossR = losses > 0 ? Number((grossLossR / losses).toFixed(2)) : 0;

    const winProb = wins / (executedTradesCount || 1);
    const lossProb = losses / (executedTradesCount || 1);
    const expectancy = Number(((winProb * averageWinR) - (lossProb * averageLossR)).toFixed(2));

    const profitFactor = grossLossR > 0 ? Number((grossWinR / grossLossR).toFixed(2)) : grossWinR > 0 ? 99.9 : 0;

    return {
      totalSetups,
      validSetupsCount,
      waitSetupsCount,
      rejectedSetupsCount,
      noTradeCount,
      executedTradesCount,
      wins,
      losses,
      breakevens,
      winRate,
      averageR,
      averageWinR,
      averageLossR,
      netR: Number(cumulativeR.toFixed(2)),
      expectancy,
      profitFactor,
      maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
      maxConsecutiveWins,
      maxConsecutiveLosses,
      sampleSize: executedTradesCount,
      equityCurve,
    };
  }

  private static emptyResult(pair: string, timeframe: string, splitType: DataSplitType): BacktestResult {
    return {
      pair,
      timeframe,
      totalCandles: 0,
      splitType,
      splitRange: { startIndex: 0, endIndex: 0, startTime: '', endTime: '' },
      stats: {
        totalSetups: 0,
        validSetupsCount: 0,
        waitSetupsCount: 0,
        rejectedSetupsCount: 0,
        noTradeCount: 0,
        executedTradesCount: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        winRate: 0,
        averageR: 0,
        averageWinR: 0,
        averageLossR: 0,
        netR: 0,
        expectancy: 0,
        profitFactor: 0,
        maxDrawdownR: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        sampleSize: 0,
        equityCurve: [],
      },
      trades: [],
      ranAt: Date.now(),
      isLookAheadFree: true,
    };
  }
}
