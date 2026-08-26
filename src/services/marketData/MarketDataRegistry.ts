import {
  Candle,
  CandleValidationReport,
  DatasetKind,
  MarketDataAdapter,
  MarketDataResult,
  Timeframe,
} from '../../types/market';
import { generateHistoricalSeries } from './historicalDataGenerator';
import { CandleDataValidator } from './CandleDataValidator';

export class HistoricalDatasetProvider implements MarketDataAdapter {
  id = 'historical_curated';
  name = 'Synthetic Benchmark Dataset (Dev/Test)';
  datasetKind: DatasetKind = 'SYNTHETIC_BENCHMARK';
  description =
    'Deterministic multi-regime synthetic price series for indicator calibration and test workflows. Not real market data; no live predictive edge claimed.';

  private pairs = [
    'EUR/USD',
    'GBP/USD',
    'USD/JPY',
    'AUD/USD',
    'USD/CAD',
    'USD/CHF',
    'NZD/USD',
    'EUR/JPY',
    'GBP/JPY',
    'XAU/USD',
  ];

  private timeframes: Timeframe[] = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
  private cache: Map<string, Candle[]> = new Map();

  getAvailablePairs(): string[] {
    return this.pairs;
  }

  getAvailableTimeframes(): string[] {
    return this.timeframes;
  }

  async getCandles(pair: string, timeframe: string, limit = 250): Promise<MarketDataResult> {
    const formattedPair = pair.replace('/', '').toUpperCase();
    const standardPair = this.pairs.find(
      p => p === pair || p.replace('/', '') === formattedPair
    );

    if (!standardPair) {
      return {
        data: [],
        status: 'DATA_UNAVAILABLE',
        source: this.name,
        datasetKind: this.datasetKind,
        pair,
        timeframe,
        message: `No synthetic benchmark series found for pair ${pair}. Switch provider or import real custom broker CSV candles.`,
      };
    }

    const key = `${standardPair}_${timeframe}`;
    if (!this.cache.has(key)) {
      const candles = generateHistoricalSeries(standardPair, timeframe as Timeframe, Math.max(limit, 350));
      this.cache.set(key, candles);
    }

    const allCandles = this.cache.get(key) || [];
    const sliced = allCandles.slice(-limit);

    return {
      data: sliced,
      status: 'AVAILABLE',
      source: `${this.name} (${sliced.length} bars)`,
      datasetKind: this.datasetKind,
      pair: standardPair,
      timeframe,
      lastUpdated: sliced[sliced.length - 1]?.timestamp,
    };
  }
}

export class CustomImportProvider implements MarketDataAdapter {
  id = 'custom_import';
  name = 'Real Historical CSV / Broker Import';
  datasetKind: DatasetKind = 'REAL_HISTORICAL_IMPORT';
  description =
    'Real historical candle records imported from MT4, MT5, cTrader, or TradingView, validated with strict integrity checks.';

  private storage: Map<string, Candle[]> = new Map();
  private reports: Map<string, CandleValidationReport> = new Map();

  getAvailablePairs(): string[] {
    const pairs = new Set<string>();
    for (const key of this.storage.keys()) {
      const [pair] = key.split('__');
      pairs.add(pair);
    }
    return Array.from(pairs);
  }

  getAvailableTimeframes(): string[] {
    const tfs = new Set<string>();
    for (const key of this.storage.keys()) {
      const [, tf] = key.split('__');
      tfs.add(tf);
    }
    return Array.from(tfs);
  }

  importCustomData(pair: string, timeframe: string, candles: Candle[], report?: CandleValidationReport): void {
    const key = `${pair.toUpperCase()}__${timeframe.toUpperCase()}`;
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    this.storage.set(key, sorted);
    if (report) {
      this.reports.set(key, report);
    }
  }

  getValidationReport(pair: string, timeframe: string): CandleValidationReport | undefined {
    const key = `${pair.toUpperCase()}__${timeframe.toUpperCase()}`;
    return this.reports.get(key);
  }

  getAllCandles(pair: string, timeframe: string): Candle[] {
    const key = `${pair.toUpperCase()}__${timeframe.toUpperCase()}`;
    return this.storage.get(key) || [];
  }

  async getCandles(pair: string, timeframe: string, limit?: number): Promise<MarketDataResult> {
    const key = `${pair.toUpperCase()}__${timeframe.toUpperCase()}`;
    const candles = this.storage.get(key);
    const report = this.reports.get(key);

    if (!candles || candles.length === 0) {
      return {
        data: [],
        status: 'DATA_UNAVAILABLE',
        source: this.name,
        datasetKind: this.datasetKind,
        pair,
        timeframe,
        message: `No imported historical candle data for ${pair} on ${timeframe}. Please import a CSV or JSON file in the Market Data tab.`,
        validationReport: report,
      };
    }

    const sliced = limit && limit > 0 ? candles.slice(-limit) : candles;
    return {
      data: sliced,
      status: 'AVAILABLE',
      source: `${this.name} (${candles.length} total bars validated)`,
      datasetKind: this.datasetKind,
      pair,
      timeframe,
      lastUpdated: candles[candles.length - 1]?.timestamp,
      validationReport: report,
    };
  }
}

export class FreePublicApiProvider implements MarketDataAdapter {
  id = 'free_public_api';
  name = 'Public Market Feed (Rate-Limited)';
  datasetKind: DatasetKind = 'PUBLIC_API_FEED';
  description = 'Direct rate-limited market feed. Returns transparent DATA_UNAVAILABLE when endpoint is offline.';

  getAvailablePairs(): string[] {
    return ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF'];
  }

  getAvailableTimeframes(): string[] {
    return ['D1', 'H4', 'H1'];
  }

  async getCandles(pair: string, timeframe: string): Promise<MarketDataResult> {
    return {
      data: [],
      status: 'DATA_UNAVAILABLE',
      source: this.name,
      datasetKind: this.datasetKind,
      pair,
      timeframe,
      message: 'Live market API endpoint is currently offline. Use Real Historical CSV Import or Synthetic Benchmark for zero-lookahead backtesting.',
    };
  }
}

export class MarketDataRegistry {
  private static instance: MarketDataRegistry;
  private providers: Map<string, MarketDataAdapter> = new Map();
  private activeProviderId = 'historical_curated';

  private constructor() {
    this.registerProvider(new HistoricalDatasetProvider());
    this.registerProvider(new CustomImportProvider());
    this.registerProvider(new FreePublicApiProvider());
  }

  public static getInstance(): MarketDataRegistry {
    if (!MarketDataRegistry.instance) {
      MarketDataRegistry.instance = new MarketDataRegistry();
    }
    return MarketDataRegistry.instance;
  }

  public registerProvider(provider: MarketDataAdapter): void {
    this.providers.set(provider.id, provider);
  }

  public getProviders(): MarketDataAdapter[] {
    return Array.from(this.providers.values());
  }

  public getActiveProvider(): MarketDataAdapter {
    return this.providers.get(this.activeProviderId) || this.providers.get('historical_curated')!;
  }

  public setActiveProvider(id: string): void {
    if (this.providers.has(id)) {
      this.activeProviderId = id;
    }
  }

  public async fetchCandles(pair: string, timeframe: string, limit = 250): Promise<MarketDataResult> {
    const provider = this.getActiveProvider();
    return provider.getCandles(pair, timeframe, limit);
  }
}
