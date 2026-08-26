import * as fs from 'fs';
import { CandleDataValidator } from './src/services/marketData/CandleDataValidator';
import { BacktestEngine } from './src/services/backtest/BacktestEngine';
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from './src/services/analyzer/SetupAnalyzerEngine';

async function main() {
  console.log('--- Loading and Validating EUR/USD H1 Dataset ---');
  const rawCsv = fs.readFileSync('./eurusd_h1_raw.csv', 'utf-8');
  const { candles, report } = CandleDataValidator.parseAndValidate(rawCsv, {
    expectedTimeframe: 'H1',
    pairSymbol: 'EUR/USD',
  });

  console.log(`Validation Status: ${report.isValid ? 'PASSED' : 'FAILED'}`);
  console.log(`Total Candles: ${candles.length}`);
  console.log(`Scale Applied: 1/${report.priceScaleInfo?.scaleFactor}`);

  const partitions = ['TRAIN', 'VALIDATION', 'TEST', 'ALL'] as const;
  const results: Record<string, any> = {};

  for (const part of partitions) {
    console.log(`\n=== Running Baseline Backtest on Partition: ${part} ===`);
    const res = BacktestEngine.runBacktest({
      pair: 'EUR/USD',
      timeframe: 'H1',
      candles,
      weights: DEFAULT_WEIGHTS,
      thresholds: DEFAULT_THRESHOLDS,
      splitType: part,
      trainPct: 60,
      valPct: 20,
      testPct: 20,
      saveDatasetForCalibration: false,
    });
    results[part] = res;
  }

  // Print summary JSON
  fs.writeFileSync('./baseline_backtest_output.json', JSON.stringify({
    reportSummary: {
      totalCandles: candles.length,
      validationReport: report,
      partitions: Object.fromEntries(
        Object.entries(results).map(([k, v]) => [
          k,
          {
            splitRange: v.splitRange,
            stats: v.stats,
            costModel: v.costModel,
          }
        ])
      )
    }
  }, null, 2));

  console.log('\nBaseline Backtest Execution Complete. Output written to baseline_backtest_output.json');
}

main().catch(err => {
  console.error('Error during baseline run:', err);
});
