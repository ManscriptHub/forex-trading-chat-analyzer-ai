import React from 'react';
import { Activity, BookOpen, BarChart3, Sliders, Database, MessageSquare, Sparkles } from 'lucide-react';

export type ActiveTab = 'analyzer' | 'journal' | 'backtest' | 'factor_audit' | 'calibration' | 'market_data' | 'chat';

interface NavigationProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  journalCount?: number;
  currentSession?: string;
  dataStatus?: 'AVAILABLE' | 'DATA_UNAVAILABLE';
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  journalCount = 0,
  currentSession = 'London',
  dataStatus = 'AVAILABLE',
}) => {
  const tabs = [
    { id: 'analyzer' as ActiveTab, label: 'Analyzer', icon: Activity },
    { id: 'chat' as ActiveTab, label: 'Chat Parser', icon: MessageSquare },
    { id: 'backtest' as ActiveTab, label: 'Backtest', icon: BarChart3 },
    { id: 'factor_audit' as ActiveTab, label: 'Factor Audit', icon: Sparkles },
    { id: 'calibration' as ActiveTab, label: 'Calibration', icon: Sliders },
    { id: 'journal' as ActiveTab, label: 'Journal', icon: BookOpen, count: journalCount },
    { id: 'market_data' as ActiveTab, label: 'Data', icon: Database },
  ];

  return (
    <>
      {/* Desktop & Tablet Top Header */}
      <header id="app_header" className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-md shadow-blue-500/20 border border-blue-400/30">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-zinc-100 text-sm tracking-tight">Forex Chat Analyzer</span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                  V1.0
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">
                Transparent Multi-Factor Setup Audit & Zero-Bias Backtesting
              </p>
            </div>
          </div>

          {/* Desktop Navigation Pills */}
          <nav className="hidden md:flex items-center space-x-1 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`nav_tab_${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-400' : 'text-zinc-400'}`} />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="px-1.5 py-0.2 bg-blue-500/20 text-blue-300 text-[10px] rounded-full border border-blue-500/30">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Status Indicators */}
          <div className="flex items-center space-x-2.5 text-xs">
            <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[11px] text-zinc-400">Session:</span>
              <span className="font-semibold text-zinc-200">{currentSession}</span>
            </div>

            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium ${
                dataStatus === 'AVAILABLE'
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60'
                  : 'bg-rose-950/40 text-rose-300 border-rose-800/60'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  dataStatus === 'AVAILABLE' ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              <span>{dataStatus === 'AVAILABLE' ? 'Data Ready' : 'Data Unavailable'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Fixed Bar */}
      <nav id="mobile_bottom_nav" className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-950/95 backdrop-blur-lg border-t border-zinc-800/80 px-2 py-1.5 pb-safe">
        <div className="grid grid-cols-6 gap-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`mobile_nav_${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex flex-col items-center justify-center py-1.5 px-1 rounded-lg transition-colors ${
                  isActive ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-5 h-5 mb-0.5" />
                <span className="text-[10px] font-medium tracking-tight truncate max-w-[50px]">{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="absolute top-1 right-1 px-1 bg-blue-500 text-white text-[9px] font-bold rounded-full min-w-[14px] text-center">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
