import React from 'react';
import {
  TrendingUp,
  Layers,
  Zap,
  Activity,
  Anchor,
  Droplets,
  Clock,
  Scale,
  CheckCircle,
  AlertCircle,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { FactorScore, FactorStatus } from '../types/analyzer';

interface FactorCardProps {
  factor: FactorScore;
}

const FACTOR_ICONS: Record<string, React.ElementType> = {
  trend: TrendingUp,
  marketStructure: Layers,
  momentum: Zap,
  volatility: Activity,
  supportResistance: Anchor,
  liquidity: Droplets,
  tradingSession: Clock,
  riskReward: Scale,
};

export const FactorCard: React.FC<FactorCardProps> = ({ factor }) => {
  const Icon = FACTOR_ICONS[factor.factorKey] || HelpCircle;

  const getStatusBadge = (status: FactorStatus) => {
    switch (status) {
      case 'PASS':
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
          icon: CheckCircle,
          label: 'PASS',
          bar: 'bg-emerald-500',
        };
      case 'WARNING':
        return {
          bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
          icon: AlertCircle,
          label: 'WARN',
          bar: 'bg-amber-500',
        };
      case 'FAIL':
        return {
          bg: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
          icon: XCircle,
          label: 'FAIL',
          bar: 'bg-rose-500',
        };
      case 'NEUTRAL':
      default:
        return {
          bg: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
          icon: Activity,
          label: 'NEUTRAL',
          bar: 'bg-blue-500',
        };
    }
  };

  const badge = getStatusBadge(factor.status);
  const StatusIcon = badge.icon;
  const percentage = Math.min(100, Math.max(0, (factor.score / factor.maxScore) * 100));

  return (
    <div
      id={`factor_card_${factor.factorKey}`}
      className="bg-zinc-900/70 hover:bg-zinc-900 transition-colors border border-zinc-800/80 rounded-xl p-3.5 flex flex-col justify-between"
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 shrink-0">
              <Icon className="w-4 h-4 text-zinc-200" />
            </div>
            <div className="truncate">
              <h4 className="text-xs font-bold text-zinc-100 truncate">{factor.factorName}</h4>
              <span className="text-[10px] text-zinc-400 font-mono">
                Weight: {factor.weight}%
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            <span
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${badge.bg}`}
            >
              <StatusIcon className="w-3 h-3" />
              <span>{badge.label}</span>
            </span>
            <span className="text-xs font-mono font-bold text-zinc-200">
              {factor.score}/{factor.maxScore}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-zinc-950 h-1.5 rounded-full overflow-hidden mb-2.5 border border-zinc-800/50">
          <div
            className={`h-full transition-all duration-300 ${badge.bar}`}
            style={{ width: `${percentage}%` }}
          />
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-300 line-clamp-3">
          {factor.reasoning}
        </p>
      </div>
    </div>
  );
};
