import React, { useState } from 'react';
import { MarketDataAdapter, MarketDataResult, Candle } from '../types/market';
import { MarketDataRegistry } from '../services/marketData/MarketDataRegistry';
import { Database, Upload, Check, AlertTriangle, FileText, RefreshCw, ShieldCheck } from 'lucide-react';

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
  const [importPair, setImportPair] = useState(activePair);
  const [importTf, setImportTf] = useState(activeTimeframe);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      parseAndSaveImport(content);
    };
    reader.readAsText(file);
  };

  const parseAndSaveImport = (text: string) => {
    try {
      let candles: Candle[] = [];

      // Check if JSON
      if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : parsed.candles || parsed.data || [];
        candles = list.map((item: any) => ({
          timestamp: item.timestamp || item.time || new Date(item.datetime || item.date).getTime(),
          open: parseFloat(item.open || item.o),
          high: parseFloat(item.high || item.h),
          low: parseFloat(item.low || item.l),
          close: parseFloat(item.close || item.c),
          volume: parseFloat(item.volume || item.v || 0),
          datetime: item.datetime || item.date || new Date(item.timestamp || Date.now()).toISOString(),
        }));
      } else {
        // CSV parsing (time/date, open, high, low, close, volume)
        const lines = text.trim().split(/\r?\n/);
        const startIndex = isNaN(parseFloat(lines[0].split(',')[1])) ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
          const parts = lines[i].split(',').map(s => s.trim());
          if (parts.length >= 5) {
            const timeStr = parts[0];
            const timestamp = !isNaN(parseFloat(timeStr)) && timeStr.length > 9
              ? parseFloat(timeStr)
              : new Date(timeStr).getTime();

            candles.push({
              timestamp: timestamp || Date.now() - (lines.length - i) * 3600000,
              open: parseFloat(parts[1]),
              high: parseFloat(parts[2]),
              low: parseFloat(parts[3]),
              close: parseFloat(parts[4]),
              volume: parts[5] ? parseFloat(parts[5]) : 1000,
              datetime: timeStr,
            });
          }
        }
      }

      if (candles.length === 0) {
        setImportStatus('Error: Could not parse valid OHLC candles.');
        return;
      }

      const customProvider = providers.find(p => p.id === 'custom_import');
      if (customProvider && customProvider.importCustomData) {
        customProvider.importCustomData(importPair, importTf, candles);
        registry.setActiveProvider('custom_import');
        onProviderChange('custom_import');
        setImportStatus(`Success! Imported ${candles.length} candles for ${importPair} (${importTf}).`);
        onDataRefresh();
      }
    } catch (e: any) {
      setImportStatus(`Import failed: ${e.message}`);
    }
  };

  return (
    <div id="market_data_main_view" className="space-y-6 pb-20 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center space-x-2">
            <Database className="w-5 h-5 text-blue-400" />
            <span>Modular Market Data Architecture</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Switch provider adapters, import broker CSV/JSON records, or inspect active dataset status.
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
                    <span className="px-2 py-0.5 rounded bg-blue-500 text-white text-[10px] font-bold">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-500 uppercase font-mono">Select</span>
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

      {/* Current Data Feed Diagnostic */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider pb-2 border-b border-zinc-800">
          Active Feed Diagnostics
        </h3>

        {currentDataResult ? (
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
              <span className="text-blue-400 font-bold">{currentDataResult.data.length} bars</span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-zinc-500">Loading diagnostics...</div>
        )}

        {currentDataResult?.status === 'DATA_UNAVAILABLE' && (
          <div className="bg-rose-950/30 border border-rose-800/40 rounded-xl p-3 text-xs text-rose-300 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              {currentDataResult.message || 'Data unavailable for this selection. Analysis will flag NO TRADE.'}
            </span>
          </div>
        )}
      </div>

      {/* Custom Broker CSV / JSON Importer */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div>
          <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
            Import Custom Broker Data (CSV / JSON)
          </h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Upload exported candle history from MetaTrader 4/5, TradingView, or cTrader.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
              Target Pair
            </label>
            <input
              type="text"
              value={importPair}
              onChange={e => setImportPair(e.target.value.toUpperCase())}
              placeholder="e.g. EUR/USD"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
              Timeframe
            </label>
            <input
              type="text"
              value={importTf}
              onChange={e => setImportTf(e.target.value.toUpperCase())}
              placeholder="e.g. H1"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-200 font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-zinc-400">
            Paste Raw CSV / JSON or Select File:
          </label>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={`Timestamp,Open,High,Low,Close,Volume\n2026-08-20 12:00:00,1.0850,1.0875,1.0840,1.0865,1250`}
            rows={4}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <label className="cursor-pointer px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold flex items-center space-x-1.5 border border-zinc-700 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>Choose CSV/JSON File</span>
              <input type="file" accept=".csv,.json,.txt" onChange={handleFileUpload} className="hidden" />
            </label>

            <button
              type="button"
              onClick={() => parseAndSaveImport(importText)}
              disabled={!importText.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
            >
              Parse & Save to Custom Store
            </button>
          </div>

          {importStatus && (
            <div
              className={`p-3 rounded-xl text-xs font-mono ${
                importStatus.startsWith('Success')
                  ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800'
                  : 'bg-rose-950/40 text-rose-300 border border-rose-800'
              }`}
            >
              {importStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
