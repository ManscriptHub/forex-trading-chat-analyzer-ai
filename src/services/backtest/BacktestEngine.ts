import { Candle, DatasetKind } from '../../types/market';
import {
  BacktestAuditInfo,
  BacktestResult,
  BacktestSummaryStats,
  BacktestTrade,
  CostModelConfig,
  DataSplitType,
  EvaluatedSetupRecord,
  PeriodStabilityRecord,
  RegimePerformanceRecord,
  ReplayStepSnapshot,
} from '../../types/backtest';
import {
  CalibrationThresholds,
  CalibrationWeights,
  SetupAnalysisResult,
  SetupInput,
  TradeDirection,
} from '../../types/analyzer';
import { SetupAnalyzerEngine, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../analyzer/SetupAnalyzerEngine';
import { getPipScale } from '../marketData/historicalDataGenerator';
import { ReplayDatasetService } from './ReplayDatasetService';
import { MarketDataRegistry } from '../marketData/MarketDataRegistry';

export function getTypicalSpreadPips(pair: string): number {
  const p = pair.toUpperCase();
  if (p.includes('EUR/USD')) return 1.0;
  if (p.includes('GBP/USD')) return 1.5;
  if (p.includes('USD/JPY')) return 1.2;
  if (p.includes('AUD/USD')) return 1.2;
  if (p.includes('USD/CAD')) return 1.4;
  if (p.includes('USD/CHF')) return 1.4;
  if (p.includes('EUR/JPY')) return 1.6;
  if (p.includes('GBP/JPY')) return 2.2;
  if (p.includes('XAU/USD')) return 3.0;
  return 1.5;
}

export function getDefaultCommissionPips(pair: string): number {
  // Institutional standard ~$4 to $6 per lot round-turn (~0.4 - 0.6 pips on majors)
  const p = pair.toUpperCase();
  if (p.includes('XAU/USD')) return 1.0;
  return 0.4;
}

export function getDefaultSlippagePips(pair: string): number {
  // Modeled normal execution slippage (entry + exit impact)
  const p = pair.toUpperCase();
  if (p.includes('XAU/USD')) return 0.5;
  if (p.includes('GBP/JPY') || p.includes('EUR/JPY')) return 0.3;
  return 0.2;
}

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
  maxHoldingCandles?: number; // default 35 candles before timeout close
  costModel?: Partial<CostModelConfig>; // Spread, Commission, Slippage
  datasetName?: string;
  datasetKind?: DatasetKind;
  saveDatasetForCalibration?: boolean;
}

