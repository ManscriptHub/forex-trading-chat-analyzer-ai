import * as fs from 'fs';
import { CandleDataValidator } from './src/services/marketData/CandleDataValidator';
import { BacktestEngine } from './src/services/backtest/BacktestEngine';
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from './src/services/analyzer/SetupAnalyzerEngine';
import { calculateEMA, calculateATR } from './src/services/analyzer/technicalIndicators';
import { BacktestTrade } from './src/types/backtest';

interface GroupMetrics {
  name: string;
  tradesCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  netR: number;
  expectancy: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgHolding: number;
  maxDrawdownR: number;
  maxConsecutiveLosses: number;
}

function computeGroupMetrics(name: string, trades: BacktestTrade[]): GroupMetrics {
  const n = trades.length;
  if (n === 0) {
    return {
      name,
      tradesCount: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: 0,
      netR: 0,
      expectancy: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      avgHolding: 0,
      maxDrawdownR: 0,
      maxConsecutiveLosses: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let netR = 0;
  let totalHolding = 0;
  let maxConsecLosses = 0;
  let currentConsecLosses = 0;
  let peakR = 0;
  let maxDD = 0;
  let cumR = 0;

  trades.forEach(t => {
    netR += t.realizedR;
    cumR += t.realizedR;
    if (cumR > peakR) peakR = cumR;
    const dd = peakR - cumR;
    if (dd > maxDD) maxDD = dd;
    totalHolding += t.holdingCandles || 0;

    if (t.realizedR > 0.1 || t.outcome === 'WIN') {
      wins++;
      grossWinR += Math.max(0, t.realizedR);
      currentConsecLosses = 0;
    } else if (t.realizedR < -0.1 || t.outcome === 'LOSS') {
      losses++;
      grossLossR += Math.abs(Math.min(0, t.realizedR));
      currentConsecLosses++;
      if (currentConsecLosses > maxConsecLosses) maxConsecLosses = currentConsecLosses;
    } else {
      breakevens++;
      currentConsecLosses = 0;
    }
  });

  const winRate = Number(((wins / n) * 100).toFixed(1));
  const expectancy = Number((netR / n).toFixed(2));
  const profitFactor = grossLossR > 0 ? Number((grossWinR / grossLossR).toFixed(2)) : grossWinR > 0 ? 99.9 : 0;
  const avgWin = wins > 0 ? Number((grossWinR / wins).toFixed(2)) : 0;
  const avgLoss = losses > 0 ? Number((grossLossR / losses).toFixed(2)) : 0;
  const avgHolding = Number((totalHolding / n).toFixed(1));

  return {
    name,
    tradesCount: n,
    wins,
    losses,
    breakevens,
    winRate,
    netR: Number(netR.toFixed(2)),
    expectancy,
    profitFactor,
    avgWin,
    avgLoss,
    avgHolding,
    maxDrawdownR: Number(maxDD.toFixed(2)),
    maxConsecutiveLosses: maxConsecLosses,
  };
}

interface FactorStat {
  factor: string;
  winMean: number;
  lossMean: number;
  delta: number;
}

function analyzeFactorsByOutcome(trades: BacktestTrade[]): FactorStat[] {
  const winTrades = trades.filter(t => t.realizedR > 0.1 || t.outcome === 'WIN');
  const lossTrades = trades.filter(t => t.realizedR < -0.1 || t.outcome === 'LOSS');

  const factorKeys = [
    { key: 'trend', name: 'Trend Alignment' },
    { key: 'marketStructure', name: 'Market Structure' },
    { key: 'supportResistance', name: 'Support / Resistance' },
    { key: 'momentum', name: 'Momentum / RSI' },
    { key: 'liquidity', name: 'Liquidity Sweep' },
    { key: 'riskReward', name: 'Risk / Reward' },
    { key: 'volatility', name: 'Volatility / ATR' },
    { key: 'tradingSession', name: 'Trading Session' },
  ];

  return factorKeys.map(f => {
    const getScores = (list: BacktestTrade[]) =>
      list.map(t => {
        const factorObj = t.analysis?.factors?.find(fact => fact.factorKey === f.key);
        if (!factorObj) return 0;
        return factorObj.maxScore > 0 ? (factorObj.score / factorObj.maxScore) * 100 : factorObj.score;
      });

    const winScores = getScores(winTrades);
    const lossScores = getScores(lossTrades);

    const winMean = winScores.length > 0 ? winScores.reduce((a, b) => a + b, 0) / winScores.length : 0;
    const lossMean = lossScores.length > 0 ? lossScores.reduce((a, b) => a + b, 0) / lossScores.length : 0;

    return {
      factor: f.name,
      winMean: Number(winMean.toFixed(1)),
      lossMean: Number(lossMean.toFixed(1)),
      delta: Number((winMean - lossMean).toFixed(1)),
    };
  });
}

// Trend Maturity / Stage analysis using causal features available at entry:
function analyzeTrendMaturity(trades: BacktestTrade[], allCandles: any[]) {
  const closes = allCandles.map(c => c.close);
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, 200);
  const atrArr = calculateATR(allCandles, 14);

  const enriched = trades.map(t => {
    const idx = t.setupIndex;
    let barsInTrend = 0;
    const isBull = t.marketRegimeAtEntry === 'Bullish Trend' || t.marketRegimeAtEntry === 'BULLISH_TREND';
    
    // Look back causally to count trend duration
    for (let k = idx; k >= 0; k--) {
      const ema20 = ema20Arr[k];
      const ema50 = ema50Arr[k];
      const ema200 = ema200Arr[k];
      if (isBull) {
        if (ema20 > ema50 && ema50 > ema200) barsInTrend++;
        else break;
      } else {
        if (ema20 < ema50 && ema50 < ema200) barsInTrend++;
        else break;
      }
    }

    const atr = atrArr[idx] || 0.0015;
    const ema20 = ema20Arr[idx] || closes[idx];
    const ema50 = ema50Arr[idx] || closes[idx];
    const emaDistanceAtr = (closes[idx] - ema20) / atr;
    const emaStackWidthAtr = Math.abs(ema20 - ema50) / atr;

    let stage: 'EARLY_TREND' | 'MIDDLE_TREND' | 'LATE_MATURE_TREND' = 'MIDDLE_TREND';
    if (barsInTrend <= 15) stage = 'EARLY_TREND';
    else if (barsInTrend <= 60) stage = 'MIDDLE_TREND';
    else stage = 'LATE_MATURE_TREND';

    return {
      trade: t,
      barsInTrend,
      emaDistanceAtr,
      emaStackWidthAtr,
      stage,
      direction: t.direction,
      outcome: t.outcome,
      realizedR: t.realizedR,
    };
  });

  const early = enriched.filter(e => e.stage === 'EARLY_TREND').map(e => e.trade);
  const mid = enriched.filter(e => e.stage === 'MIDDLE_TREND').map(e => e.trade);
  const late = enriched.filter(e => e.stage === 'LATE_MATURE_TREND').map(e => e.trade);

  const winEnriched = enriched.filter(e => e.realizedR > 0.1 || e.outcome === 'WIN');
  const lossEnriched = enriched.filter(e => e.realizedR < -0.1 || e.outcome === 'LOSS');

  return {
    early: computeGroupMetrics('Early Trend (<= 15 bars)', early),
    mid: computeGroupMetrics('Middle Trend (16-60 bars)', mid),
    late: computeGroupMetrics('Late / Mature Trend (> 60 bars)', late),
    avgEmaDistWins: Number(
      (
        winEnriched.reduce((acc, e) => acc + e.emaDistanceAtr, 0) /
        (winEnriched.length || 1)
      ).toFixed(2)
    ),
    avgEmaDistLosses: Number(
      (
        lossEnriched.reduce((acc, e) => acc + e.emaDistanceAtr, 0) /
        (lossEnriched.length || 1)
      ).toFixed(2)
    ),
    avgBarsInTrendWins: Number(
      (
        winEnriched.reduce((acc, e) => acc + e.barsInTrend, 0) /
        (winEnriched.length || 1)
      ).toFixed(1)
    ),
    avgBarsInTrendLosses: Number(
      (
        lossEnriched.reduce((acc, e) => acc + e.barsInTrend, 0) /
        (lossEnriched.length || 1)
      ).toFixed(1)
    ),
    avgStackWidthWins: Number(
      (
        winEnriched.reduce((acc, e) => acc + e.emaStackWidthAtr, 0) /
        (winEnriched.length || 1)
      ).toFixed(2)
    ),
    avgStackWidthLosses: Number(
      (
        lossEnriched.reduce((acc, e) => acc + e.emaStackWidthAtr, 0) /
        (lossEnriched.length || 1)
      ).toFixed(2)
    ),
  };
}

async function main() {
  const rawCsv = fs.readFileSync('./eurusd_h1_raw.csv', 'utf-8');
  const { candles } = CandleDataValidator.parseAndValidate(rawCsv, {
    expectedTimeframe: 'H1',
    pairSymbol: 'EUR/USD',
  });

  // Run TRAIN
  const trainRun = BacktestEngine.runBacktest({
    pair: 'EUR/USD',
    timeframe: 'H1',
    candles,
    weights: DEFAULT_WEIGHTS,
    thresholds: DEFAULT_THRESHOLDS,
    splitType: 'TRAIN',
    trainPct: 60,
    valPct: 20,
    testPct: 20,
    saveDatasetForCalibration: false,
  });

  // Run VALIDATION
  const valRun = BacktestEngine.runBacktest({
    pair: 'EUR/USD',
    timeframe: 'H1',
    candles,
    weights: DEFAULT_WEIGHTS,
    thresholds: DEFAULT_THRESHOLDS,
    splitType: 'VALIDATION',
    trainPct: 60,
    valPct: 20,
    testPct: 20,
    saveDatasetForCalibration: false,
  });

  console.log('=== RESEARCH AUDIT: REGIME ASYMMETRY ===\n');

  function analyzePartition(name: string, trades: BacktestTrade[]) {
    console.log(`\n==================== ${name} (${trades.length} trades) ====================`);

    const isBull = (t: BacktestTrade) => t.marketRegimeAtEntry === 'Bullish Trend' || t.marketRegimeAtEntry === 'BULLISH_TREND';
    const isBear = (t: BacktestTrade) => t.marketRegimeAtEntry === 'Bearish Trend' || t.marketRegimeAtEntry === 'BEARISH_TREND';
    const isRange = (t: BacktestTrade) => t.marketRegimeAtEntry === 'Range / Consolidation' || t.marketRegimeAtEntry === 'RANGE_CONSOLIDATION';

    const bullTrades = trades.filter(isBull);
    const bearTrades = trades.filter(isBear);
    const rangeTrades = trades.filter(isRange);

    const longInBull = bullTrades.filter(t => t.direction === 'BUY');
    const shortInBull = bullTrades.filter(t => t.direction === 'SELL');

    const longInBear = bearTrades.filter(t => t.direction === 'BUY');
    const shortInBear = bearTrades.filter(t => t.direction === 'SELL');

    const longInRange = rangeTrades.filter(t => t.direction === 'BUY');
    const shortInRange = rangeTrades.filter(t => t.direction === 'SELL');

    const matrix = [
      computeGroupMetrics('1. Long in Bullish Trend (Trend-Following)', longInBull),
      computeGroupMetrics('2. Short in Bullish Trend (Counter-Trend)', shortInBull),
      computeGroupMetrics('3. Long in Bearish Trend (Counter-Trend)', longInBear),
      computeGroupMetrics('4. Short in Bearish Trend (Trend-Following)', shortInBear),
      computeGroupMetrics('5. Long in Range / Consolidation', longInRange),
      computeGroupMetrics('6. Short in Range / Consolidation', shortInRange),
    ];

    console.log('--- 6 Directional Regime Subgroups ---');
    console.table(
      matrix.map(m => ({
        Subgroup: m.name,
        Trades: m.tradesCount,
        WinRate: m.winRate + '%',
        NetR: m.netR,
        Expectancy: m.expectancy,
        PF: m.profitFactor,
        AvgWin: m.avgWin,
        AvgLoss: m.avgLoss,
        AvgHolding: m.avgHolding,
        MaxDD: m.maxDrawdownR,
        MaxConsecLoss: m.maxConsecutiveLosses,
      }))
    );

    // Bullish Trend Factor Comparison (Wins vs Losses)
    console.log('\n--- Bullish Trend Factor Scores: Wins vs Losses ---');
    const bullFactorStats = analyzeFactorsByOutcome(bullTrades);
    console.table(bullFactorStats);

    // Bullish Trend Timing & Maturity Analysis
    console.log('\n--- Bullish Trend Entry Timing / Maturity Analysis ---');
    const bullMaturity = analyzeTrendMaturity(bullTrades, candles);
    console.table([bullMaturity.early, bullMaturity.mid, bullMaturity.late]);
    console.log(`EMA Distance (ATR multiples): Wins = ${bullMaturity.avgEmaDistWins} ATR, Losses = ${bullMaturity.avgEmaDistLosses} ATR`);
    console.log(`Bars in Trend: Wins = ${bullMaturity.avgBarsInTrendWins} bars, Losses = ${bullMaturity.avgBarsInTrendLosses} bars`);
    console.log(`EMA Stack Width: Wins = ${bullMaturity.avgStackWidthWins} ATR, Losses = ${bullMaturity.avgStackWidthLosses} ATR`);

    // Also analyze Long vs Short within Bullish Trend Maturity
    const longBullMaturity = analyzeTrendMaturity(longInBull, candles);
    const shortBullMaturity = analyzeTrendMaturity(shortInBull, candles);

    return {
      matrix,
      bullFactorStats,
      bullMaturity,
      longBullMaturity,
      shortBullMaturity,
    };
  }

  const trainAnalysis = analyzePartition('TRAIN PARTITION', trainRun.trades);
  const valAnalysis = analyzePartition('VALIDATION PARTITION', valRun.trades);

  fs.writeFileSync(
    './regime_asymmetry_audit_output.json',
    JSON.stringify({ trainAnalysis, valAnalysis }, null, 2)
  );
  console.log('\nAudit complete. JSON saved to regime_asymmetry_audit_output.json');
}

main().catch(console.error);
