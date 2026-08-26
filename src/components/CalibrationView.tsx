import React, { useState } from 'react';
import {
  CalibrationProfile,
  CalibrationThresholds,
  CalibrationWeights,
  FactorKey,
} from '../types/analyzer';
import { DEFAULT_PROFILES, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from '../services/analyzer/SetupAnalyzerEngine';
import { Sliders, RotateCcw, Save, Check, Sparkles, AlertCircle, Layers } from 'lucide-react';

interface CalibrationViewProps {
  weights: CalibrationWeights;
  thresholds: CalibrationThresholds;
  onUpdateWeights: (w: CalibrationWeights) => void;
  onUpdateThresholds: (t: CalibrationThresholds) => void;
  onSelectProfile: (p: CalibrationProfile) => void;
}

const FACTOR_LABELS: { key: FactorKey; label: string; desc: string }[] = [
  { key: 'marketStructure', label: 'Market Structure & Swings', desc: 'BOS, CHoCH, and Swing High/Low protection' },
  { key: 'supportResistance', label: 'Support / Resistance Confluence', desc: 'Key horizontal levels, anchor zones, and barrier safety' },
  { key: 'trend', label: 'Trend Alignment (20/50/200 EMA)', desc: 'Multi-EMA moving average stack and institutional slope' },
  { key: 'riskReward', label: 'Risk/Reward Ratio Geometry', desc: 'Asymmetry of target pips vs invalidation stop loss' },
  { key: 'liquidity', label: 'Liquidity & Sweeps', desc: 'Equal high/low sweeps and stop hunt rejections' },
  { key: 'momentum', label: 'Momentum & RSI Health', desc: 'RSI 14 momentum expansion zone and absence of divergence' },
  { key: 'volatility', label: 'Volatility & ATR Sizing', desc: 'ATR proportionality and invalidation breathing room' },
  { key: 'tradingSession', label: 'Trading Session Window', desc: 'London / NY overlap vs dead Asian/off-hours spread risks' },
];

export const CalibrationView: React.FC<CalibrationViewProps> = ({
  weights,
  thresholds,
  onUpdateWeights,
  onUpdateThresholds,
  onSelectProfile,
}) => {
  const [activeProfileId, setActiveProfileId] = useState<string>('balanced_institutional');
  const [isSavedNotice, setIsSavedNotice] = useState<boolean>(false);

  const totalWeight: number = (Object.values(weights) as number[]).reduce((a, b) => a + b, 0);

  const handleWeightChange = (key: FactorKey, value: number) => {
    onUpdateWeights({
      ...weights,
      [key]: value,
    });
  };

  const handleApplyPreset = (profile: CalibrationProfile) => {
    setActiveProfileId(profile.id);
    onSelectProfile(profile);
    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 2000);
  };

  const handleResetDefaults = () => {
    onUpdateWeights(DEFAULT_WEIGHTS);
    onUpdateThresholds(DEFAULT_THRESHOLDS);
    setActiveProfileId('balanced_institutional');
  };

  return (
    <div id="calibration_main_view" className="space-y-6 pb-20 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-blue-400" />
            <span>8-Factor Weights & Decision Thresholds Calibration</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure factor importance and decision sensitivity for backtesting and live setup scoring.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold flex items-center space-x-1.5 border border-zinc-700 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
        </div>
      </div>

      {/* Preset Profiles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
            Strategy Calibration Presets
          </h3>
          {isSavedNotice && (
            <span className="text-xs text-emerald-400 font-bold flex items-center space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Preset Applied</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {DEFAULT_PROFILES.map(profile => {
            const isSelected = activeProfileId === profile.id;
            return (
              <div
                key={profile.id}
                onClick={() => handleApplyPreset(profile)}
                className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-blue-950/30 border-blue-500/60 shadow-lg shadow-blue-950/40'
                    : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="text-xs font-bold text-zinc-100">{profile.name}</h4>
                  {isSelected && (
                    <span className="w-2 h-2 rounded-full bg-blue-400 shadow-sm shadow-blue-400" />
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">
                  {profile.description}
                </p>
                <div className="flex items-center space-x-2 text-[10px] font-mono text-zinc-400 pt-2 border-t border-zinc-800">
                  <span>VALID: ≥{profile.thresholds.validScoreThreshold}%</span>
                  <span>•</span>
                  <span>Min R:R: {profile.thresholds.minRiskRewardRatio}:1</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Factor Weights Sliders */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div>
              <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                Individual Factor Weight Allocation
              </h3>
              <p className="text-[11px] text-zinc-400">
                Adjust points awarded to each institutional factor.
              </p>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-1 bg-zinc-950 rounded-lg border border-zinc-800 text-zinc-300">
              Total Sum: {totalWeight} pts
            </span>
          </div>

          <div className="space-y-4">
            {FACTOR_LABELS.map(({ key, label, desc }) => {
              const val = weights[key];
              const pct = totalWeight > 0 ? ((val / totalWeight) * 100).toFixed(1) : '0';
              return (
                <div key={key} className="space-y-1.5 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-zinc-200">{label}</span>
                      <p className="text-[10px] text-zinc-400">{desc}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-mono font-black text-blue-400">{val} pts</span>
                      <span className="text-[10px] text-zinc-500 font-mono block">({pct}%)</span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="35"
                    step="1"
                    value={val}
                    onChange={e => handleWeightChange(key, parseInt(e.target.value))}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Decision Sensitivity & Thresholds */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider pb-3 border-b border-zinc-800">
              Decision Thresholds
            </h3>

            <div className="space-y-4 text-xs">
              {/* VALID Score Threshold */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-300 font-medium">VALID Setup Cutoff</span>
                  <span className="font-mono font-bold text-emerald-400">
                    ≥ {thresholds.validScoreThreshold}%
                  </span>
                </div>
                <input
                  type="range"
                  min="55"
                  max="90"
                  step="1"
                  value={thresholds.validScoreThreshold}
                  onChange={e =>
                    onUpdateThresholds({
                      ...thresholds,
                      validScoreThreshold: parseInt(e.target.value),
                    })
                  }
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <span className="text-[10px] text-zinc-400 block">
                  Setups at or above this score trigger VALID SETUP.
                </span>
              </div>

              {/* WAIT Score Threshold */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-300 font-medium">WAIT Setup Cutoff</span>
                  <span className="font-mono font-bold text-amber-400">
                    ≥ {thresholds.waitScoreThreshold}%
                  </span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="70"
                  step="1"
                  value={thresholds.waitScoreThreshold}
                  onChange={e =>
                    onUpdateThresholds({
                      ...thresholds,
                      waitScoreThreshold: parseInt(e.target.value),
                    })
                  }
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <span className="text-[10px] text-zinc-400 block">
                  Setups between {thresholds.waitScoreThreshold}% and {thresholds.validScoreThreshold}% trigger WAIT.
                </span>
              </div>

              {/* Min Risk Reward Ratio */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-300 font-medium">Minimum Risk/Reward</span>
                  <span className="font-mono font-bold text-blue-400">
                    1 : {thresholds.minRiskRewardRatio}
                  </span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="3.5"
                  step="0.1"
                  value={thresholds.minRiskRewardRatio}
                  onChange={e =>
                    onUpdateThresholds({
                      ...thresholds,
                      minRiskRewardRatio: parseFloat(e.target.value),
                    })
                  }
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <span className="text-[10px] text-zinc-400 block">
                  Rejects setups with reward ratio below this threshold.
                </span>
              </div>

              {/* Toggle: Hard Reject on Opposing HTF Trend */}
              <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                <span className="text-zinc-300 font-medium">Reject on HTF Trend Conflict</span>
                <input
                  type="checkbox"
                  checked={thresholds.rejectOnOpposingHTFTrend}
                  onChange={e =>
                    onUpdateThresholds({
                      ...thresholds,
                      rejectOnOpposingHTFTrend: e.target.checked,
                    })
                  }
                  className="w-4 h-4 rounded bg-zinc-950 border-zinc-700 text-blue-600 focus:ring-0 cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-xs text-zinc-400 space-y-2">
            <div className="flex items-center space-x-1.5 font-bold text-zinc-200">
              <AlertCircle className="w-4 h-4 text-blue-400" />
              <span>Three-Way Data Validation Rule</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              When fine-tuning weights, always calibrate on Training data (60%), test variations on Validation data (20%), and evaluate the final model ONLY on Unseen Test data (20%).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