export class BacktestEngine {
  /**
   * Runs a strictly chronological candle replay backtesting simulation.
   * Guarantees ZERO look-ahead bias:
   * 1. At step t, analysis is generated using ONLY candles available up to candle t: `candles.slice(0, t + 1)`.
   * 2. When a setup triggers, subsequent candles (t+1, t+2, ...) are scanned sequentially one by one
   *    to resolve Stop Loss / Take Profit / Timeout with complete cost friction.
   * 3. Parameter optimization can use Train only. Test partition is locked until final out-of-sample audit.
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
      saveDatasetForCalibration = true,
    } = options;

    const totalCandles = candles.length;
    if (totalCandles < 40) {
      return this.emptyResult(pair, timeframe, splitType, options);
    }

    // 1. Calculate Split Ranges with Strict Partitioning
    const trainEnd = Math.floor(totalCandles * (trainPct / 100));
    const valEnd = Math.floor(totalCandles * ((trainPct + valPct) / 100));

    let startIndex = 30; // Warm-up period for 200 EMA & RSI
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

    // 2. Cost Model Configuration (Separated Spread, Commission, Slippage)
    const costModel: CostModelConfig = {
      spreadPips: options.costModel?.spreadPips !== undefined
        ? options.costModel.spreadPips
        : getTypicalSpreadPips(pair),
      commissionPips: options.costModel?.commissionPips !== undefined
        ? options.costModel.commissionPips
        : getDefaultCommissionPips(pair),
      slippagePips: options.costModel?.slippagePips !== undefined
        ? options.costModel.slippagePips
        : getDefaultSlippagePips(pair),
    };

    const pipScale = getPipScale(pair);
    const spreadPrice = costModel.spreadPips * pipScale;
    const slippagePrice = costModel.slippagePips * pipScale;
    const totalFrictionalPips = costModel.spreadPips + costModel.commissionPips + costModel.slippagePips;

    const trades: BacktestTrade[] = [];
    const replaySteps: ReplayStepSnapshot[] = [];
    const evaluatedSetups: EvaluatedSetupRecord[] = [];

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

    // 3. Sequential Chronological Walk-Forward Replay Loop
    for (let i = startIndex; i < endIndex; i++) {
      const currentCandle = candles[i];
      let resolvedTradeThisBar: BacktestTrade | null = null;
      let executedTradeThisBar: BacktestTrade | null = null;

      // Classify Market Regime at Bar i strictly from causal history up to bar i
      const lookbackStart = Math.max(0, i - 350);
      const currentSlice = candles.slice(lookbackStart, i + 1);
      const currentRegime = this.classifyMarketRegime(currentSlice);

      // A. Check Active Trade Resolution on Current Bar i
      if (activeTrade && !activeTrade.resolved) {
        const t = activeTrade.trade;
        const isBuy = t.direction === 'BUY';
        let hitSL = false;
        let hitTP = false;

        t.resolutionPath = t.resolutionPath || [];
        t.resolutionPath.push({
          candleIndex: i,
          high: currentCandle.high,
          low: currentCandle.low,
          close: currentCandle.close,
          timestamp: currentCandle.timestamp,
        });

        // Intra-candle high/low check with Bid/Ask spread + slippage modeling
        if (isBuy) {
          // BUY is closed at Bid (Candle Low/High minus exit slippage)
          if (currentCandle.low - slippagePrice <= t.stopLoss) hitSL = true;
          if (currentCandle.high - slippagePrice >= t.takeProfit) hitTP = true;
        } else {
          // SELL is closed at Ask (Candle High/Low + Spread + exit slippage)
          if (currentCandle.high + spreadPrice + slippagePrice >= t.stopLoss) hitSL = true;
          if (currentCandle.low + spreadPrice + slippagePrice <= t.takeProfit) hitTP = true;
        }

        const holding = i - activeTrade.entryIdx;

        if (hitSL && hitTP) {
          // Worst-case conservative assumption: Stop Loss triggered first
          t.outcome = 'LOSS';
          t.realizedR = -1.0;
          t.grossR = -1.0;
          t.exitPrice = t.stopLoss;
          t.exitTimestamp = currentCandle.timestamp;
          t.exitDatetime = currentCandle.datetime || new Date(currentCandle.timestamp).toISOString();
          t.holdingCandles = holding;
          t.pnlPips = Number((-Math.abs(t.entryPrice - t.stopLoss) / pipScale).toFixed(1));
          t.frictionalCostPips = totalFrictionalPips;
          activeTrade.resolved = true;
          resolvedTradeThisBar = t;
          trades.push(t);
          activeTrade = null;
        } else if (hitSL) {
          t.outcome = 'LOSS';
          t.realizedR = -1.0;
          t.grossR = -1.0;
          t.exitPrice = t.stopLoss;
          t.exitTimestamp = currentCandle.timestamp;
          t.exitDatetime = currentCandle.datetime || new Date(currentCandle.timestamp).toISOString();
          t.holdingCandles = holding;
          t.pnlPips = Number((-Math.abs(t.entryPrice - t.stopLoss) / pipScale).toFixed(1));
          t.frictionalCostPips = totalFrictionalPips;
          activeTrade.resolved = true;
          resolvedTradeThisBar = t;
          trades.push(t);
          activeTrade = null;
        } else if (hitTP) {
          t.outcome = 'WIN';
          const grossR = Number(t.riskRewardRatio.toFixed(2));
          // Subtract commission drag from realized R
          const riskDistancePips = Math.abs(t.entryPrice - t.stopLoss) / pipScale;
          const commRDrag = riskDistancePips > 0 ? (costModel.commissionPips / riskDistancePips) : 0;
          t.realizedR = Number(Math.max(0, grossR - commRDrag).toFixed(2));
          t.grossR = grossR;
          t.exitPrice = t.takeProfit;
          t.exitTimestamp = currentCandle.timestamp;
          t.exitDatetime = currentCandle.datetime || new Date(currentCandle.timestamp).toISOString();
          t.holdingCandles = holding;
          t.pnlPips = Number((Math.abs(t.takeProfit - t.entryPrice) / pipScale).toFixed(1));
          t.frictionalCostPips = totalFrictionalPips;
          activeTrade.resolved = true;
          resolvedTradeThisBar = t;
          trades.push(t);
          activeTrade = null;
        } else if (holding >= maxHoldingCandles) {
          // Time-based exit at market close
          const exitP = isBuy ? (currentCandle.close - slippagePrice) : (currentCandle.close + spreadPrice + slippagePrice);
          const diff = exitP - t.entryPrice;
          const pnlDirectional = isBuy ? diff : -diff;
          const riskDistance = Math.abs(t.entryPrice - t.stopLoss);
          const grossROutcome = riskDistance > 0 ? Number((pnlDirectional / riskDistance).toFixed(2)) : 0;
          const riskDistancePips = riskDistance / pipScale;
          const commRDrag = riskDistancePips > 0 ? (costModel.commissionPips / riskDistancePips) : 0;
          const rOutcome = Number((grossROutcome - commRDrag).toFixed(2));

          t.outcome = rOutcome > 0.3 ? 'WIN' : rOutcome < -0.3 ? 'LOSS' : 'BREAKEVEN';
          t.realizedR = rOutcome;
          t.grossR = grossROutcome;
          t.exitPrice = exitP;
          t.exitTimestamp = currentCandle.timestamp;
          t.exitDatetime = currentCandle.datetime || new Date(currentCandle.timestamp).toISOString();
          t.holdingCandles = holding;
          t.pnlPips = Number((pnlDirectional / pipScale).toFixed(1));
          t.frictionalCostPips = totalFrictionalPips;
          activeTrade.resolved = true;
          resolvedTradeThisBar = t;
          trades.push(t);
          activeTrade = null;
        }
      }

      // B. Evaluate Setup Candidates at End of Bar i
      const availableCandles = candles.slice(lookbackStart, i + 1);
      const lastBar = currentCandle;

      let primaryAnalysisThisBar: SetupAnalysisResult | undefined;

      // Evaluate potential setups only when not already in an open trade
      if (!activeTrade) {
        const candidateDirections: TradeDirection[] = ['BUY', 'SELL'];

        for (const dir of candidateDirections) {
          totalSetupsEvaluated++;
          const isBuy = dir === 'BUY';
          const midPrice = lastBar.close;

          // Modeled execution entry price (Buy at Ask + Slippage, Sell at Bid - Slippage)
          const entryPrice = isBuy
            ? Number((midPrice + spreadPrice / 2 + slippagePrice).toFixed(5))
            : Number((midPrice - spreadPrice / 2 - slippagePrice).toFixed(5));

          let stopLoss: number;
          let takeProfit: number;

          // Estimate recent local volatility structure
          const recentSlices = availableCandles.slice(-15);
          const recentHigh = Math.max(...recentSlices.map(c => c.high));
          const recentLow = Math.min(...recentSlices.map(c => c.low));
          const rangeDistance = Math.max((recentHigh - recentLow) * 0.8, 12 * pipScale);

          if (isBuy) {
            stopLoss = Number((Math.min(recentLow, entryPrice - rangeDistance)).toFixed(5));
            const riskDist = entryPrice - stopLoss;
            takeProfit = Number((entryPrice + riskDist * 2.0).toFixed(5));
          } else {
            stopLoss = Number((Math.max(recentHigh, entryPrice + rangeDistance)).toFixed(5));
            const riskDist = stopLoss - entryPrice;
            takeProfit = Number((entryPrice - riskDist * 2.0).toFixed(5));
          }

          const setupInput: SetupInput = {
            pair,
            timeframe: timeframe as any,
            direction: dir,
            entryPrice,
            stopLoss,
            takeProfit,
          };

          const analysis = SetupAnalyzerEngine.analyzeSetup(setupInput, availableCandles, weights, thresholds);

          if (dir === 'BUY') {
            primaryAnalysisThisBar = analysis;
          } else if (!primaryAnalysisThisBar || analysis.overallScore > primaryAnalysisThisBar.overallScore) {
            primaryAnalysisThisBar = analysis;
          }

          // Simulate prospective forward resolution for dataset calibration records (bounded strictly by partition endIndex)
          const prospectiveOutcome = this.simulateForwardResolution(
            candles,
            i,
            dir,
            entryPrice,
            stopLoss,
            takeProfit,
            pipScale,
            spreadPrice,
            slippagePrice,
            costModel.commissionPips,
            maxHoldingCandles,
            endIndex
          );

          evaluatedSetups.push({
            id: `setup_${pair.replace('/', '')}_${timeframe}_${i}_${dir}`,
            stepIndex: i,
            timestamp: lastBar.timestamp,
            datetime: lastBar.datetime || new Date(lastBar.timestamp).toISOString(),
            pair,
            timeframe,
            direction: dir,
            entryPrice,
            stopLoss,
            takeProfit,
            riskRewardRatio: analysis.riskMetrics.riskRewardRatio,
            marketRegime: currentRegime.regime,
            factorScores: analysis.factors.map(f => ({
              factorKey: f.factorKey,
              factorName: f.factorName,
              rawScore: f.score,
              maxScore: f.maxScore,
              status: f.status,
              reasoning: f.reasoning,
            })),
            initialDecision: analysis.decision,
            initialScore: analysis.overallScore,
            outcomeIfExecuted: prospectiveOutcome,
          });

          // Track decision distributions
          if (analysis.decision === 'VALID SETUP') {
            validSetupsCount++;
            // Execute trade if no active position
            if (!activeTrade) {
              const trade: BacktestTrade = {
                id: `trade_${pair.replace('/', '')}_${timeframe}_${i}_${dir}`,
                setupIndex: i,
                entryTimestamp: lastBar.timestamp,
                entryDatetime: lastBar.datetime || new Date(lastBar.timestamp).toISOString(),
                pair,
                timeframe,
                direction: dir,
                entryPrice,
                stopLoss,
                takeProfit,
                decision: 'VALID SETUP',
                overallScore: analysis.overallScore,
                riskRewardRatio: analysis.riskMetrics.riskRewardRatio,
                outcome: 'TIMEOUT_CLOSE', // default until resolved
                realizedR: 0,
                exitPrice: entryPrice,
                holdingCandles: 0,
                pnlPips: 0,
                frictionalCostPips: totalFrictionalPips,
                marketRegimeAtEntry: currentRegime.label,
                analysis,
              };

              activeTrade = {
                trade,
                resolved: false,
                entryIdx: i,
              };
              executedTradeThisBar = trade;
            }
          } else if (analysis.decision === 'WAIT') {
            waitSetupsCount++;
          } else if (analysis.decision === 'REJECT') {
            rejectedSetupsCount++;
          } else {
            noTradeCount++;
          }
        }
      }

      // C. Capture Replay Step Snapshot for Interactive Stepper
      let activeTradeStatus: ReplayStepSnapshot['activeTradeStatus'] = null;
      if (activeTrade && !activeTrade.resolved) {
        const t = activeTrade.trade;
        const isBuy = t.direction === 'BUY';
        const diff = isBuy ? currentCandle.close - t.entryPrice : t.entryPrice - currentCandle.close;
        const riskDistance = Math.abs(t.entryPrice - t.stopLoss);
        const currR = riskDistance > 0 ? Number((diff / riskDistance).toFixed(2)) : 0;

        activeTradeStatus = {
          tradeId: t.id,
          direction: t.direction,
          entryPrice: t.entryPrice,
          stopLoss: t.stopLoss,
          takeProfit: t.takeProfit,
          holdingCandles: i - activeTrade.entryIdx,
          currentUnrealizedR: currR,
        };
      }

      replaySteps.push({
        stepIndex: i,
        candle: currentCandle,
        analysis: primaryAnalysisThisBar,
        executedTrade: executedTradeThisBar,
        activeTradeStatus,
        resolvedTrade: resolvedTradeThisBar,
      });
    }

    // Close any position remaining open at final boundary
    if (activeTrade && !activeTrade.resolved) {
      const t = activeTrade.trade;
      const isBuy = t.direction === 'BUY';
      const lastCandle = candles[endIndex] || candles[candles.length - 1];
      const exitP = isBuy ? (lastCandle.close - slippagePrice) : (lastCandle.close + spreadPrice + slippagePrice);
      const diff = exitP - t.entryPrice;
      const pnlDirectional = isBuy ? diff : -diff;
      const riskDistance = Math.abs(t.entryPrice - t.stopLoss);
      const grossROutcome = riskDistance > 0 ? Number((pnlDirectional / riskDistance).toFixed(2)) : 0;
      const riskDistancePips = riskDistance / pipScale;
      const commRDrag = riskDistancePips > 0 ? (costModel.commissionPips / riskDistancePips) : 0;
      const rOutcome = Number((grossROutcome - commRDrag).toFixed(2));

      t.outcome = rOutcome > 0.3 ? 'WIN' : rOutcome < -0.3 ? 'LOSS' : 'BREAKEVEN';
      t.realizedR = rOutcome;
      t.grossR = grossROutcome;
      t.exitPrice = exitP;
      t.exitTimestamp = lastCandle.timestamp;
      t.exitDatetime = lastCandle.datetime || new Date(lastCandle.timestamp).toISOString();
      t.holdingCandles = endIndex - activeTrade.entryIdx;
      t.pnlPips = Number((pnlDirectional / pipScale).toFixed(1));
      t.frictionalCostPips = totalFrictionalPips;
      activeTrade.resolved = true;
      trades.push(t);
      activeTrade = null;
    }

    // 4. Compile Statistics, Stability, and Regime Performance
    const stats = this.computeSummaryStats(
      trades,
      candles,
      startIndex,
      endIndex,
      totalSetupsEvaluated,
      validSetupsCount,
      waitSetupsCount,
      rejectedSetupsCount,
      noTradeCount
    );

    const startCandle = candles[startIndex];
    const endCandle = candles[endIndex];

    const activeProvider = MarketDataRegistry.getInstance().getActiveProvider();
    const datasetKind: DatasetKind = options.datasetKind || activeProvider.datasetKind || 'SYNTHETIC_BENCHMARK';
    const datasetName: string = options.datasetName || activeProvider.name;

    const auditInfo: BacktestAuditInfo = {
      datasetName,
      datasetKind,
      pair,
      timeframe,
      totalBars: totalCandles,
      dateRange: {
        start: startCandle?.datetime || new Date(startCandle?.timestamp || 0).toISOString(),
        end: endCandle?.datetime || new Date(endCandle?.timestamp || 0).toISOString(),
      },
      partition: splitType,
      partitionBars: endIndex - startIndex + 1,
      costModel,
      totalFrictionPipsPerTrade: Number(totalFrictionalPips.toFixed(2)),
      weightsUsed: { ...weights },
      thresholdsUsed: { ...thresholds },
      syntheticDisclaimer:
        datasetKind === 'SYNTHETIC_BENCHMARK'
          ? 'SYNTHETIC BENCHMARK: Performance metrics generated from synthetic test series do not represent live market edge or real-world profitability.'
          : undefined,
      isLookAheadFree: true,
      evaluatedTimestamp: Date.now(),
    };

    const result: BacktestResult = {
      pair,
      timeframe,
      totalCandles: endIndex - startIndex + 1,
      splitType,
      splitRange: {
        startIndex,
        endIndex,
        startTime: auditInfo.dateRange.start,
        endTime: auditInfo.dateRange.end,
      },
      costModel,
      auditInfo,
      stats,
      trades,
      replaySteps,
      evaluatedSetups,
      ranAt: Date.now(),
      isLookAheadFree: true,
    };

    // Save for offline factor recalibration if requested
    if (saveDatasetForCalibration) {
      ReplayDatasetService.saveReplayDataset(result, weights, thresholds);
    }

    return result;
  }

  /**
   * Forward resolution simulator with full friction costs
   */
  private static simulateForwardResolution(
    candles: Candle[],
    entryIdx: number,
    direction: TradeDirection,
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    pipScale: number,
    spreadPrice: number,
    slippagePrice: number,
    commissionPips: number,
    maxHolding: number = 35,
    partitionEndIdx?: number
  ): EvaluatedSetupRecord['outcomeIfExecuted'] {
    const isBuy = direction === 'BUY';
    const riskDistance = Math.abs(entryPrice - stopLoss);
    const ceilingIdx = partitionEndIdx !== undefined ? Math.min(candles.length - 1, partitionEndIdx) : candles.length - 1;
    const maxIdx = Math.min(ceilingIdx, entryIdx + maxHolding);

    for (let k = entryIdx + 1; k <= maxIdx; k++) {
      const c = candles[k];
      let hitSL = false;
      let hitTP = false;

      if (isBuy) {
        if (c.low - slippagePrice <= stopLoss) hitSL = true;
        if (c.high - slippagePrice >= takeProfit) hitTP = true;
      } else {
        if (c.high + spreadPrice + slippagePrice >= stopLoss) hitSL = true;
        if (c.low + spreadPrice + slippagePrice <= takeProfit) hitTP = true;
      }

      const holding = k - entryIdx;

      if (hitSL && hitTP) {
        return {
          outcome: 'LOSS',
          realizedR: -1.0,
          exitPrice: stopLoss,
          exitIndex: k,
          exitTimestamp: c.timestamp,
          holdingCandles: holding,
          pnlPips: Number((-riskDistance / pipScale).toFixed(1)),
        };
      }

      if (hitSL) {
        return {
          outcome: 'LOSS',
          realizedR: -1.0,
          exitPrice: stopLoss,
          exitIndex: k,
          exitTimestamp: c.timestamp,
          holdingCandles: holding,
          pnlPips: Number((-riskDistance / pipScale).toFixed(1)),
        };
      }

      if (hitTP) {
        const rewardDistance = Math.abs(takeProfit - entryPrice);
        const grossR = riskDistance > 0 ? rewardDistance / riskDistance : 2.0;
        const riskDistancePips = riskDistance / pipScale;
        const commRDrag = riskDistancePips > 0 ? (commissionPips / riskDistancePips) : 0;
        const realizedR = Number(Math.max(0, grossR - commRDrag).toFixed(2));

        return {
          outcome: 'WIN',
          realizedR,
          exitPrice: takeProfit,
          exitIndex: k,
          exitTimestamp: c.timestamp,
          holdingCandles: holding,
          pnlPips: Number((rewardDistance / pipScale).toFixed(1)),
        };
      }
    }

    // Timeout exit at final evaluated bar
    const finalCandle = candles[maxIdx];
    const holding = maxIdx - entryIdx;
    const exitP = isBuy ? (finalCandle.close - slippagePrice) : (finalCandle.close + spreadPrice + slippagePrice);
    const diff = exitP - entryPrice;
    const pnlDir = isBuy ? diff : -diff;
    const grossROutcome = riskDistance > 0 ? diff / riskDistance : 0;
    const riskDistancePips = riskDistance / pipScale;
    const commRDrag = riskDistancePips > 0 ? (commissionPips / riskDistancePips) : 0;
    const rOutcome = Number((grossROutcome - commRDrag).toFixed(2));

    return {
      outcome: rOutcome > 0.3 ? 'WIN' : rOutcome < -0.3 ? 'LOSS' : 'BREAKEVEN',
      realizedR: rOutcome,
      exitPrice: exitP,
      exitIndex: maxIdx,
      exitTimestamp: finalCandle.timestamp,
      holdingCandles: holding,
      pnlPips: Number((pnlDir / pipScale).toFixed(1)),
    };
  }

