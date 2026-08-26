import React from 'react';
import { CheckCircle2, Clock, XCircle, ShieldAlert, AlertTriangle } from 'lucide-react';
import { SetupDecision } from '../types/analyzer';

interface DecisionBannerProps {
  decision: SetupDecision;
  overallScore: number;
  summary: string;
  keyStrengths?: string[];
  keyWeaknesses?: string[];
}

export const DecisionBanner: React.FC<DecisionBannerProps> = ({
  decision,
  overallScore,
  summary,
  keyStrengths = [],
  keyWeaknesses = [],
}) => {
  const getDecisionStyle = () => {
    switch (decision) {
      case 'VALID SETUP':
        return {
          bg: 'bg-emerald-950/40 border-emerald-500/50',
          badge: 'bg-emerald-500 text-zinc-950',
          text: 'text-emerald-300',
          icon: CheckCircle2,
          border: 'border-emerald-500/30',
          glow: 'shadow-emerald-950/30 shadow-lg',
          accent: 'text-emerald-400',
        };
      case 'WAIT':
        return {
          bg: 'bg-amber-950/40 border-amber-500/50',
          badge: 'bg-amber-500 text-zinc-950',
          text: 'text-amber-300',
          icon: Clock,
          border: 'border-amber-500/30',
          glow: 'shadow-amber-950/30 shadow-lg',
          accent: 'text-amber-400',
        };
      case 'REJECT':
        return {
          bg: 'bg-rose-950/40 border-rose-500/50',
          badge: 'bg-rose-500 text-white',
          text: 'text-rose-300',
          icon: XCircle,
          border: 'border-rose-500/30',
          glow: 'shadow-rose-950/30 shadow-lg',
          accent: 'text-rose-400',
        };
      case 'NO TRADE':
      default:
        return {
          bg: 'bg-zinc-900/80 border-zinc-700/60',
          badge: 'bg-zinc-700 text-zinc-200',
          text: 'text-zinc-300',
          icon: ShieldAlert,
          border: 'border-zinc-700/40',
          glow: 'shadow-zinc-950/30 shadow-lg',
          accent: 'text-zinc-400',
        };
    }
  };

  const style = getDecisionStyle();
  const Icon = style.icon;

  return (
    <div
      id="decision_banner_card"
      className={`rounded-2xl border p-4 sm:p-5 transition-all ${style.bg} ${style.border} ${style.glow}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-center`}>
            <Icon className={`w-6 h-6 ${style.accent}`} />
          </div>
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
              System Assessment
            </div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">{decision}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${style.badge}`}>
                {overallScore}/100 Confluence
              </span>
            </div>
          </div>
        </div>

        {/* Notice to never confuse score with win rate */}
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-400">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Rule-based confluence score. Never a guaranteed win rate or signal.</span>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-sm leading-relaxed text-zinc-200">{summary}</p>
      </div>

      {(keyStrengths.length > 0 || keyWeaknesses.length > 0) && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-zinc-800/60 text-xs">
          {keyStrengths.length > 0 && (
            <div className="bg-zinc-950/40 rounded-xl p-3 border border-emerald-950/60">
              <div className="font-semibold text-emerald-400 mb-1.5 flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Key Confluences</span>
              </div>
              <ul className="space-y-1 text-zinc-300">
                {keyStrengths.slice(0, 3).map((s, idx) => (
                  <li key={idx} className="leading-snug truncate" title={s}>
                    • {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {keyWeaknesses.length > 0 && (
            <div className="bg-zinc-950/40 rounded-xl p-3 border border-rose-950/60">
              <div className="font-semibold text-rose-400 mb-1.5 flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                <span>Frictional Risks & Invalidation</span>
              </div>
              <ul className="space-y-1 text-zinc-300">
                {keyWeaknesses.slice(0, 3).map((w, idx) => (
                  <li key={idx} className="leading-snug truncate" title={w}>
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
