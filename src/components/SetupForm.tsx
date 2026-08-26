import React from 'react';
import { SetupInput, TradeDirection } from '../types/analyzer';
import { Timeframe } from '../types/market';
import { calculatePips, getPipScale } from '../services/marketData/historicalDataGenerator';
import { ArrowUpRight, ArrowDownRight, RefreshCw, Calculator, Sparkles, HelpCircle } from 'lucide-react';

interface SetupFormProps {
  input: SetupInput;
  onChange: (updated: SetupInput) => void;
  onAnalyze: () => void;
  onAutoFillMarket: () => void;
  pairs: string[];
  timeframes: Timeframe[];
  isAnalyzing?: boolean;
}

export const SetupForm: React.FC<SetupFormProps> = ({
  input,
  onChange,
  onAnalyze,
  onAutoFillMarket,
  pairs,
  timeframes,
  isAnalyzing = false,
}) => {
  const isBuy = input.direction === 'BUY';
  const pipScale = getPipScale(input.pair);

  const riskDist = Math.abs(input.entryPrice - input.stopLoss);
  const rewardDist = Math.abs(input.takeProfit - input.entryPrice);
  const riskPips = Number((riskDist / pipScale).toFixed(1));
  const rewardPips = Number((rewardDist / pipScale).toFixed(1));
  const rrRatio = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 0;

  // Account sizing
  const balance = input.accountBalance ?? 10000;
  const riskPercent = input.riskPercent ?? 1.0;
  const dollarRisk = (balance * riskPercent) / 100;
  const pipValPerLot = input.pair.includes('JPY') ? 7.0 : 10.0;
  const suggestedLotSize = riskPips > 0 ? Number((dollarRisk / (riskPips * pipValPerLot)).toFixed(2)) : 0.01;

  // Quick auto-set 1:2 or 1:3 R:R
  const setTargetRatio = (ratio: number) => {
    if (riskDist <= 0) return;
    const newTP = isBuy
      ? input.entryPrice + riskDist * ratio
      : input.entryPrice - riskDist * ratio;
    const decimals = input.pair.includes('JPY') ? 3 : input.pair.includes('XAU') ? 2 : 5;
    onChange({
      ...input,
      takeProfit: Number(newTP.toFixed(decimals)),
    });
  };

  return (
    <div id="setup_input_form" className="bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 shadow-xl">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
            <span>Forex Setup Parameters</span>
          </h3>
          <p className="text-[11px] text-zinc-400">
            Define pair, timeframe, and price levels for 8-factor evaluation.
          </p>
        </div>

        <button
          type="button"
          onClick={onAutoFillMarket}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium border border-zinc-700 transition-colors"
          title="Fill entry and stops based on latest candle"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Sync Market</span>
        </button>
      </div>

      <div className="space-y-4">
        {/* Row 1: Pair & Timeframe */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-1">
              Forex Pair
            </label>
            <select
              id="setup_pair_select"
              value={input.pair}
              onChange={e => onChange({ ...input, pair: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-3 py-2 text-sm text-zinc-100 font-mono font-medium focus:outline-none focus:border-blue-500 transition-colors"
            >
              {pairs.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-1">
              Timeframe
            </label>
            <div className="flex items-center space-x-1 bg-zinc-950 p-1 rounded-xl border border-zinc-700/80">
              {timeframes.map(tf => (
                <button
                  key={tf}
                  type="button"
                  id={`tf_btn_${tf}`}
                  onClick={() => onChange({ ...input, timeframe: tf })}
                  className={`flex-1 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                    input.timeframe === tf
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Direction Toggle (Buy vs Sell) */}
        <div>
          <label className="block text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-1">
            Order Direction
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              id="direction_buy_btn"
              onClick={() => onChange({ ...input, direction: 'BUY' })}
              className={`flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl font-bold text-xs tracking-wide transition-all border ${
                isBuy
                  ? 'bg-emerald-500 text-zinc-950 border-emerald-400 shadow-md shadow-emerald-950/40'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>BUY / LONG</span>
            </button>

            <button
              type="button"
              id="direction_sell_btn"
              onClick={() => onChange({ ...input, direction: 'SELL' })}
              className={`flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl font-bold text-xs tracking-wide transition-all border ${
                !isBuy
                  ? 'bg-rose-500 text-white border-rose-400 shadow-md shadow-rose-950/40'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              <ArrowDownRight className="w-4 h-4" />
              <span>SELL / SHORT</span>
            </button>
          </div>
        </div>

        {/* Row 3: Entry Price, Stop Loss, Take Profit */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Entry Price
              </label>
              <span className="text-[10px] text-blue-400 font-mono">Trigger</span>
            </div>
            <input
              id="setup_entry_price"
              type="number"
              step="any"
              value={input.entryPrice}
              onChange={e => onChange({ ...input, entryPrice: parseFloat(e.target.value) || 0 })}
              className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl px-3 py-2 text-sm text-zinc-100 font-mono font-medium focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Stop Loss (SL)
              </label>
              <span className="text-[10px] text-rose-400 font-mono">{riskPips} pips</span>
            </div>
            <input
              id="setup_stop_loss"
              type="number"
              step="any"
              value={input.stopLoss}
              onChange={e => onChange({ ...input, stopLoss: parseFloat(e.target.value) || 0 })}
              className="w-full bg-zinc-950 border border-rose-900/50 rounded-xl px-3 py-2 text-sm text-rose-300 font-mono font-medium focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
                Take Profit (TP)
              </label>
              <span className="text-[10px] text-emerald-400 font-mono">{rewardPips} pips</span>
            </div>
            <input
              id="setup_take_profit"
              type="number"
              step="any"
              value={input.takeProfit}
              onChange={e => onChange({ ...input, takeProfit: parseFloat(e.target.value) || 0 })}
              className="w-full bg-zinc-950 border border-emerald-900/50 rounded-xl px-3 py-2 text-sm text-emerald-300 font-mono font-medium focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Target Quick R:R Presets */}
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-zinc-400 text-[11px]">Quick Target R:R:</span>
          <div className="flex items-center space-x-1.5">
            {[1.5, 2.0, 3.0].map(ratio => (
              <button
                key={ratio}
                type="button"
                onClick={() => setTargetRatio(ratio)}
                className="px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-mono font-bold border border-zinc-700 transition-colors"
              >
                1:{ratio} TP
              </button>
            ))}
          </div>
        </div>

        {/* Live Risk / Reward and Sizing Ribbon */}
        <div className="bg-zinc-950/80 rounded-xl p-3 border border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
          <div>
            <div className="text-[10px] text-zinc-400 uppercase">Risk : Reward</div>
            <div
              className={`font-mono font-black text-sm ${
                rrRatio >= 1.5 ? 'text-emerald-400' : rrRatio >= 1.0 ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              1 : {rrRatio}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-400 uppercase">Risk Distance</div>
            <div className="font-mono font-bold text-zinc-200 text-sm">{riskPips} pips</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-400 uppercase">Risk Amount (1%)</div>
            <div className="font-mono font-bold text-zinc-200 text-sm">${dollarRisk.toFixed(0)}</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-400 uppercase">Suggested Lot</div>
            <div className="font-mono font-black text-blue-400 text-sm">{Math.max(0.01, suggestedLotSize)} Lots</div>
          </div>
        </div>

        {/* Primary Action Button */}
        <button
          type="button"
          id="run_setup_analysis_btn"
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-lg shadow-blue-500/20 active:scale-[0.99] transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          <span>{isAnalyzing ? 'Analyzing 8 Factors...' : 'Analyze Forex Setup'}</span>
        </button>
      </div>
    </div>
  );
};