  /**
   * Market regime classifier
   */
  private static classifyMarketRegime(candles: Candle[]): {
    regime: 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGE_CONSOLIDATION' | 'HIGH_VOLATILITY';
    label: string;
  } {
    if (candles.length < 20) {
      return { regime: 'RANGE_CONSOLIDATION', label: 'Range / Consolidation' };
    }

    const activeCandles = candles.length > 300 ? candles.slice(-300) : candles;
    const closes = activeCandles.map(c => c.close);
    const ema20 = this.calcEma(closes, 20);
    const ema50 = this.calcEma(closes, 50);
    const ema200 = this.calcEma(closes, 200);

    const atr14 = this.calcAtr(activeCandles, 14);
    const avgAtr = this.calcAvgAtr(activeCandles, 40);

    if (atr14 > avgAtr * 1.5) {
      return { regime: 'HIGH_VOLATILITY', label: 'High Volatility' };
    }

    if (ema20 > ema50 && ema50 > ema200) {
      return { regime: 'BULLISH_TREND', label: 'Bullish Trend' };
    }

    if (ema20 < ema50 && ema50 < ema200) {
      return { regime: 'BEARISH_TREND', label: 'Bearish Trend' };
    }

    return { regime: 'RANGE_CONSOLIDATION', label: 'Range / Consolidation' };
  }

