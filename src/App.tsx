import React, { useState, useEffect, useCallback } from 'react';
import { SetupAnalysisResult, SetupInput, CalibrationWeights, CalibrationThresholds, CalibrationProfile } from './types/analyzer';
import { Timeframe, MarketDataResult } from './types/market';
import { JournalEntry } from './types/journal';
import { MarketDataRegistry } from './services/marketData/MarketDataRegistry';
import { SetupAnalyzerEngine, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, DEFAULT_PROFILES } from './services/analyzer/SetupAnalyzerEngine';
import { JournalStorage } from './services/journal/JournalStorage';
import { getPipScale } from './services/marketData/historicalDataGenerator';
import { detectSession } from './services/analyzer/technicalIndicators';

// Components
import { Navigation, ActiveTab } from './components/Navigation';
import { AnalyzerView } from './components/AnalyzerView';
import { ChatAnalyzerView } from './components/ChatAnalyzerView';
import { BacktestView } from './components/BacktestView';
import { JournalView } from './components/JournalView';
import { CalibrationView } from './components/CalibrationView';
import { MarketDataView } from './components/MarketDataView';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('analyzer');

  // Calibration State
  const [weights, setWeights] = useState<CalibrationWeights>(DEFAULT_WEIGHTS);
  const [thresholds, setThresholds] = useState<CalibrationThresholds>(DEFAULT_THRESHOLDS);

  // Journal State
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);

  // Market Data State
  const registry = MarketDataRegistry.getInstance();
  const [currentProvider, setCurrentProvider] = useState(registry.getActiveProvider());
  const [marketDataResult, setMarketDataResult] = useState<MarketDataResult | null>(null);

  const availablePairs = [
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

  const availableTimeframes: Timeframe[] = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  // Setup Input State
  const [setupInput, setSetupInput] = useState<SetupInput>({
    pair: 'EUR/USD',
    timeframe: 'H1',
    direction: 'BUY',
    entryPrice: 1.0850,
    stopLoss: 1.0815,
    takeProfit: 1.0920,
    accountBalance: 10000,
    riskPercent: 1.0,
  });

  // Active Analysis Result
  const [analysisResult, setAnalysisResult] = useState<SetupAnalysisResult | null>(null);
  const [isSavedInJournal, setIsSavedInJournal] = useState<boolean>(false);

  // Load Journal Entries on mount
  useEffect(() => {
    setJournalEntries(JournalStorage.getEntries());
  }, []);

  // Fetch Market Data when Pair / Timeframe / Provider changes
  const loadMarketData = useCallback(async (pair: string, timeframe: string) => {
    const res = await registry.fetchCandles(pair, timeframe, 250);
    setMarketDataResult(res);
    return res;
  }, [registry]);

  useEffect(() => {
    loadMarketData(setupInput.pair, setupInput.timeframe);
  }, [setupInput.pair, setupInput.timeframe, loadMarketData]);

  // Run Setup Analysis
  const runAnalysis = useCallback(() => {
    if (!marketDataResult) return;

    const analysis = SetupAnalyzerEngine.analyzeSetup(
      setupInput,
      marketDataResult.data,
      weights,
      thresholds,
      marketDataResult.status,
      marketDataResult.source
    );

    setAnalysisResult(analysis);
    setIsSavedInJournal(false);
  }, [setupInput, marketDataResult, weights, thresholds]);

  // Run initial analysis once data is ready
  useEffect(() => {
    if (marketDataResult && !analysisResult) {
      runAnalysis();
    }
  }, [marketDataResult, analysisResult, runAnalysis]);

  // Sync market price to latest candle
  const handleAutoFillMarket = () => {
    if (!marketDataResult || marketDataResult.data.length === 0) return;
    const last = marketDataResult.data[marketDataResult.data.length - 1];
    const pipScale = getPipScale(setupInput.pair);
    const isBuy = setupInput.direction === 'BUY';
    const entry = last.close;

    // 25 pips default stop for majors, 40 for JPY/Gold
    const stopPips = setupInput.pair.includes('JPY') ? 45 : setupInput.pair.includes('XAU') ? 150 : 25;
    const slDist = stopPips * pipScale;
    const stop = isBuy ? entry - slDist : entry + slDist;
    const target = isBuy ? entry + slDist * 2.0 : entry - slDist * 2.0;

    const decimals = setupInput.pair.includes('JPY') ? 3 : setupInput.pair.includes('XAU') ? 2 : 5;

    const updated: SetupInput = {
      ...setupInput,
      entryPrice: Number(entry.toFixed(decimals)),
      stopLoss: Number(stop.toFixed(decimals)),
      takeProfit: Number(target.toFixed(decimals)),
    };

    setSetupInput(updated);

    setTimeout(() => {
      if (marketDataResult) {
        const analysis = SetupAnalyzerEngine.analyzeSetup(
          updated,
          marketDataResult.data,
          weights,
          thresholds,
          marketDataResult.status,
          marketDataResult.source
        );
        setAnalysisResult(analysis);
        setIsSavedInJournal(false);
      }
    }, 50);
  };

  // Journal Actions
  const handleSaveToJournal = (analysis: SetupAnalysisResult, notes?: string) => {
    JournalStorage.addEntryFromAnalysis(analysis, notes);
    setJournalEntries(JournalStorage.getEntries());
    setIsSavedInJournal(true);
  };

  // Backtest Transfer
  const handleSendToBacktest = (pair: string, timeframe: string) => {
    setSetupInput(prev => ({
      ...prev,
      pair,
      timeframe: timeframe as Timeframe,
    }));
    setActiveTab('backtest');
  };

  // Apply from Chat
  const handleApplyFromChat = (input: SetupInput) => {
    setSetupInput(input);
    setActiveTab('analyzer');
    setTimeout(() => {
      runAnalysis();
    }, 100);
  };

  const currentSessionInfo = detectSession(Date.now());

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased font-sans flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Top Navigation & Mobile Bar */}
      <Navigation
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        journalCount={journalEntries.filter(e => e.outcome === 'PENDING').length}
        currentSession={currentSessionInfo.name}
        dataStatus={marketDataResult?.status}
      />

      {/* Main Container */}
      <main className="flex-1 px-3 sm:px-6 py-4 sm:py-6 max-w-7xl w-full mx-auto">
        {activeTab === 'analyzer' && (
          <AnalyzerView
            analysis={analysisResult}
            currentInput={setupInput}
            onInputChange={setSetupInput}
            onAnalyze={runAnalysis}
            onAutoFillMarket={handleAutoFillMarket}
            candles={marketDataResult?.data || []}
            pairs={availablePairs}
            timeframes={availableTimeframes}
            onSaveToJournal={handleSaveToJournal}
            onSendToBacktest={handleSendToBacktest}
            onOpenChatParser={() => setActiveTab('chat')}
            isSaved={isSavedInJournal}
          />
        )}

        {activeTab === 'chat' && (
          <ChatAnalyzerView
            onApplyToAnalyzer={handleApplyFromChat}
            onSaveToJournal={handleSaveToJournal}
            onSendToBacktest={handleSendToBacktest}
          />
        )}

        {activeTab === 'backtest' && (
          <BacktestView
            pair={setupInput.pair}
            timeframe={setupInput.timeframe}
            candles={marketDataResult?.data || []}
            weights={weights}
            thresholds={thresholds}
            profiles={DEFAULT_PROFILES}
            onSelectPair={p => setSetupInput(prev => ({ ...prev, pair: p }))}
            onSelectTimeframe={tf => setSetupInput(prev => ({ ...prev, timeframe: tf }))}
          />
        )}

        {activeTab === 'journal' && (
          <JournalView
            entries={journalEntries}
            onUpdateEntries={setJournalEntries}
          />
        )}

        {activeTab === 'calibration' && (
          <CalibrationView
            weights={weights}
            thresholds={thresholds}
            onUpdateWeights={setWeights}
            onUpdateThresholds={setThresholds}
            onSelectProfile={(p: CalibrationProfile) => {
              setWeights(p.weights);
              setThresholds(p.thresholds);
            }}
          />
        )}

        {activeTab === 'market_data' && (
          <MarketDataView
            currentProvider={currentProvider}
            onProviderChange={(id: string) => {
              setCurrentProvider(registry.getActiveProvider());
              loadMarketData(setupInput.pair, setupInput.timeframe);
            }}
            activePair={setupInput.pair}
            activeTimeframe={setupInput.timeframe}
            currentDataResult={marketDataResult}
            onDataRefresh={() => loadMarketData(setupInput.pair, setupInput.timeframe)}
          />
        )}
      </main>
    </div>
  );
}
