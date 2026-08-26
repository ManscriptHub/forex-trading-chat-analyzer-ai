import React, { useState, useMemo } from 'react';
import { Candle, Timeframe } from '../types/market';
import {
  BacktestResult,
  BacktestTrade,
  DataSplitType,
} from '../types/backtest';
import { CalibrationProfile, CalibrationWeights, CalibrationThresholds } from '../types/analyzer';
import { BacktestEngine } from '../services/backtest/BacktestEngine';
import {
  TrendingUp,
  Play,
  ShieldCheck,
  Percent,
  Activity,
  Award,
  AlertTriangle,
  Flame,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
} from 'lucide-react';

interface BacktestViewProps {
  pair: string;
  timeframe: string;
  candles: Candle[];
  weights: CalibrationWeights;
  thresholds: CalibrationThresholds;
  profiles: CalibrationProfile[];
  onSelectPair: (p: string) => void;
  onSelectTimeframe: (tf: Timeframe) => void;
}

export const BacktestView: React.FC<BacktestViewProps> = ({
  pair,
  timeframe,
  candles,
  weights,
  thresholds,
  profiles,
  onSelectPair,
  onSelectTimeframe,
}) => {
  const [splitType, setSplitType] = useState<DataSplitType>('ALL');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | 'WIN' | 'LOSS' | 'BREAKEVEN'>('ALL');
  const [selectedTrade, setSelectedTrade] = useState<BacktestTrade | null>(null);

  const handleRunBacktest = () => {
    setIsRunning(true);
    setTimeout(() => {
      const res = BacktestEngine.runBacktest({
        pair,
        timeframe,
        candles,
        weights,
        thresholds,
        splitType,
        trainPct: 60,
        valPct: 20,
        testPct: 20,
      });
      setBacktestResult(res);
      setIsRunning(false);
    }, 150);
  };

  // Run automatically on first mount if candles exist
  React.useEffect(() => {
    if (candles.length > 50 && !backtestResult) {
      handleRunBacktest();
    }
  }, [candles, pair, timeframe, splitType]);

  const filteredTrades = useMemo(() => {
    if (!backtestResult) return [];
    if (outcomeFilter === 'ALL') return backtestResult.trades;
    return backtestResult.trades.filter(t => t.outcome === outcomeFilter);
  }, [backtestResult, outcomeFilter]);

  const stats = backtestResult?.stats;

  // Render SVG Equity Curve
  const renderEquityCurve = () => {
    if (!stats || stats.equityCurve.length < 2) {
      return (
        <div className="h-44 flex items-center justify-center text-xs text-zinc-500 font-mono">
          No trade executions generated for this split.
        </div>
      );
    }

    const data = stats.equityCurve;
    const width = 600;
    const height = 180;
    const padding = { top: 15, right: 40, bottom: 25, left: 35 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxR = Math.max(0, ...data.map(d => d.cumulativeR), 2);
    const minR = Math.min(0, ...data.map(d => d.cumulativeR), -1);
    const rRange = maxR - minR || 1;

    const getY = (val: number) => chartH - ((val - minR) / rRange) * chartH;
    const getX = (idx: number) => (idx / (data.length - 1)) * chartW;

    const pathD = data
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.cumulativeR)}`)
      .join(' ');

    const zeroY = getY(0);

    return (
      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 select-none">
          <g transform={`translate(${padding.left}, ${padding.top})`}>
            {/* Zero line */}
            <line
              x1={0}
              y1={zeroY}
              x2={chartW}
              y2={zeroY}
              stroke="#3f3f46"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <text x={chartW + 4} y={zeroY + 3} fill="#71717a" fontSize={9} fontFamily="monospace">
              0R
            </text>

            {/* Max R tick */}
            <text x={chartW + 4} y={getY(maxR) + 3} fill="#10b981" fontSize={9} fontFamily="monospace">
              +{maxR.toFixed(1)}R
            </text>

            {/* Min R tick */}
            {minR < 0 && (
              <text x={chartW + 4} y={getY(minR) + 3} fill="#f43f5e" fontSize={9} fontFamily="monospace">
                {minR.toFixed(1)}R
              </text>
            )}

            {/* Gradient Fill under curve */}
            <path
              d={`${pathD} L ${chartW} ${zeroY} L 0 ${zeroY} Z`}
              fill={stats.netR >= 0 ? '#10b981' : '#f43f5e'}
              fillOpacity={0.12}
            />

            {/* Equity Curve Line */}
            <path
              d={pathD}
              fill="none"
              stroke={stats.netR >= 0 ? '#10b981' : '#f43f5e'}
              strokeWidth={2}
            />

            {/* Final point marker */}
            <circle
              cx={getX(data.length - 1)}
              cy={getY(data[data.length - 1].cumulativeR)}
              r={3.5}
              fill={stats.netR >= 0 ? '#10b981' : '#f43f5e'}
            />
          </g>
        </svg>
      </div>
    );
  };

  return (
    <div id="backtest_engine_view" className="space-y-6 pb-20 max-w-7xl mx-auto">
      {/* Header & Control Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>Zero-Lookahead Chronological Backtester</span>
            </h2>
            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">
              Walk-Forward
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Strict historical candle isolation: at bar T, future bars are locked and only used to resolve eventual trade outcomes.
          </p>
        </div>

        {/* Data Split Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-zinc-950 p-1 rounded-xl border border-zinc-800 flex items-center space-x-1 text-xs">
            {(['ALL', 'TRAIN', 'VALIDATION', 'TEST'] as DataSplitType[]).map(split => (
              <button
                key={split}
                type="button"
                id={`split_btn_${split}`}
                onClick={() => setSplitType(split)}
                className={`px-3 py-1 rounded-lg font-bold text-[11px] transition-all ${
                  splitType === split
                    ? split === 'TEST'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {split === 'ALL'
                  ? 'Full Data'
                  : split === 'TRAIN'
                  ? 'Calibration (60%)'
                  : split === 'VALIDATION'
                  ? 'Validation (20%)'
                  : 'Unseen Test (20%)'}
              </button>
            ))}
          </div>

          <button
            type="button"
            id="run_backtest_btn"
            onClick={handleRunBacktest}
            disabled={isRunning}
            className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center space-x-1.5 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{isRunning ? 'Simulating...' : 'Run Simulation'}</span>
          </button>
        </div>
      </div>

      {/* Unseen Test Data Warning / Notice */}
      {splitType === 'TEST' && (
        <div className="bg-purple-950/30 border border-purple-800/40 rounded-xl p-3 text-xs text-purple-300 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-purple-400 shrink-0" />
          <span>
            <strong>Unseen Test Partition:</strong> Simulating on the final 20% untouched historical slice to test strategy robustness without curve-fitting bias.
          </span>
        </div>
      )}

      {/* Performance Summary Metrics Grid */}
      {stats && (
        <div id="backtest_metrics_grid" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Win Rate */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Win Rate</span>
              <Percent className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl font-black text-white font-mono">{stats.winRate}%</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
              {stats.wins}W / {stats.losses}L / {stats.breakevens}BE
            </div>
          </div>

          {/* Net R Multiples */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Net R Return</span>
              <TrendingUp className={`w-3.5 h-3.5 ${stats.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
            </div>
            <div
              className={`text-xl font-black font-mono ${
                stats.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {stats.netR > 0 ? `+${stats.netR}` : stats.netR} R
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
              Avg {stats.averageR > 0 ? `+${stats.averageR}` : stats.averageR} R / trade
            </div>
          </div>

          {/* Mathematical Expectancy */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Expectancy</span>
              <Award className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div
              className={`text-xl font-black font-mono ${
                stats.expectancy >= 0 ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              {stats.expectancy > 0 ? `+${stats.expectancy}` : stats.expectancy} R
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
              Per trade expected return
            </div>
          </div>

          {/* Profit Factor */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Profit Factor</span>
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-xl font-black text-white font-mono">{stats.profitFactor}</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
              Gross Win R / Gross Loss R
            </div>
          </div>

          {/* Max Drawdown */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Max Drawdown</span>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="text-xl font-black text-rose-400 font-mono">
              -{stats.maxDrawdownR} R
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
              Peak to trough drop
            </div>
          </div>

          {/* Sample Size & Filter Ratio */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Filter Discipline</span>
              <Flame className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl font-black text-zinc-200 font-mono">
              {stats.executedTradesCount} <span className="text-xs text-zinc-500 font-normal">trades</span>
            </div>
            <div className="text-[10px] text-zinc-400 font-mono mt-0.5 truncate">
              {stats.noTradeCount + stats.rejectedSetupsCount} Filtered (No Trade)
            </div>
          </div>
        </div>
      )}

      {/* Equity Curve & Split Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-zinc-800">
            <div>
              <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                Cumulative R Equity Curve
              </h3>
              <p className="text-[11px] text-zinc-400">
                Track growth across historical sequence without compounding distortion.
              </p>
            </div>
            {stats && (
              <span className="text-xs font-mono font-bold text-zinc-300">
                Net: {stats.netR > 0 ? `+${stats.netR}` : stats.netR} R
              </span>
            )}
          </div>

          {renderEquityCurve()}
        </div>

        {/* Breakdown Panel */}
        <div className="lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider pb-2 border-b border-zinc-800">
              System Filter Statistics
            </h3>

            {stats && (
              <div className="space-y-2.5 mt-3 text-xs">
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-400">Total Opportunities Evaluated:</span>
                  <span className="font-mono font-bold text-zinc-200">{stats.totalSetups}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-emerald-400">Valid Setups Triggered:</span>
                  <span className="font-mono font-bold text-emerald-400">{stats.validSetupsCount}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-amber-400">Wait (Filter Deferred):</span>
                  <span className="font-mono font-bold text-amber-400">{stats.waitSetupsCount}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-rose-400">Rejected Setups:</span>
                  <span className="font-mono font-bold text-rose-400">{stats.rejectedSetupsCount}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-400">No Trade Filter Rate:</span>
                  <span className="font-mono font-bold text-zinc-200">
                    {stats.totalSetups > 0
                      ? `${(((stats.totalSetups - stats.validSetupsCount) / stats.totalSetups) * 100).toFixed(1)}%`
                      : '0%'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-zinc-400">Consecutive Streaks:</span>
                  <span className="font-mono font-bold text-zinc-300">
                    {stats.maxConsecutiveWins} Max Wins / {stats.maxConsecutiveLosses} Max Losses
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-[11px] text-zinc-400 leading-relaxed">
            <span className="font-bold text-zinc-200">Anti-Curve Fitting Notice:</span> Backtest results are calibrated on historical ticks with no look-ahead. Past structural confluence does not guarantee future results.
          </div>
        </div>
      </div>

      {/* Historical Trade Execution Log */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">
              Walk-Forward Trade Log ({filteredTrades.length} Trades)
            </h3>
            <p className="text-xs text-zinc-400">
              Chronological execution order with resolution outcome.
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center space-x-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
            {(['ALL', 'WIN', 'LOSS', 'BREAKEVEN'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setOutcomeFilter(f)}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors ${
                  outcomeFilter === f
                    ? 'bg-zinc-800 text-white border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Trade Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800/80 pb-2">
                <th className="py-2 px-2">#</th>
                <th className="py-2 px-2">Entry Time</th>
                <th className="py-2 px-2">Pair/TF</th>
                <th className="py-2 px-2">Side</th>
                <th className="py-2 px-2">Entry / SL / TP</th>
                <th className="py-2 px-2">Score</th>
                <th className="py-2 px-2">Outcome</th>
                <th className="py-2 px-2 text-right">Realized R</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filteredTrades.map((t, idx) => {
                const isBuy = t.direction === 'BUY';
                const isWin = t.outcome === 'WIN';
                const isLoss = t.outcome === 'LOSS';
                return (
                  <tr
                    key={t.id}
                    className="hover:bg-zinc-800/40 transition-colors cursor-pointer"
                    onClick={() => setSelectedTrade(t)}
                  >
                    <td className="py-2.5 px-2 text-zinc-500">{idx + 1}</td>
                    <td className="py-2.5 px-2 text-zinc-400 font-sans text-[11px]">
                      {new Date(t.entryTimestamp).toLocaleDateString()} {new Date(t.entryTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 px-2 font-bold text-zinc-200">
                      {t.pair} <span className="text-zinc-500 text-[10px] font-normal">{t.timeframe}</span>
                    </td>
                    <td className="py-2.5 px-2 font-bold">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${
                          isBuy ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {isBuy ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-zinc-300 text-[11px]">
                      {t.entryPrice.toFixed(4)} <span className="text-zinc-500">/</span> {t.stopLoss.toFixed(4)} <span className="text-zinc-500">/</span> {t.takeProfit.toFixed(4)}
                    </td>
                    <td className="py-2.5 px-2 font-bold text-blue-400">
                      {t.overallScore}/100
                    </td>
                    <td className="py-2.5 px-2 font-bold">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] ${
                          isWin
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : isLoss
                            ? 'bg-rose-950 text-rose-400 border border-rose-800'
                            : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {t.outcome}
                      </span>
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right font-black ${
                        t.realizedR > 0
                          ? 'text-emerald-400'
                          : t.realizedR < 0
                          ? 'text-rose-400'
                          : 'text-zinc-400'
                      }`}
                    >
                      {t.realizedR > 0 ? `+${t.realizedR}` : t.realizedR} R
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredTrades.length === 0 && (
            <div className="text-center py-8 text-xs text-zinc-500">
              No historical trades matched filter.
            </div>
          )}
        </div>
      </div>

      {/* Trade Detail Modal / Inspector */}
      {selectedTrade && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div>
                <h3 className="font-bold text-zinc-100 text-sm flex items-center space-x-2">
                  <span>Historical Setup Audit: {selectedTrade.pair} ({selectedTrade.timeframe})</span>
                </h3>
                <p className="text-xs text-zinc-400 font-mono">
                  Triggered at {new Date(selectedTrade.entryTimestamp).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTrade(null)}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-950 p-3 rounded-xl border border-zinc-800 text-xs font-mono text-center">
              <div>
                <span className="text-zinc-500 text-[10px] block">Direction</span>
                <span className="font-bold text-zinc-200">{selectedTrade.direction}</span>
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] block">Outcome</span>
                <span className={`font-bold ${selectedTrade.outcome === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedTrade.outcome} ({selectedTrade.realizedR > 0 ? `+${selectedTrade.realizedR}` : selectedTrade.realizedR} R)
                </span>
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] block">Score</span>
                <span className="font-bold text-blue-400">{selectedTrade.overallScore}/100</span>
              </div>
              <div>
                <span className="text-zinc-500 text-[10px] block">Holding Time</span>
                <span className="font-bold text-zinc-200">{selectedTrade.holdingCandles} bars</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Factor Confluences</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {selectedTrade.analysis.factors.map(f => (
                  <div key={f.factorKey} className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 text-xs">
                    <div className="flex justify-between font-bold text-zinc-200 mb-1">
                      <span>{f.factorName}</span>
                      <span className="text-blue-400 font-mono">{f.score}/{f.maxScore}</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 line-clamp-2">{f.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
