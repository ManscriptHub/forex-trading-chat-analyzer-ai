export interface Candle {
  timestamp: number; // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  datetime?: string; // ISO or readable string
  rawOhlc?: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
}

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export type PairType =
  | 'EUR/USD'
  | 'GBP/USD'
  | 'USD/JPY'
  | 'AUD/USD'
  | 'USD/CAD'
  | 'USD/CHF'
  | 'NZD/USD'
  | 'EUR/GBP'
  | 'EUR/JPY'
  | 'GBP/JPY'
  | 'XAU/USD'
  | string;

export type DatasetKind = 'SYNTHETIC_BENCHMARK' | 'REAL_HISTORICAL_IMPORT' | 'PUBLIC_API_FEED';

export interface CandleGapRecord {
  fromIndex: number;
  toIndex: number;
  fromDate: string;
  toDate: string;
  gapMinutes: number;
  isWeekend: boolean;
}

export interface RejectedCandleRecord {
  lineNum: number;
  rawText?: string;
  reason: string;
  ohlc?: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
  };
}

export interface PriceScaleInfo {
  scaleFactor: number; // e.g. 100000, 1000, 100, 1
  detectedScaleType: '5_DIGIT_POINTS' | '3_DIGIT_JPY_POINTS' | '2_DIGIT_CENTS_POINTS' | 'STANDARD_DECIMAL' | 'CUSTOM_SCALE';
  detectionReason: string;
  rawSamplePrice: number;
  normalizedSamplePrice: number;
  rawPriceRange: { min: number; max: number };
  normalizedPriceRange: { min: number; max: number };
  wasScaleApplied: boolean;
}

export interface CandleValidationReport {
  isValid: boolean;
  sourceFormat: 'MetaTrader 4/5' | 'cTrader' | 'TradingView' | 'Generic CSV' | 'JSON Array' | 'Unknown';
  totalRowsParsed: number;
  validCandlesCount: number;
  rejectedRowsCount: number;
  duplicateTimestampsFixed: number;
  chronologicalInversionsFixed: number;
  impossibleOhlcCount: number;
  detectedGapsCount: number;
  detectedGaps: CandleGapRecord[];
  rejectedRowsDetails?: RejectedCandleRecord[];
  priceScaleInfo?: PriceScaleInfo;
  rawPriceRange?: { min: number; max: number };
  normalizedPriceRange?: { min: number; max: number };
  startTime?: string;
  endTime?: string;
  timeframeDetected?: string;
  warnings: string[];
  errors: string[];
}

export interface MarketDataResult {
  data: Candle[];
  status: 'AVAILABLE' | 'DATA_UNAVAILABLE';
  source: string;
  datasetKind?: DatasetKind;
  pair: string;
  timeframe: string;
  message?: string;
  lastUpdated?: number;
  validationReport?: CandleValidationReport;
}

export interface MarketDataAdapter {
  id: string;
  name: string;
  datasetKind: DatasetKind;
  description: string;
  getAvailablePairs(): string[];
  getAvailableTimeframes(): string[];
  getCandles(pair: string, timeframe: string, limit?: number): Promise<MarketDataResult>;
  importCustomData?(pair: string, timeframe: string, candles: Candle[], report?: CandleValidationReport): void;
  getValidationReport?(pair: string, timeframe: string): CandleValidationReport | undefined;
}
