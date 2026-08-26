import React, { useState } from 'react';
import { MarketDataAdapter, MarketDataResult, Candle, CandleValidationReport } from '../types/market';
import { MarketDataRegistry } from '../services/marketData/MarketDataRegistry';
import { CandleDataValidator } from '../services/marketData/CandleDataValidator';
import {
  Database,
  Upload,
  Check,
  AlertTriangle,
  FileText,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Clock,
  ArrowUpDown,
  Zap,
  Globe,
  Sliders,
  Scale,
  Calendar,
  Layers,
  Search,
} from 'lucide-react';

interface MarketDataViewProps {
  currentProvider: MarketDataAdapter;
  onProviderChange: (providerId: string) => void;
  activePair: string;
  activeTimeframe: string;
  currentDataResult: MarketDataResult | null;
  onDataRefresh: () => void;
}

export const MarketDataView: React.FC<MarketDataViewProps> = ({
  currentProvider,
  onProviderChange,
  activePair,
  activeTimeframe,
  currentDataResult,
  onDataRefresh,
}) => {
  const registry = MarketDataRegistry.getInstance();
  const providers = registry.getProviders();

  const [importText, setImportText] = useState('');
  const [importPair, setImportPair] = useState(activePair || 'EUR/USD');
  const [importTf, setImportTf] = useState(activeTimeframe || 'H1');
  const [remoteUrl, setRemoteUrl] = useState(
    'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDh1.csv'
  );
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [remoteFetchError, setRemoteFetchError] = useState<string | null>(null);

  // Price Scaling Configuration (0 = Auto-Detect)
  const [selectedScaleDivisor, setSelectedScaleDivisor] = useState<number>(0);

  const [validationReport, setValidationReport] = useState<CandleValidationReport | null>(null);
  const [parsedPreviewCandles, setParsedPreviewCandles] = useState<Candle[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const sampleTemplates: Record<string, string> = {
    'ejtraderLabs Sample': `Date,open,high,low,close,tick_volume
2012-11-16 00:00:00,127801.0,127835.0,127777.0,127810.0,869
2012-11-16 01:00:00,127809.0,127837.0,127686.0,127736.0,1408
2012-11-16 02:00:00,127738.0,127769.0,127706.0,127734.0,1285
2012-11-16 03:00:00,127738.0,127762.0,127673.0,127695.0,1210`,
    'Standard Decimal CSV': `Date,Open,High,Low,Close,Volume
2026-01-05 08:00:00,1.08520,1.08740,1.08410,1.08680,1520
2026-01-05 09:00:00,1.08680,1.08910,1.08630,1.08850,1840
2026-01-05 10:00:00,1.08850,1.09120,1.08800,1.09050,2100`,
    'MT4/MT5 Tab Delimited': `<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>
2026.01.05\t08:00\t1.08520\t1.08740\t1.08410\t1.08680\t1520\t0\t10
2026.01.05\t09:00\t1.08680\t1.08910\t1.08630\t1.08850\t1840\t0\t10`,
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      setImportText(content);
      executeValidation(content, importTf, importPair, selectedScaleDivisor);
    };
    reader.readAsText(file);
  };

  const handleFetchRemoteUrl = async (urlToFetch = remoteUrl) => {
    if (!urlToFetch.trim()) return;
    setIsLoadingRemote(true);
    setRemoteFetchError(null);
    setImportStatus('Fetching historical dataset from remote repository...');

    try {
      const response = await fetch(urlToFetch);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      setImportText(text);
      setImportPair('EUR/USD');
      setImportTf('H1');
      executeValidation(text, 'H1', 'EUR/USD', selectedScaleDivisor);
      setImportStatus(`Successfully fetched ${Math.round(text.length / 1024)} KB from GitHub repository.`);
    } catch (err: any) {
      console.error('Fetch error:', err);
      setRemoteFetchError(`Failed to fetch dataset: ${err.message}. If CORS prevents direct browser download, paste CSV content or upload file directly.`);
      setImportStatus(null);
    } finally {
      setIsLoadingRemote(false);
    }
  };

  const executeValidation = (
    text: string,
    tf: string,
    pair: string,
    explicitDivisor = selectedScaleDivisor
  ) => {
    if (!text.trim()) {
      setValidationReport(null);
      setParsedPreviewCandles([]);
      setImportStatus(null);
      return;
    }

    const { candles, report } = CandleDataValidator.parseAndValidate(text, {
      expectedTimeframe: tf,
      pairSymbol: pair,
      explicitScaleFactor: explicitDivisor > 0 ? explicitDivisor : undefined,
    });

    setValidationReport(report);
    setParsedPreviewCandles(candles);

    if (report.isValid) {
      const scaleStr = report.priceScaleInfo?.wasScaleApplied
        ? ` | Scale 1/${report.priceScaleInfo.scaleFactor}`
        : '';
      setImportStatus(
        `Validation Passed: ${candles.length.toLocaleString()} clean chronological candles (${report.sourceFormat}${scaleStr}).`
      );
    } else {
      setImportStatus(`Validation Alert: ${report.errors.join(' ')}`);
    }
  };

  const handleSaveToStore = () => {
    if (!validationReport || !validationReport.isValid || parsedPreviewCandles.length === 0) {
      executeValidation(importText, importTf, importPair, selectedScaleDivisor);
      return;
    }

    const customProvider = providers.find(p => p.id === 'custom_import');
    if (customProvider && (customProvider as any).importCustomData) {
      (customProvider as any).importCustomData(
        importPair,
        importTf,
        parsedPreviewCandles,
        validationReport
      );
      registry.setActiveProvider('custom_import');
      onProviderChange('custom_import');
      setImportStatus(
        `Successfully saved ${parsedPreviewCandles.length.toLocaleString()} validated real candles for ${importPair} (${importTf}).`
      );
      onDataRefresh();
    }
  };

  const activeValidationReport = currentDataResult?.validationReport;

  return (
    <div id="market_data_main_view" className="space-y-6 pb-20 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center space-x-2">
            <Database className="w-5 h-5 text-blue-400" />
            <span>Market Data Ingestion, Normalization & Integrity Validator</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Ingest real broker historical datasets, deterministically detect price scaling, preserve raw records, and validate zero-alteration OHLC integrity.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onDataRefresh}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold flex items-center space-x-1.5 border border-zinc-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload Active Feed</span>
          </button>
        </div>
      </div>

      {/* Active Provider Cards */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
          Registered Market Data Providers
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {providers.map(provider => {
            const isActive = currentProvider.id === provider.id;
            const isSynthetic = provider.datasetKind === 'SYNTHETIC_BENCHMARK';
            const isRealImport = provider.datasetKind === 'REAL_HISTORICAL_IMPORT';

            return (
              <div
                key={provider.id}
                onClick={() => {
                  registry.setActiveProvider(provider.id);
                  onProviderChange(provider.id);
                  onDataRefresh();
                }}
                className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                  isActive
                    ? 'bg-blue-950/40 border-blue-500/60 shadow-lg shadow-blue-950/40'
                    : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-zinc-100">{provider.name}</span>
                  {isActive ? (
                    <span className="px-2 py-0.5 rounded bg-blue-500 text-white text-[10px] font-bold font-mono">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-500 uppercase font-mono">Select</span>
                  )}
                </div>

                <div className="mb-2">
                  {isSynthetic && (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-amber-950/40 border border-amber-800/60 rounded text-[10px] font-mono text-amber-300">
                      <AlertCircle className="w-3 h-3" />
                      <span>Synthetic Dev/Test Only</span>
                    </span>
                  )}
                  {isRealImport && (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-emerald-950/40 border border-emerald-800/60 rounded text-[10px] font-mono text-emerald-300">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Real Historical Records</span>
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {provider.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current Data Feed Diagnostics & Validation Status */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
          <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
            Active Feed Integrity & Price Scale State
          </h3>
          <span className="text-[10px] font-mono text-zinc-400">
            Source: <strong className="text-zinc-200">{currentProvider.name}</strong>
          </span>
        </div>

        {currentDataResult ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">Feed Status</span>
                <span
                  className={`font-black ${
                    currentDataResult.status === 'AVAILABLE' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {currentDataResult.status}
                </span>
              </div>
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">Selected Pair</span>
                <span className="text-zinc-200 font-bold">{currentDataResult.pair}</span>
              </div>
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">Timeframe</span>
                <span className="text-zinc-200 font-bold">{currentDataResult.timeframe}</span>
              </div>
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">Candles Loaded</span>
                <span className="text-blue-400 font-bold">{currentDataResult.data.length.toLocaleString()} bars</span>
              </div>
            </div>

            {/* Synthetic Disclaimer Banner if active */}
            {currentProvider.datasetKind === 'SYNTHETIC_BENCHMARK' && (
              <div className="bg-amber-950/20 border border-amber-900/50 rounded-xl p-3.5 text-xs text-amber-300 flex items-start space-x-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold">Synthetic Dev/Test Dataset Active</strong>
                  <p className="text-[11px] text-amber-400/90 leading-relaxed mt-0.5">
                    This active series is algorithmically synthesized for deterministic workflow testing and UI development. It does not represent actual market liquidity. Switch to Real Historical CSV / Broker Import to backtest on real datasets.
                  </p>
                </div>
              </div>
            )}

            {/* Active Real Import Audit Report */}
            {activeValidationReport && (
              <div className="bg-zinc-950 border border-emerald-900/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-xs text-emerald-400 font-bold">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Real Broker Dataset Audit Report ({activeValidationReport.sourceFormat})</span>
                  </div>
                  {activeValidationReport.priceScaleInfo && (
                    <span className="px-2 py-0.5 bg-blue-950/60 border border-blue-800/60 rounded text-[10px] font-mono text-blue-300">
                      Scale: 1/{activeValidationReport.priceScaleInfo.scaleFactor.toLocaleString()} ({activeValidationReport.priceScaleInfo.detectedScaleType})
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-zinc-400 pt-1">
                  <div>Valid Bars: <strong className="text-zinc-100">{activeValidationReport.validCandlesCount.toLocaleString()}</strong></div>
                  <div>Duplicates: <strong className="text-zinc-100">{activeValidationReport.duplicateTimestampsFixed}</strong></div>
                  <div>Gaps: <strong className="text-zinc-100">{activeValidationReport.detectedGapsCount}</strong></div>
                  <div>Rejected: <strong className="text-zinc-100">{activeValidationReport.rejectedRowsCount}</strong></div>
                </div>

                {activeValidationReport.priceScaleInfo && (
                  <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800 text-[10px] font-mono text-zinc-300 space-y-1">
                    <div>
                      <strong className="text-zinc-400">Scale Normalization:</strong> {activeValidationReport.priceScaleInfo.detectionReason}
                    </div>
                    <div className="flex flex-wrap gap-4 text-zinc-400">
                      <span>Raw Range: [{activeValidationReport.rawPriceRange?.min.toFixed(1)} - {activeValidationReport.rawPriceRange?.max.toFixed(1)}]</span>
                      <span className="text-emerald-400">Normalized Range: [{activeValidationReport.normalizedPriceRange?.min.toFixed(5)} - {activeValidationReport.normalizedPriceRange?.max.toFixed(5)}]</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">Loading diagnostics...</div>
        )}
      </div>

      {/* GitHub / Remote Dataset Direct Ingestion */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider flex items-center space-x-2">
              <Globe className="w-4 h-4 text-blue-400" />
              <span>Public Historical Dataset Fetcher (GitHub / Remote)</span>
            </h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Directly download and audit public repository datasets (e.g. ejtraderLabs 10-year EURUSD H1 historical data).
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleFetchRemoteUrl('https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDh1.csv')}
            disabled={isLoadingRemote}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-sm"
          >
            {isLoadingRemote ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            <span>Fetch ejtraderLabs EURUSD H1</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={remoteUrl}
            onChange={e => setRemoteUrl(e.target.value)}
            placeholder="https://raw.githubusercontent.com/..."
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => handleFetchRemoteUrl()}
            disabled={isLoadingRemote || !remoteUrl.trim()}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-bold transition-colors"
          >
            {isLoadingRemote ? 'Downloading...' : 'Fetch URL'}
          </button>
        </div>

        {remoteFetchError && (
          <div className="bg-rose-950/30 border border-rose-800/40 rounded-xl p-3 text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{remoteFetchError}</span>
          </div>
        )}
      </div>

      {/* Real Historical CSV / JSON Importer & Validator */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div>
          <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
            Dataset Normalization & Zero-Alteration Integrity Validator
          </h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Parses raw broker history, detects point/integer price scales, preserves original untouched values in <code className="text-zinc-300">rawOhlc</code>, and verifies geometric invariants without silent mutations.
          </p>
        </div>

        {/* Price Scaling & Template Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* Format Template Quick Selectors */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-zinc-400 font-medium block">Load Quick Sample:</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(sampleTemplates).map(([label, text]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setImportText(text);
                    executeValidation(text, importTf, importPair, selectedScaleDivisor);
                  }}
                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[10px] font-mono border border-zinc-700 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Explicit Price Scale Selector */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-zinc-400 font-medium flex items-center space-x-1">
              <Scale className="w-3 h-3 text-blue-400" />
              <span>Price Scale Normalization Mode:</span>
            </span>
            <select
              value={selectedScaleDivisor}
              onChange={e => {
                const divisor = Number(e.target.value);
                setSelectedScaleDivisor(divisor);
                if (importText) {
                  executeValidation(importText, importTf, importPair, divisor);
                }
              }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-zinc-200 font-mono focus:border-blue-500 focus:outline-none"
            >
              <option value={0}>Auto-Detect Scale (Recommended - Verifies Integer vs Decimal)</option>
              <option value={100000}>Divide by 100,000 (5-Digit Points, e.g. 127801.0 → 1.27801)</option>
              <option value={1000}>Divide by 1,000 (3-Digit JPY Points, e.g. 135240.0 → 135.240)</option>
              <option value={100}>Divide by 100 (2-Digit Cents / Points)</option>
              <option value={1}>Standard Decimal 1.0 (No Scaling, e.g. 1.27801)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
              Target Currency Pair
            </label>
            <input
              type="text"
              value={importPair}
              onChange={e => {
                const p = e.target.value.toUpperCase();
                setImportPair(p);
                if (importText) executeValidation(importText, importTf, p, selectedScaleDivisor);
              }}
              placeholder="e.g. EUR/USD"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
              Bar Timeframe
            </label>
            <input
              type="text"
              value={importTf}
              onChange={e => {
                const tf = e.target.value.toUpperCase();
                setImportTf(tf);
                if (importText) executeValidation(importText, tf, importPair, selectedScaleDivisor);
              }}
              placeholder="e.g. H1, M15, D1"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-zinc-400">
            Raw CSV or JSON Text Data ({importText ? `${Math.round(importText.length / 1024)} KB` : 'Empty'}):
          </label>
          <textarea
            value={importText}
            onChange={e => {
              setImportText(e.target.value);
              executeValidation(e.target.value, importTf, importPair, selectedScaleDivisor);
            }}
            placeholder="Paste CSV rows (e.g. Date, open, high, low, close, tick_volume) or JSON array..."
            rows={6}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <label className="cursor-pointer px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold flex items-center space-x-1.5 border border-zinc-700 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>Select Local File (CSV/JSON/TXT)</span>
              <input type="file" accept=".csv,.json,.txt,.tsv" onChange={handleFileUpload} className="hidden" />
            </label>

            <button
              type="button"
              onClick={handleSaveToStore}
              disabled={!validationReport || !validationReport.isValid}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors flex items-center space-x-1.5 shadow-md"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Register & Save Validated Dataset</span>
            </button>
          </div>

          {/* Validation & Normalization Report Card */}
          {validationReport && (
            <div
              className={`p-4 rounded-xl border space-y-3.5 font-mono text-xs ${
                validationReport.isValid
                  ? 'bg-zinc-950/90 border-blue-900/60'
                  : 'bg-rose-950/30 border-rose-800/60'
              }`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <span className="font-bold flex items-center space-x-1.5 text-zinc-200">
                  {validationReport.isValid ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                  )}
                  <span>Format Detected: {validationReport.sourceFormat}</span>
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                    validationReport.isValid
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {validationReport.isValid ? 'INTEGRITY VERIFIED' : 'VALIDATION FAILED'}
                </span>
              </div>

              {/* Price Scale Normalization Audit Box */}
              {validationReport.priceScaleInfo && (
                <div className="bg-zinc-900/90 border border-blue-900/40 rounded-xl p-3 space-y-2 text-[11px]">
                  <div className="flex items-center justify-between text-blue-300 font-bold">
                    <span className="flex items-center space-x-1.5">
                      <Scale className="w-3.5 h-3.5 text-blue-400" />
                      <span>Price Scaling Transformation Audit</span>
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-blue-950 rounded border border-blue-800 text-blue-200">
                      Scale Divisor: {validationReport.priceScaleInfo.scaleFactor.toLocaleString()} ({validationReport.priceScaleInfo.detectedScaleType})
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-300 leading-relaxed">
                    {validationReport.priceScaleInfo.detectionReason}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-zinc-800 text-[10px]">
                    <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
                      <span className="text-zinc-500 block">Raw Imported Price Range:</span>
                      <strong className="text-zinc-200 font-mono">
                        {validationReport.rawPriceRange?.min.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} – {validationReport.rawPriceRange?.max.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                    <div className="bg-zinc-950 p-2 rounded border border-emerald-950">
                      <span className="text-zinc-500 block">Normalized Decimal Price Range:</span>
                      <strong className="text-emerald-400 font-mono">
                        {validationReport.normalizedPriceRange?.min.toFixed(5)} – {validationReport.normalizedPriceRange?.max.toFixed(5)}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Data Ingestion Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-zinc-400">
                <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">Total Rows:</span>
                  <strong className="text-zinc-200">{validationReport.totalRowsParsed.toLocaleString()}</strong>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">Valid Candles:</span>
                  <strong className="text-emerald-400">{validationReport.validCandlesCount.toLocaleString()}</strong>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">Rejected Rows:</span>
                  <strong className="text-zinc-200">{validationReport.rejectedRowsCount}</strong>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">Duplicates Fixed:</span>
                  <strong className="text-zinc-200">{validationReport.duplicateTimestampsFixed}</strong>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">Inversions Fixed:</span>
                  <strong className="text-zinc-200">{validationReport.chronologicalInversionsFixed}</strong>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">Impossible OHLC:</span>
                  <strong className="text-zinc-200">{validationReport.impossibleOhlcCount}</strong>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">Gaps Detected:</span>
                  <strong className="text-zinc-200">{validationReport.detectedGapsCount}</strong>
                </div>
                <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 text-[10px] block">Date Span:</span>
                  <strong className="text-zinc-200 text-[10px]">
                    {validationReport.startTime ? validationReport.startTime.slice(0, 10) : ''} to {validationReport.endTime ? validationReport.endTime.slice(0, 10) : ''}
                  </strong>
                </div>
              </div>

              {/* Sanity Notice */}
              <div className="bg-blue-950/20 border border-blue-900/40 rounded-xl p-3 text-[11px] text-blue-300 flex items-start space-x-2">
                <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold block">Integrity Contract Enforced:</strong>
                  <p className="text-[10px] text-blue-200/90 leading-relaxed mt-0.5">
                    Original raw prices are preserved untouched in <code className="text-blue-100">rawOhlc</code>. No synthetic prices were fabricated, and no lookahead interpolation was introduced.
                  </p>
                </div>
              </div>

              {validationReport.warnings.length > 0 && (
                <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-2.5 text-[10px] text-amber-300 space-y-1">
                  <div className="font-bold">Sanitization Notices:</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {validationReport.warnings.slice(0, 5).map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validationReport.errors.length > 0 && (
                <div className="bg-rose-950/30 border border-rose-900/40 rounded-lg p-2.5 text-[10px] text-rose-300 space-y-1">
                  <div className="font-bold">Blocking Validation Errors:</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {validationReport.errors.map((e, idx) => (
                      <li key={idx}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Rejected Records Audit List */}
              {validationReport.rejectedRowsDetails && validationReport.rejectedRowsDetails.length > 0 && (
                <div className="bg-rose-950/20 border border-rose-900/40 rounded-lg p-3 text-[11px] space-y-2">
                  <div className="flex items-center justify-between text-rose-300 font-bold">
                    <span className="flex items-center space-x-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span>Rejected Corrupt / Duplicate Rows Audit ({validationReport.rejectedRowsDetails.length})</span>
                    </span>
                    <span className="text-[10px] text-zinc-400 font-normal">Original values preserved without mutation</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1 pr-1 font-mono text-[10px]">
                    {validationReport.rejectedRowsDetails.slice(0, 10).map((rej, idx) => (
                      <div key={idx} className="bg-zinc-950/80 p-1.5 rounded border border-rose-900/30 text-zinc-300 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <span className="text-rose-400 font-semibold">{rej.lineNum > 0 ? `Row ${rej.lineNum}` : 'Duplicate'}: {rej.reason}</span>
                        {rej.ohlc && (
                          <span className="text-zinc-500 text-[9px]">
                            O:{rej.ohlc.open ?? '-'} H:{rej.ohlc.high ?? '-'} L:{rej.ohlc.low ?? '-'} C:{rej.ohlc.close ?? '-'}
                          </span>
                        )}
                      </div>
                    ))}
                    {validationReport.rejectedRowsDetails.length > 10 && (
                      <div className="text-center text-zinc-500 text-[10px] py-1">
                        ... and {validationReport.rejectedRowsDetails.length - 10} more rejected rows
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sample Candle Preview (Raw vs Normalized) */}
              {parsedPreviewCandles.length > 0 && (
                <div className="pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase mb-1">
                    <span>Sample Bars: Raw Imported vs Normalized Decimal Representation</span>
                    <span className="text-zinc-500 font-normal">Showing First 2 and Last 2 Bars</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[10px] text-zinc-400">
                      <thead>
                        <tr className="text-zinc-500 border-b border-zinc-800">
                          <th className="py-1">Timestamp / Date</th>
                          <th className="py-1">Raw Open</th>
                          <th className="py-1">Raw High/Low</th>
                          <th className="py-1 text-emerald-400">Normalized Open</th>
                          <th className="py-1 text-emerald-400">Normalized High</th>
                          <th className="py-1 text-rose-400">Normalized Low</th>
                          <th className="py-1 text-blue-400">Normalized Close</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedPreviewCandles.slice(0, 2).map((c, idx) => (
                          <tr key={`first_${idx}`} className="border-b border-zinc-900">
                            <td className="py-1 text-zinc-300 font-mono">{c.datetime || new Date(c.timestamp).toISOString()}</td>
                            <td className="py-1 font-mono text-zinc-400">{c.rawOhlc?.open ?? c.open}</td>
                            <td className="py-1 font-mono text-zinc-500">{c.rawOhlc?.high ?? c.high} / {c.rawOhlc?.low ?? c.low}</td>
                            <td className="py-1 font-mono text-zinc-200">{c.open.toFixed(5)}</td>
                            <td className="py-1 font-mono text-emerald-400">{c.high.toFixed(5)}</td>
                            <td className="py-1 font-mono text-rose-400">{c.low.toFixed(5)}</td>
                            <td className="py-1 font-mono text-blue-400">{c.close.toFixed(5)}</td>
                          </tr>
                        ))}
                        {parsedPreviewCandles.length > 4 && (
                          <tr>
                            <td colSpan={7} className="py-0.5 text-center text-zinc-600 font-mono">
                              ... {parsedPreviewCandles.length - 4} intermediate historical bars ...
                            </td>
                          </tr>
                        )}
                        {parsedPreviewCandles.slice(-2).map((c, idx) => (
                          <tr key={`last_${idx}`} className="border-b border-zinc-900">
                            <td className="py-1 text-zinc-300 font-mono">{c.datetime || new Date(c.timestamp).toISOString()}</td>
                            <td className="py-1 font-mono text-zinc-400">{c.rawOhlc?.open ?? c.open}</td>
                            <td className="py-1 font-mono text-zinc-500">{c.rawOhlc?.high ?? c.high} / {c.rawOhlc?.low ?? c.low}</td>
                            <td className="py-1 font-mono text-zinc-200">{c.open.toFixed(5)}</td>
                            <td className="py-1 font-mono text-emerald-400">{c.high.toFixed(5)}</td>
                            <td className="py-1 font-mono text-rose-400">{c.low.toFixed(5)}</td>
                            <td className="py-1 font-mono text-blue-400">{c.close.toFixed(5)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {importStatus && !validationReport && (
            <div className="p-3 rounded-xl text-xs font-mono bg-zinc-950 text-zinc-300 border border-zinc-800">
              {importStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
