import React, { useState } from 'react';
import { Send, Sparkles, User, Bot, ArrowRight, BookmarkPlus, Play, AlertCircle } from 'lucide-react';
import { parseChatPrompt } from '../services/analyzer/ChatPromptParser';
import { SetupAnalyzerEngine, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from '../services/analyzer/SetupAnalyzerEngine';
import { MarketDataRegistry } from '../services/marketData/MarketDataRegistry';
import { SetupAnalysisResult, SetupInput } from '../types/analyzer';
import { DecisionBanner } from './DecisionBanner';
import { FactorCard } from './FactorCard';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: number;
  text: string;
  analysis?: SetupAnalysisResult;
  parsedInput?: Partial<SetupInput>;
}

interface ChatAnalyzerViewProps {
  onApplyToAnalyzer: (input: SetupInput) => void;
  onSaveToJournal: (analysis: SetupAnalysisResult) => void;
  onSendToBacktest: (pair: string, timeframe: string) => void;
}

export const ChatAnalyzerView: React.FC<ChatAnalyzerViewProps> = ({
  onApplyToAnalyzer,
  onSaveToJournal,
  onSendToBacktest,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_welcome',
      sender: 'assistant',
      timestamp: Date.now(),
      text: "👋 Welcome to Forex Trading Chat Analyzer. Paste or type any forex setup (e.g., 'EURUSD 1h buy 1.0850 sl 1.0815 tp 1.0920' or 'Short GBPJPY on 15m @ 199.20 sl 199.65 tp 198.10'). I will parse your parameters, evaluate all 8 institutional factors against historical price action, and output a strict VALID, WAIT, REJECT, or NO TRADE decision.",
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const samplePrompts = [
    'EUR/USD H1 Buy 1.0850 SL 1.0815 TP 1.0920',
    'GBPJPY 15m Sell @ 199.20 SL 199.65 TP 198.10',
    'USDJPY H4 Buy 154.20 SL 153.60 TP 155.80',
    'XAU/USD M15 Short 2650 SL 2665 TP 2615',
  ];

  const handleSendMessage = async (customText?: string) => {
    const text = (customText || inputText).trim();
    if (!text) return;

    const userMsgId = `user_${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      timestamp: Date.now(),
      text,
    };

    setMessages(prev => [...prev, userMsg]);
    if (!customText) setInputText('');
    setIsProcessing(true);

    // Parse the setup
    const parsed = parseChatPrompt(text);
    const registry = MarketDataRegistry.getInstance();

    const pair = parsed.input.pair || 'EUR/USD';
    const timeframe = parsed.input.timeframe || 'H1';
    const direction = parsed.input.direction || 'BUY';

    // Fetch candle context
    const marketData = await registry.fetchCandles(pair, timeframe, 250);

    let entry = parsed.input.entryPrice;
    let sl = parsed.input.stopLoss;
    let tp = parsed.input.takeProfit;

    // If prices missing, estimate from market data
    if (marketData.data.length > 0 && (!entry || !sl || !tp)) {
      const lastClose = marketData.data[marketData.data.length - 1].close;
      const isBuy = direction === 'BUY';
      entry = entry || lastClose;
      const pip = pair.includes('JPY') ? 0.01 : pair.includes('XAU') ? 0.1 : 0.0001;
      sl = sl || (isBuy ? entry - pip * 30 : entry + pip * 30);
      tp = tp || (isBuy ? entry + pip * 60 : entry - pip * 60);
    }

    const fullInput: SetupInput = {
      pair,
      timeframe,
      direction,
      entryPrice: Number((entry || 1.0850).toFixed(5)),
      stopLoss: Number((sl || 1.0820).toFixed(5)),
      takeProfit: Number((tp || 1.0910).toFixed(5)),
    };

    const analysis = SetupAnalyzerEngine.analyzeSetup(
      fullInput,
      marketData.data,
      DEFAULT_WEIGHTS,
      DEFAULT_THRESHOLDS,
      marketData.status,
      marketData.source
    );

    const assistantMsgId = `asst_${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      sender: 'assistant',
      timestamp: Date.now(),
      text: `Analyzed ${pair} (${timeframe}) ${direction} setup with ${parsed.matchedFields.length}/6 parameters identified. Decision: **${analysis.decision}** (Confluence Score: ${analysis.overallScore}/100, R:R 1:${analysis.riskMetrics.riskRewardRatio}).`,
      analysis,
      parsedInput: fullInput,
    };

    setMessages(prev => [...prev, assistantMsg]);
    setIsProcessing(false);
  };

  return (
    <div id="chat_analyzer_container" className="max-w-5xl mx-auto space-y-4 pb-20">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <span>Forex Setup Chat Assistant</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Natural language parsing and instant 8-factor rule evaluation.
          </p>
        </div>
      </div>

      {/* Suggested Quick Prompts */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
        <span className="text-zinc-500 shrink-0 text-[11px]">Quick prompts:</span>
        {samplePrompts.map((p, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSendMessage(p)}
            className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white rounded-lg text-xs font-mono shrink-0 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Messages Thread */}
      <div className="space-y-4 min-h-[400px]">
        {messages.map(msg => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex space-x-3 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0 mt-1">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-3xl rounded-2xl p-4 text-xs space-y-3 ${
                  isUser
                    ? 'bg-blue-600 text-white rounded-tr-sm'
                    : 'bg-zinc-900/90 border border-zinc-800 text-zinc-200 rounded-tl-sm shadow-lg'
                }`}
              >
                <p className="leading-relaxed text-sm">{msg.text}</p>

                {/* Analysis Card Attachment */}
                {msg.analysis && (
                  <div className="space-y-3 pt-2 border-t border-zinc-800">
                    <DecisionBanner
                      decision={msg.analysis.decision}
                      overallScore={msg.analysis.overallScore}
                      summary={msg.analysis.decisionSummary}
                      keyStrengths={msg.analysis.keyStrengths}
                      keyWeaknesses={msg.analysis.keyWeaknesses}
                    />

                    {/* Factor summary chips */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      {msg.analysis.factors.map(f => (
                        <FactorCard key={f.factorKey} factor={f} />
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => msg.parsedInput && onApplyToAnalyzer(msg.parsedInput as SetupInput)}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-zinc-700 transition-colors"
                      >
                        <span>Open in Chart</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => msg.analysis && onSaveToJournal(msg.analysis)}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-zinc-700 transition-colors"
                      >
                        <BookmarkPlus className="w-3 h-3" />
                        <span>Log to Journal</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          msg.analysis &&
                          onSendToBacktest(msg.analysis.input.pair, msg.analysis.input.timeframe)
                        }
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors"
                      >
                        <Play className="w-3 h-3" />
                        <span>Backtest</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {isUser && (
                <div className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0 mt-1">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}

        {isProcessing && (
          <div className="flex space-x-3 items-center text-zinc-400 text-xs">
            <div className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-blue-400 animate-pulse">
              <Bot className="w-4 h-4" />
            </div>
            <span>Evaluating market structure, liquidity, and session criteria...</span>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="sticky bottom-16 md:bottom-4 bg-zinc-950/95 backdrop-blur-md p-2 rounded-2xl border border-zinc-800 shadow-2xl">
        <form
          onSubmit={e => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          <input
            id="chat_analyzer_input"
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Type or paste setup (e.g., 'EURUSD 15m buy @ 1.0850 sl 1.0820 tp 1.0910')..."
            className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />

          <button
            type="submit"
            id="chat_analyzer_send_btn"
            disabled={!inputText.trim() || isProcessing}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs flex items-center space-x-1.5 shadow-md transition-all shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
