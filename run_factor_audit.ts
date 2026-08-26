import * as fs from 'fs';
import { CandleDataValidator } from './src/services/marketData/CandleDataValidator';
import { FactorAuditEngine } from './src/services/analyzer/FactorAuditEngine';
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
  console.log('--- Running Factor Predictive Audit on TRAIN Partition (Discovery) ---');

  const auditReport = FactorAuditEngine.auditReplayDataset(
    candles,
    'TRAIN',
    DEFAULT_WEIGHTS,
    DEFAULT_THRESHOLDS
  );

  console.log('--- Factor Audit Completed ---');
  fs.writeFileSync('./factor_audit_output.json', JSON.stringify(auditReport, null, 2));
  console.log('Report written to factor_audit_output.json');
}

main().catch(err => {
  console.error('Error executing factor audit:', err);
  process.exit(1);
});
