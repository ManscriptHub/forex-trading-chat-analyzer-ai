export interface Candle {
  timestamp: number; // Unix timestamp in milliseconds or seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  datetime?: string; // ISO or readable string
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

export interface MarketDataResult {
  data: Candle[];
  status: 'AVAILABLE' | 'DATA_UNAVAILABLE';
  source: string;
  pair: string;
  timeframe: string;
  message?: string;
  lastUpdated?: number;
}

export interface MarketDataAdapter {
  id: string;
  name: string;
  description: string;
  getAvailablePairs(): string[];
  getAvailableTimeframes(): string[];
  getCandles(pair: string, timeframe: string, limit?: number): Promise<MarketDataResult>;
  importCustomData?(pair: string, timeframe: string, candles: Candle[]): void;
}
