import React, { useState } from 'react';
import { SetupAnalysisResult, SetupInput } from '../types/analyzer';
import { Candle, Timeframe } from '../types/market';
import { SetupForm } from './SetupForm';
import { CandlestickChart } from './CandlestickChart';
import { DecisionBanner } from './DecisionBanner';
import { FactorCard } from './FactorCard';
import { BookmarkPlus, Play, MessageSquare, Check, Sparkles } from 'lucide-react';
import { parseChatPrompt } from '../services/analyzer/ChatPromptParser';

interface AnalyzerViewProps {
  analysis: SetupAnalysisResult | null;
  currentInput: SetupInput;
  onInputChange: (updated: SetupInput) => void;
  onAnalyze: () => void;
  onAutoFillMarket: () => void;
  candles: Candle[];
  pairs: string[];
  timeframes: Timeframe[];
  onSaveToJournal: (analysis: SetupAnalysisResult, notes?: string) => void;
  onSendToBacktest: (pair: string, timeframe: string) => void;
  onOpenChatParser: () => void;
  isSaved?: boolean;
}

export const AnalyzerView: React.FC<AnalyzerViewProps> = ({
  analysis,
  currentInput,
  onInputChange,
  onAnalyze,
  onAutoFillMarket,
  candles,
  pairs,
  timeframes,
  onSaveToJournal,
  onSendToBacktest,
  onOpenChatParser,
  isSaved = false,
}) => {
  const [quickPrompt, setQuickPrompt] = useState('');
  const [journalNotes, setJournalNotes] = useState('');
  const [showNotesInput, setShowNotesInput] = useState(false);

  const handleQuickPromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPrompt.trim()) return;
    const parsed = parseChatPrompt(quickPrompt);
    if (parsed.matchedFields.length > 0) {
      onInputChange({
        ...currentInput,
        ...(parsed.input.pair ? { pair: parsed.input.pair } : {}),
        ...(parsed.input.timeframe ? { timeframe: parsed.input.timeframe } : {}),
        ...(parsed.input.direction ? { direction: parsed.input.direction } : {}),
        ...(parsed.input.entryPrice ? { entryPrice: parsed.input.entryPrice } : {}),
        ...(parsed.input.stopLoss ? { stopLoss: parsed.input.stopLoss } : {}),
        ...(parsed.input.takeProfit ? { takeProfit: parsed.input.takeProfit } : {}),
      });
      setQuickPrompt('');
      // Trigger analysis immediately
      setTimeout(() => {
        onAnalyze();
      }, 50);
    }
  };

  return (
    <div id="analyzer_main_view" className="space-y-6 pb-20 max-w-7xl mx-auto">
      {/* Natural Language Quick Bar */}
      <div className="bg-gradient-to-r from-blue-950/40 via-zinc-900 to-indigo-950/40 border border-zinc-800 rounded-2xl p-3 sm:p-4">
        <form onSubmit={handleQuickPromptSubmit} className="flex flex-col sm:flex-row items-center gap-2">
          <div className="flex items-center space-x-2 text-blue-400 shrink-0 px-1">
            <MessageSquare className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              Quick Chat Setup:
            </span>
          </div>

          <div className="relative flex-1 w-full">
            <input
              id="quick_prompt_input"
              type="text"
              value={quickPrompt}
              onChange={e => setQuickPrompt(e.target.value)}
              placeholder="e.g., EURUSD 1h buy 1.0850 sl 1.0820 tp 1.0920"
              className="w-full bg-zinc-950/90 border border-zinc-700/80 rounded-xl px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 font-mono focus:outline-none focus:border-blue-500 transition-all"
            />
          </div>

          <button
            type="submit"
            id="quick_prompt_parse_btn"
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md transition-colors shrink-0 flex items-center justify-center space-x-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Parse & Analyze</span>
          </button>
        </form>
      </div>

      {/* Main Grid: Chart & Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Interactive Chart (7 cols on desktop) */}
        <div className="lg:col-span-7 space-y-4">
          <CandlestickChart
            candles={candles}
            pair={currentInput.pair}
            timeframe={currentInput.timeframe}
            entryPrice={currentInput.entryPrice}
            stopLoss={currentInput.stopLoss}
            takeProfit={currentInput.takeProfit}
            direction={currentInput.direction}
          />
        </div>

        {/* Right Column: Setup Form (5 cols on desktop) */}
        <div className="lg:col-span-5 space-y-4">
          <SetupForm
            input={currentInput}
            onChange={onInputChange}
            onAnalyze={onAnalyze}
            onAutoFillMarket={onAutoFillMarket}
            pairs={pairs}
            timeframes={timeframes}
          />
        </div>
      </div>

      {/* Analysis Results Section */}
      {analysis && (
        <div id="analysis_results_container" className="space-y-5 pt-2">
          {/* Decision Card */}
          <DecisionBanner
            decision={analysis.decision}
            overallScore={analysis.overallScore}
            summary={analysis.decisionSummary}
            keyStrengths={analysis.keyStrengths}
            keyWeaknesses={analysis.keyWeaknesses}
          />

          {/* Action Row: Save to Journal / Send to Backtest */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs text-zinc-400">Setup Action:</span>
              <span className="text-xs font-mono font-bold text-zinc-200">
                {analysis.input.pair} ({analysis.input.timeframe}) {analysis.input.direction}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                id="save_to_journal_btn"
                onClick={() => {
                  if (showNotesInput) {
                    onSaveToJournal(analysis, journalNotes);
                    setShowNotesInput(false);
                    setJournalNotes('');
                  } else {
                    setShowNotesInput(true);
                  }
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                  isSaved
                    ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                    : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-200'
                }`}
              >
                {isSaved ? <Check className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                <span>{isSaved ? 'Saved in Journal' : showNotesInput ? 'Confirm Save' : 'Save to Journal'}</span>
              </button>

              <button
                type="button"
                id="send_to_backtest_btn"
                onClick={() => onSendToBacktest(analysis.input.pair, analysis.input.timeframe)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-xs font-bold transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Walk-Forward Backtest</span>
              </button>
            </div>
          </div>

          {/* Optional notes input for journal */}
          {showNotesInput && !isSaved && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
              <label className="block text-[11px] font-semibold text-zinc-400">
                Add Journal Notes (e.g. catalyst, psychology, execution rules):
              </label>
              <textarea
                value={journalNotes}
                onChange={e => setJournalNotes(e.target.value)}
                placeholder="e.g. Entered after liquidity sweep at London open. Risking 1%."
                rows={2}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* 8-Factor Breakdown Heading */}
          <div className="pt-2">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
                  <span>8-Factor Objective Matrix</span>
                </h3>
                <p className="text-[11px] text-zinc-400">
                  Comprehensive mathematical audit across institutional criteria.
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-zinc-400">
                Total Score: {analysis.overallScore} / 100
              </span>
            </div>

            {/* 8 Factors Grid (2 cols on mobile, 4 cols on desktop) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              {analysis.factors.map(factor => (
                <FactorCard key={factor.factorKey} factor={factor} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