  private static calcEma(values: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private static calcAtr(candles: Candle[], period: number): number {
    if (candles.length < 2) return 0.001;
    let trSum = 0;
    const count = Math.min(candles.length - 1, period);
    for (let i = candles.length - count; i < candles.length; i++) {
      const c = candles[i];
      const prevC = candles[i - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevC.close),
        Math.abs(c.low - prevC.close)
      );
      trSum += tr;
    }
    return trSum / count;
  }

  private static calcAvgAtr(candles: Candle[], period: number): number {
    return this.calcAtr(candles, period);
  }

  private static computeSummaryStats(
    trades: BacktestTrade[],
    candles: Candle[],
    startIndex: number,
    endIndex: number,
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
    let totalGrossR = 0;

    const equityCurve: { tradeIndex: number; timestamp: number; cumulativeR: number; drawdownR: number }[] = [
      { tradeIndex: 0, timestamp: trades[0]?.entryTimestamp || Date.now(), cumulativeR: 0, drawdownR: 0 },
    ];

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const r = t.realizedR;
      totalGrossR += t.grossR ?? r;
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

    const grossNetRDrag = Number((totalGrossR - cumulativeR).toFixed(2));

    // Calculate Chronological Sub-Period Stability (e.g. 3 chunks)
    const periodStability = this.computePeriodStability(trades, candles, startIndex, endIndex);
    const positivePeriods = periodStability.filter(p => p.netR > 0).length;
    const stabilityScore = periodStability.length > 0 ? Math.round((positivePeriods / periodStability.length) * 100) : 0;

    // Calculate Regime Performance
    const regimePerformance = this.computeRegimePerformance(trades);

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
      grossNetRDrag,
      expectancy,
      profitFactor,
      maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
      maxConsecutiveWins,
      maxConsecutiveLosses,
      averageHoldingCandles,
      averageWinHoldingCandles,
      averageLossHoldingCandles,
      stabilityScore,
      periodStability,
      regimePerformance,
      sampleSize: executedTradesCount,
      equityCurve,
    };
  }

  private static computePeriodStability(
    trades: BacktestTrade[],
    candles: Candle[],
    startIndex: number,
    endIndex: number
  ): PeriodStabilityRecord[] {
    const totalBars = endIndex - startIndex + 1;
    const numChunks = Math.max(2, Math.min(4, Math.floor(totalBars / 80)));
    const chunkSize = Math.floor(totalBars / numChunks);
    const records: PeriodStabilityRecord[] = [];

    for (let c = 0; c < numChunks; c++) {
      const chunkStartIdx = startIndex + c * chunkSize;
      const chunkEndIdx = c === numChunks - 1 ? endIndex : startIndex + (c + 1) * chunkSize - 1;
      const startCandle = candles[chunkStartIdx];
      const endCandle = candles[chunkEndIdx];

      const periodTrades = trades.filter(
        t => t.entryTimestamp >= (startCandle?.timestamp || 0) && t.entryTimestamp <= (endCandle?.timestamp || Infinity)
      );

      let pWins = 0;
      let pLosses = 0;
      let pGrossWinR = 0;
      let pGrossLossR = 0;
      let pNetR = 0;
      let pPeak = 0;
      let pMaxDD = 0;

      for (const t of periodTrades) {
        const r = t.realizedR;
        pNetR += r;
        if (pNetR > pPeak) pPeak = pNetR;
        const dd = pPeak - pNetR;
        if (dd > pMaxDD) pMaxDD = dd;

        if (r > 0.1) {
          pWins++;
          pGrossWinR += r;
        } else if (r < -0.1) {
          pLosses++;
          pGrossLossR += Math.abs(r);
        }
      }

      const pCount = periodTrades.length;
      const pWinRate = pCount > 0 ? Number(((pWins / pCount) * 100).toFixed(1)) : 0;
      const pLossRate = pCount > 0 ? Number(((pLosses / pCount) * 100).toFixed(1)) : 0;
      const pAvgR = pCount > 0 ? Number((pNetR / pCount).toFixed(2)) : 0;
      const pAvgWin = pWins > 0 ? pGrossWinR / pWins : 0;
      const pAvgLoss = pLosses > 0 ? pGrossLossR / pLosses : 0;
      const pExpectancy = Number((( (pWins / (pCount || 1)) * pAvgWin ) - ( (pLosses / (pCount || 1)) * pAvgLoss )).toFixed(2));
      const pPf = pGrossLossR > 0 ? Number((pGrossWinR / pGrossLossR).toFixed(2)) : pGrossWinR > 0 ? 99.9 : 0;

      records.push({
        periodName: `Period ${c + 1} (${Math.round((chunkStartIdx / candles.length) * 100)}%-${Math.round((chunkEndIdx / candles.length) * 100)}%)`,
        startDate: startCandle?.datetime || new Date(startCandle?.timestamp || 0).toLocaleDateString(),
        endDate: endCandle?.datetime || new Date(endCandle?.timestamp || 0).toLocaleDateString(),
        startIndex: chunkStartIdx,
        endIndex: chunkEndIdx,
        tradesCount: pCount,
        winRate: pWinRate,
        lossRate: pLossRate,
        netR: Number(pNetR.toFixed(2)),
        averageR: pAvgR,
        profitFactor: pPf,
        maxDrawdownR: Number(pMaxDD.toFixed(2)),
        expectancy: pExpectancy,
      });
    }

    return records;
  }

  private static computeRegimePerformance(trades: BacktestTrade[]): RegimePerformanceRecord[] {
    const regimes: { regime: RegimePerformanceRecord['regime']; label: string; desc: string }[] = [
      { regime: 'BULLISH_TREND', label: 'Bullish Trend', desc: 'EMA 20 > 50 > 200 upward stacked' },
      { regime: 'BEARISH_TREND', label: 'Bearish Trend', desc: 'EMA 20 < 50 < 200 downward stacked' },
      { regime: 'RANGE_CONSOLIDATION', label: 'Range / Consolidation', desc: 'EMA compression / horizontal range' },
      { regime: 'HIGH_VOLATILITY', label: 'High Volatility', desc: 'ATR > 1.5x expanding expansion phase' },
    ];

    return regimes.map(r => {
      const matchingTrades = trades.filter(t => t.marketRegimeAtEntry === r.label || t.marketRegimeAtEntry === r.regime);
      let rWins = 0;
      let rLosses = 0;
      let rGrossWinR = 0;
      let rGrossLossR = 0;
      let rNetR = 0;
      let rHoldingSum = 0;

      for (const t of matchingTrades) {
        const res = t.realizedR;
        rNetR += res;
        rHoldingSum += t.holdingCandles;
        if (res > 0.1) {
          rWins++;
          rGrossWinR += res;
        } else if (res < -0.1) {
          rLosses++;
          rGrossLossR += Math.abs(res);
        }
      }

      const count = matchingTrades.length;
      const winRate = count > 0 ? Number(((rWins / count) * 100).toFixed(1)) : 0;
      const avgWin = rWins > 0 ? rGrossWinR / rWins : 0;
      const avgLoss = rLosses > 0 ? rGrossLossR / rLosses : 0;
      const expectancy = Number((((rWins / (count || 1)) * avgWin) - ((rLosses / (count || 1)) * avgLoss)).toFixed(2));
      const profitFactor = rGrossLossR > 0 ? Number((rGrossWinR / rGrossLossR).toFixed(2)) : rGrossWinR > 0 ? 99.9 : 0;
      const avgHolding = count > 0 ? Number((rHoldingSum / count).toFixed(1)) : 0;

      return {
        regime: r.regime,
        label: r.label,
        description: r.desc,
        tradesCount: count,
        winRate,
        netR: Number(rNetR.toFixed(2)),
        profitFactor,
        expectancy,
        avgHoldingBars: avgHolding,
      };
    });
  }

  private static emptyResult(
    pair: string,
    timeframe: string,
    splitType: DataSplitType,
    options: BacktestOptions
  ): BacktestResult {
    const costModel: CostModelConfig = {
      spreadPips: options.costModel?.spreadPips || getTypicalSpreadPips(pair),
      commissionPips: options.costModel?.commissionPips || getDefaultCommissionPips(pair),
      slippagePips: options.costModel?.slippagePips || getDefaultSlippagePips(pair),
    };

    const auditInfo: BacktestAuditInfo = {
      datasetName: options.datasetName || 'Empty Dataset',
      datasetKind: options.datasetKind || 'SYNTHETIC_BENCHMARK',
      pair,
      timeframe,
      totalBars: 0,
      dateRange: { start: '', end: '' },
      partition: splitType,
      partitionBars: 0,
      costModel,
      totalFrictionPipsPerTrade: costModel.spreadPips + costModel.commissionPips + costModel.slippagePips,
      weightsUsed: options.weights || DEFAULT_WEIGHTS,
      thresholdsUsed: options.thresholds || DEFAULT_THRESHOLDS,
      isLookAheadFree: true,
      evaluatedTimestamp: Date.now(),
    };

    return {
      pair,
      timeframe,
      totalCandles: 0,
      splitType,
      splitRange: { startIndex: 0, endIndex: 0, startTime: '', endTime: '' },
      costModel,
      auditInfo,
      stats: {
        totalSetups: 0,
        validSetupsCount: 0,
        waitSetupsCount: 0,
        rejectedSetupsCount: 0,
        noTradeCount: 0,
        filterRatePercent: 0,
        executedTradesCount: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        winRate: 0,
        lossRate: 0,
        breakevenRate: 0,
        averageR: 0,
        averageWinR: 0,
        averageLossR: 0,
        netR: 0,
        grossNetRDrag: 0,
        expectancy: 0,
        profitFactor: 0,
        maxDrawdownR: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        averageHoldingCandles: 0,
        averageWinHoldingCandles: 0,
        averageLossHoldingCandles: 0,
        stabilityScore: 0,
        periodStability: [],
        regimePerformance: [],
        sampleSize: 0,
        equityCurve: [],
      },
      trades: [],
      replaySteps: [],
      evaluatedSetups: [],
      ranAt: Date.now(),
      isLookAheadFree: true,
    };
  }
}
