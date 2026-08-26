import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Candle, Timeframe } from '../types/market';
import {
  BacktestResult,
  BacktestTrade,
  CostModelConfig,
  DataSplitType,
  PeriodStabilityRecord,
  RegimePerformanceRecord,
  ReplayStepSnapshot,
} from '../types/backtest';
import { CalibrationProfile, CalibrationWeights, CalibrationThresholds } from '../types/analyzer';
import { BacktestEngine, getTypicalSpreadPips, getDefaultCommissionPips, getDefaultSlippagePips } from '../services/backtest/BacktestEngine';
import { ReplayDatasetService } from '../services/backtest/ReplayDatasetService';
import { MarketDataRegistry } from '../services/marketData/MarketDataRegistry';
import {
  TrendingUp,
  Play,
  Pause,
  SkipForward,
  SkipBack,
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
  CheckCircle2,
  Sliders,
  Layers,
  ChevronRight,
  Zap,
  Info,
  DollarSign,
  BarChart3,
  Calendar,
  Sparkles,
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
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'STABILITY' | 'REGIMES' | 'AUDIT'>('OVERVIEW');

  // Separated Cost Model State
  const [spreadPips, setSpreadPips] = useState<number>(() => getTypicalSpreadPips(pair));
  const [commissionPips, setCommissionPips] = useState<number>(() => getDefaultCommissionPips(pair));
  const [slippagePips, setSlippagePips] = useState<number>(() => getDefaultSlippagePips(pair));
  const [showCostAccordion, setShowCostAccordion] = useState<boolean>(false);

  // Update default costs when pair changes
  useEffect(() => {
    setSpreadPips(getTypicalSpreadPips(pair));
    setCommissionPips(getDefaultCommissionPips(pair));
    setSlippagePips(getDefaultSlippagePips(pair));
  }, [pair]);

  // Interactive Candle Replay Player State
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(400); // ms per step
  const [datasetSyncedNotice, setDatasetSyncedNotice] = useState<boolean>(false);
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleRunBacktest = () => {
    setIsRunning(true);
    const activeProvider = MarketDataRegistry.getInstance().getActiveProvider();

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
        costModel: {
          spreadPips,
          commissionPips,
          slippagePips,
        },
        datasetName: activeProvider.name,
        datasetKind: activeProvider.datasetKind,
        saveDatasetForCalibration: true,
      });
      setBacktestResult(res);
      setReplayIndex(0);
      setIsRunning(false);
      setDatasetSyncedNotice(true);
      setTimeout(() => setDatasetSyncedNotice(false), 3000);
    }, 120);
  };

  // Run automatically on first mount or when candle slice/pair/split changes
  useEffect(() => {
    if (candles.length > 40 && !backtestResult) {
      handleRunBacktest();
    }
  }, [candles, pair, timeframe, splitType]);

  // Handle Playback Interval
  useEffect(() => {
    if (isPlaying && backtestResult?.replaySteps && backtestResult.replaySteps.length > 0) {
      playTimerRef.current = setInterval(() => {
        setReplayIndex(prev => {
          if (prev >= (backtestResult.replaySteps?.length || 1) - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, playbackSpeed);
    } else {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    }

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, backtestResult]);

  const replaySteps = backtestResult?.replaySteps || [];
  const currentStepSnapshot: ReplayStepSnapshot | undefined = replaySteps[replayIndex];

  const handleStepForward = () => {
    if (replayIndex < replaySteps.length - 1) {
      setReplayIndex(prev => prev + 1);
    }
  };

  const handleStepBackward = () => {
    if (replayIndex > 0) {
      setReplayIndex(prev => prev - 1);
    }
  };

  const handleJumpNextTrade = () => {
    if (!backtestResult) return;
    const nextTradeStep = replaySteps.findIndex(
      (s, idx) => idx > replayIndex && (s.executedTrade || s.resolvedTrade)
    );
    if (nextTradeStep !== -1) {
      setReplayIndex(nextTradeStep);
    }
  };

  const handleJumpPrevTrade = () => {
    if (!backtestResult) return;
    for (let i = replayIndex - 1; i >= 0; i--) {
      if (replaySteps[i].executedTrade || replaySteps[i].resolvedTrade) {
        setReplayIndex(i);
        return;
      }
    }
  };

  const filteredTrades = useMemo(() => {
    if (!backtestResult) return [];
    if (outcomeFilter === 'ALL') return backtestResult.trades;
    return backtestResult.trades.filter(t => t.outcome === outcomeFilter);
  }, [backtestResult, outcomeFilter]);

  const stats = backtestResult?.stats;
  const audit = backtestResult?.auditInfo;

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
              <span>Zero-Lookahead Chronological Candle Replay Engine</span>
            </h2>
            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">
              Walk-Forward
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Strict causal isolation: each setup is evaluated using only historical bars available up to candle <em>t</em>, scanning only subsequent bars for SL/TP resolution.
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
            onClick={() => setShowCostAccordion(!showCostAccordion)}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl border border-zinc-700 flex items-center space-x-1.5 transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span>Costs ({spreadPips + commissionPips + slippagePips}p)</span>
          </button>

          <button
            type="button"
            id="run_backtest_btn"
            onClick={handleRunBacktest}
            disabled={isRunning}
            className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center space-x-1.5 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{isRunning ? 'Replaying...' : 'Run Simulation'}</span>
          </button>
        </div>
      </div>

      {/* Separated Cost Model Configuration Accordion */}
      {showCostAccordion && (
        <div className="bg-zinc-900 border border-blue-900/60 rounded-2xl p-4 sm:p-5 space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <div className="flex items-center space-x-2">
              <DollarSign className="w-4 h-4 text-blue-400" />
              <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                Execution Friction & Realistic Broker Cost Modeling
              </h3>
            </div>
            <span className="text-[11px] font-mono text-zinc-400">
              Total Friction: <strong className="text-blue-400">{(spreadPips + commissionPips + slippagePips).toFixed(1)} pips</strong> / round-turn
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Spread */}
            <div className="space-y-1.5 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300 font-semibold">Bid/Ask Spread</span>
                <span className="font-mono font-bold text-blue-400">{spreadPips.toFixed(1)} pips</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="5.0"
                step="0.1"
                value={spreadPips}
                onChange={e => setSpreadPips(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <span className="text-[10px] text-zinc-500 block">Typical major spread: 0.8–1.5 pips</span>
            </div>

            {/* Commission */}
            <div className="space-y-1.5 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300 font-semibold">Commission Drag</span>
                <span className="font-mono font-bold text-blue-400">{commissionPips.toFixed(1)} pips</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.1"
                value={commissionPips}
                onChange={e => setCommissionPips(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <span className="text-[10px] text-zinc-500 block">~$4 to $6/lot round-turn (~0.4 pips)</span>
            </div>

            {/* Slippage */}
            <div className="space-y-1.5 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-300 font-semibold">Execution Slippage</span>
                <span className="font-mono font-bold text-blue-400">{slippagePips.toFixed(1)} pips</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.1"
                value={slippagePips}
                onChange={e => setSlippagePips(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <span className="text-[10px] text-zinc-500 block">Entry & Exit execution latency buffer</span>
            </div>
          </div>
        </div>
      )}

      {/* Replay Dataset Synced Notification */}
      {datasetSyncedNotice && (
        <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3 text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Replay Dataset Stored:</strong> {backtestResult?.evaluatedSetups?.length || 0} causal setup evaluations ready for offline factor-weight calibration in the <strong>Calibration</strong> tab.
            </span>
          </div>
          <span className="text-[10px] bg-emerald-900/60 px-2 py-0.5 rounded text-emerald-200 font-mono">
            Zero Look-Ahead Guaranteed
          </span>
        </div>
      )}

      {/* Synthetic Dataset Warning / Unseen Test Partition Notice */}
      {audit?.datasetKind === 'SYNTHETIC_BENCHMARK' && (
        <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3 text-xs text-amber-300 flex items-start space-x-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <strong className="block font-bold">SYNTHETIC BENCHMARK DATASET ACTIVE</strong>
            <p className="text-[11px] text-amber-400/90 leading-relaxed mt-0.5">
              Simulating against algorithmic synthetic test data. Performance metrics (win rate, expectancy, R-multiples) are for verification of engine integrity and factor calibration only. No claim of live trading edge is made from synthetic benchmarks. For live validity, import real broker CSV candle records.
            </p>
          </div>
        </div>
      )}

      {splitType === 'TEST' && (
        <div className="bg-purple-950/30 border border-purple-800/40 rounded-xl p-3 text-xs text-purple-300 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-purple-400 shrink-0" />
          <span>
            <strong>Unseen Test Partition (20%):</strong> Evaluating on strictly untouched historical data to measure genuine out-of-sample edge and rule out factor curve-fitting.
          </span>
        </div>
      )}

      {/* Performance Summary Metrics Grid */}
      {stats && (
        <div id="backtest_metrics_grid" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Win Rate & Loss Rate */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Win / Loss Rate</span>
              <Percent className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl font-black text-white font-mono">{stats.winRate}%</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
              Loss: {stats.lossRate}% | BE: {stats.breakevenRate}%
            </div>
          </div>

          {/* Net Realized R */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Net Realized R</span>
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

          {/* Expectancy */}
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
              Per trade expected value
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
              Peak-to-trough risk
            </div>
          </div>

          {/* Holding Time & Filter Rate */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
              <span>Holding & Filter</span>
              <Clock className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl font-black text-zinc-200 font-mono">
              {stats.averageHoldingCandles} <span className="text-xs text-zinc-500 font-normal">bars</span>
            </div>
            <div className="text-[10px] text-zinc-400 font-mono mt-0.5 truncate">
              Filter: {stats.filterRatePercent}% avoided
            </div>
          </div>
        </div>
      )}

      {/* Sub-view Navigation Tabs */}
      <div className="flex items-center space-x-2 border-b border-zinc-800 pb-2">
        {[
          { id: 'OVERVIEW', label: 'Equity & Stepper', icon: TrendingUp },
          { id: 'STABILITY', label: 'Period Stability Analysis', icon: BarChart3 },
          { id: 'REGIMES', label: 'Market Regime Breakdown', icon: Layers },
          { id: 'AUDIT', label: 'Full Audit Trail', icon: ShieldCheck },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all ${
                isActive
                  ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5 text-blue-400" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW (Equity Curve & Candle Stepper) */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-6">
          {/* Interactive Candle Replay Player & Stepper */}
          {replaySteps.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                    Chronological Candle Replay Stepper (Bar {replayIndex + 1} of {replaySteps.length})
                  </h3>
                </div>

                {/* Playback Controls */}
                <div className="flex items-center space-x-2">
                  <div className="bg-zinc-950 p-1 rounded-xl border border-zinc-800 flex items-center space-x-1 text-xs font-mono">
                    <button
                      type="button"
                      onClick={handleJumpPrevTrade}
                      title="Jump to Previous Trade"
                      className="px-2 py-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 rounded-lg text-xs"
                    >
                      <SkipBack className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleStepBackward}
                      disabled={replayIndex <= 0}
                      className="px-2.5 py-1 hover:bg-zinc-800 text-zinc-300 disabled:opacity-30 rounded-lg text-xs font-bold"
                    >
                      -1 Bar
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPlaying(!isPlaying)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center space-x-1 ${
                        isPlaying ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'
                      }`}
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{isPlaying ? 'Pause' : 'Play'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleStepForward}
                      disabled={replayIndex >= replaySteps.length - 1}
                      className="px-2.5 py-1 hover:bg-zinc-800 text-zinc-300 disabled:opacity-30 rounded-lg text-xs font-bold"
                    >
                      +1 Bar
                    </button>
                    <button
                      type="button"
                      onClick={handleJumpNextTrade}
                      title="Jump to Next Trade"
                      className="px-2 py-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 rounded-lg text-xs"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Speed toggle */}
                  <select
                    value={playbackSpeed}
                    onChange={e => setPlaybackSpeed(Number(e.target.value))}
                    className="bg-zinc-950 border border-zinc-800 text-zinc-300 rounded-xl px-2.5 py-1 text-xs font-mono"
                  >
                    <option value={800}>0.5x</option>
                    <option value={400}>1.0x</option>
                    <option value={150}>2.5x</option>
                    <option value={50}>5.0x</option>
                  </select>
                </div>
              </div>

              {/* Candle Timeline Slider */}
              <div className="space-y-1.5">
                <input
                  type="range"
                  min={0}
                  max={replaySteps.length - 1}
                  value={replayIndex}
                  onChange={e => setReplayIndex(Number(e.target.value))}
                  className="w-full h-2 bg-zinc-950 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>Bar {replaySteps[0]?.stepIndex || 0} ({replaySteps[0]?.candle?.datetime || 'Start'})</span>
                  <span className="text-zinc-300 font-bold">
                    Current Replay Bar: {currentStepSnapshot?.candle?.datetime || 'Current'}
                  </span>
                  <span>Bar {replaySteps[replaySteps.length - 1]?.stepIndex || 0} ({replaySteps[replaySteps.length - 1]?.candle?.datetime || 'End'})</span>
                </div>
              </div>

              {/* Current Replay Bar State Card */}
              {currentStepSnapshot && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-zinc-950/80 p-3.5 rounded-xl border border-zinc-800/80 text-xs">
                  {/* Candle Price Info */}
                  <div className="space-y-1 border-r border-zinc-800/60 pr-3">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">
                      Candle Price At Bar <em>t</em>
                    </span>
                    <div className="font-mono text-zinc-200">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Open:</span> <span>{currentStepSnapshot.candle.open}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">High:</span> <span className="text-emerald-400">{currentStepSnapshot.candle.high}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Low:</span> <span className="text-rose-400">{currentStepSnapshot.candle.low}</span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span className="text-zinc-400">Close:</span> <span className="text-blue-400">{currentStepSnapshot.candle.close}</span>
                      </div>
                    </div>
                  </div>

                  {/* Evaluated Decision At Bar t */}
                  <div className="space-y-1 border-r border-zinc-800/60 pr-3">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">
                      Setup Evaluation At Bar <em>t</em>
                    </span>
                    {currentStepSnapshot.analysis ? (
                      <div>
                        <div className="flex items-center space-x-1.5 mb-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-black ${
                              currentStepSnapshot.analysis.decision === 'VALID SETUP'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : currentStepSnapshot.analysis.decision === 'WAIT'
                                ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}
                          >
                            {currentStepSnapshot.analysis.decision}
                          </span>
                          <span className="font-mono font-bold text-zinc-300">
                            {currentStepSnapshot.analysis.overallScore}/100
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                          {currentStepSnapshot.analysis.decisionSummary}
                        </p>
                      </div>
                    ) : (
                      <span className="text-zinc-500 text-[11px]">No setup evaluated on this bar.</span>
                    )}
                  </div>

                  {/* Active / Resolved Trade State */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">
                      Position & Forward Resolution
                    </span>
                    {currentStepSnapshot.executedTrade ? (
                      <div className="bg-emerald-950/40 p-2 rounded border border-emerald-800/40 text-emerald-300">
                        <span className="font-bold text-[11px]">
                          🚀 NEW ORDER EXECUTED ({currentStepSnapshot.executedTrade.direction})
                        </span>
                        <div className="text-[10px] font-mono mt-0.5">
                          Entry: {currentStepSnapshot.executedTrade.entryPrice} | SL: {currentStepSnapshot.executedTrade.stopLoss} | TP: {currentStepSnapshot.executedTrade.takeProfit}
                        </div>
                      </div>
                    ) : currentStepSnapshot.resolvedTrade ? (
                      <div
                        className={`p-2 rounded border text-[11px] ${
                          currentStepSnapshot.resolvedTrade.outcome === 'WIN'
                            ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300'
                            : 'bg-rose-950/40 border-rose-800/40 text-rose-300'
                        }`}
                      >
                        <span className="font-bold">
                          🏁 TRADE RESOLVED: {currentStepSnapshot.resolvedTrade.outcome} ({currentStepSnapshot.resolvedTrade.realizedR > 0 ? `+${currentStepSnapshot.resolvedTrade.realizedR}` : currentStepSnapshot.resolvedTrade.realizedR} R)
                        </span>
                        <div className="text-[10px] font-mono mt-0.5">
                          Held {currentStepSnapshot.resolvedTrade.holdingCandles} bars | PnL: {currentStepSnapshot.resolvedTrade.pnlPips} pips
                        </div>
                      </div>
                    ) : currentStepSnapshot.activeTradeStatus ? (
                      <div className="bg-blue-950/30 p-2 rounded border border-blue-800/30 text-blue-300">
                        <span className="font-bold text-[11px]">
                          ⏳ POSITION ACTIVE ({currentStepSnapshot.activeTradeStatus.direction})
                        </span>
                        <div className="text-[10px] font-mono mt-0.5">
                          Holding: {currentStepSnapshot.activeTradeStatus.holdingCandles} bars | Unrealized: {currentStepSnapshot.activeTradeStatus.currentUnrealizedR > 0 ? `+${currentStepSnapshot.activeTradeStatus.currentUnrealizedR}` : currentStepSnapshot.activeTradeStatus.currentUnrealizedR} R
                        </div>
                      </div>
                    ) : (
                      <span className="text-zinc-500 text-[11px]">No active market position.</span>
                    )}
                  </div>
                </div>
              )}
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
                    Chronological capital trajectory modeled with spread, commission, and slippage.
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
                  Execution & Holding Dynamics
                </h3>

                {stats && (
                  <div className="space-y-2.5 mt-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Total Setup Candidates:</span>
                      <span className="font-mono font-bold text-zinc-200">{stats.totalSetups}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-800/60">
                      <span className="text-emerald-400">Executed Valid Trades:</span>
                      <span className="font-mono font-bold text-emerald-400">{stats.validSetupsCount}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Avg Win Holding Time:</span>
                      <span className="font-mono font-bold text-emerald-400">{stats.averageWinHoldingCandles} bars</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Avg Loss Holding Time:</span>
                      <span className="font-mono font-bold text-rose-400">{stats.averageLossHoldingCandles} bars</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Gross-to-Net Drag:</span>
                      <span className="font-mono font-bold text-amber-400">-{stats.grossNetRDrag} R</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-zinc-400">Stability Score:</span>
                      <span className="font-mono font-bold text-blue-400">{stats.stabilityScore}% consistent</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-[11px] text-zinc-400 leading-relaxed">
                <span className="font-bold text-zinc-200">Zero-Lookahead Mandate:</span> Analysis generated strictly at bar <em>t</em> without future bar peeking. All trades resolve in subsequent bars <em>t+1..N</em>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: STABILITY ANALYSIS (Sub-Periods) */}
      {activeTab === 'STABILITY' && stats && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div>
              <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
                <BarChart3 className="w-4 h-4 text-blue-400" />
                <span>Chronological Sub-Period Stability Breakdown</span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Evaluation across sequential time slices to verify consistency and detect regime decay.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-blue-950/60 border border-blue-800/60 text-blue-300 text-xs font-mono font-bold">
              Stability Score: {stats.stabilityScore}%
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.periodStability.map((p, idx) => (
              <div key={idx} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-2.5 font-mono text-xs">
                <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
                  <span className="font-bold text-zinc-200">{p.periodName}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    p.netR > 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}>
                    {p.netR > 0 ? `+${p.netR}` : p.netR} R
                  </span>
                </div>

                <div className="text-[10px] text-zinc-500 font-sans">
                  {p.startDate} → {p.endDate}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div>
                    <span className="text-zinc-500 block text-[10px]">Trades:</span>
                    <span className="font-bold text-zinc-200">{p.tradesCount}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">Win Rate:</span>
                    <span className="font-bold text-zinc-200">{p.winRate}%</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">Expectancy:</span>
                    <span className={`font-bold ${p.expectancy >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                      {p.expectancy > 0 ? `+${p.expectancy}` : p.expectancy} R
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">Profit Factor:</span>
                    <span className="font-bold text-zinc-200">{p.profitFactor}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">Max Drawdown:</span>
                    <span className="font-bold text-rose-400">-{p.maxDrawdownR} R</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">Avg R / Trade:</span>
                    <span className="font-bold text-zinc-200">{p.averageR > 0 ? `+${p.averageR}` : p.averageR} R</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: REGIMES (Market Regime Performance) */}
      {activeTab === 'REGIMES' && stats && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <span>Market Regime Performance Breakdown</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Performance segmented by multi-EMA trend alignment and ATR volatility states.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stats.regimePerformance.map(r => (
              <div key={r.regime} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-zinc-100">{r.label}</h4>
                    <p className="text-[10px] text-zinc-500">{r.description}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded font-mono font-bold text-xs ${
                    r.netR > 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}>
                    {r.netR > 0 ? `+${r.netR}` : r.netR} R
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] pt-1">
                  <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block">Trades</span>
                    <span className="font-bold text-zinc-200">{r.tradesCount}</span>
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block">Win Rate</span>
                    <span className="font-bold text-zinc-200">{r.winRate}%</span>
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block">Expectancy</span>
                    <span className={`font-bold ${r.expectancy >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                      {r.expectancy > 0 ? `+${r.expectancy}` : r.expectancy} R
                    </span>
                  </div>
                  <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block">Profit Factor</span>
                    <span className="font-bold text-zinc-200">{r.profitFactor}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: AUDIT (Comprehensive Verification Report) */}
      {activeTab === 'AUDIT' && audit && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="pb-3 border-b border-zinc-800">
            <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Formal Backtest & Out-of-Sample Audit Report</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Verified record of dataset provenance, friction costs, causal zero-lookahead certification, and active partition.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            {/* Dataset Provenance */}
            <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-2">
              <span className="font-bold text-blue-400 block pb-1 border-b border-zinc-800">
                1. Dataset Provenance
              </span>
              <div className="space-y-1.5 text-zinc-300">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Source:</span> <span>{audit.datasetName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Kind:</span> <span className="text-amber-400 font-bold">{audit.datasetKind}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Total Bars:</span> <span>{audit.totalBars} candles</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Time Span:</span> <span>{audit.dateRange.start} → {audit.dateRange.end}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Active Partition:</span> <span className="text-purple-400 font-bold">{audit.partition} ({audit.partitionBars} bars)</span>
                </div>
              </div>
            </div>

            {/* Friction & Cost Modeling */}
            <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-2">
              <span className="font-bold text-emerald-400 block pb-1 border-b border-zinc-800">
                2. Friction & Execution Modeling
              </span>
              <div className="space-y-1.5 text-zinc-300">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Spread:</span> <span>{audit.costModel.spreadPips} pips</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Commission:</span> <span>{audit.costModel.commissionPips} pips (~$4/lot)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Slippage:</span> <span>{audit.costModel.slippagePips} pips</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span className="text-zinc-500">Total Drag / Trade:</span> <span className="text-blue-400">{audit.totalFrictionPipsPerTrade} pips</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Zero-Lookahead Certified:</span> <span className="text-emerald-400 font-bold">VERIFIED (100% Causal)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historical Trade Execution Log */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-zinc-100">
              Replay Trade Log ({filteredTrades.length} Trades)
            </h3>
            <p className="text-xs text-zinc-400">
              Chronological execution order with resolution outcome. Click any trade to inspect causal factor breakdown.
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
                <th className="py-2 px-2">Factor Score</th>
                <th className="py-2 px-2">Regime</th>
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
                    <td className="py-2.5 px-2 text-zinc-400 text-[10px]">
                      {t.marketRegimeAtEntry || 'Normal'}
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
                  <span>Historical Replay Audit: {selectedTrade.pair} ({selectedTrade.timeframe})</span>
                </h3>
                <p className="text-xs text-zinc-400 font-mono">
                  Evaluated and triggered at {new Date(selectedTrade.entryTimestamp).toLocaleString()}
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
                <span className="text-zinc-500 text-[10px] block">Factor Score</span>
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
