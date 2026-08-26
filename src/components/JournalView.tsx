import React, { useState, useMemo } from 'react';
import { JournalEntry, JournalOutcome, JournalStats } from '../types/journal';
import { JournalStorage } from '../services/journal/JournalStorage';
import {
  BookOpen,
  Award,
  TrendingUp,
  Percent,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Download,
  Upload,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Check,
  Edit3,
} from 'lucide-react';

interface JournalViewProps {
  entries: JournalEntry[];
  onUpdateEntries: (updated: JournalEntry[]) => void;
  onOpenAnalyzerWithEntry?: (entry: JournalEntry) => void;
}

export const JournalView: React.FC<JournalViewProps> = ({
  entries,
  onUpdateEntries,
  onOpenAnalyzerWithEntry,
}) => {
  const [outcomeFilter, setOutcomeFilter] = useState<string>('ALL');
  const [pairFilter, setPairFilter] = useState<string>('ALL');
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [editOutcome, setEditOutcome] = useState<JournalOutcome>('WIN');
  const [editExitPrice, setEditExitPrice] = useState<number>(0);
  const [editReview, setEditReview] = useState<string>('');

  const stats: JournalStats = useMemo(() => {
    return JournalStorage.calculateStats(entries);
  }, [entries]);

  const uniquePairs = useMemo(() => {
    return Array.from(new Set(entries.map(e => e.pair)));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      if (outcomeFilter !== 'ALL' && e.outcome !== outcomeFilter) return false;
      if (pairFilter !== 'ALL' && e.pair !== pairFilter) return false;
      return true;
    });
  }, [entries, outcomeFilter, pairFilter]);

  const handleUpdateOutcome = (entry: JournalEntry, outcome: JournalOutcome) => {
    const updated = JournalStorage.updateOutcome(entry.id, outcome);
    if (updated) {
      onUpdateEntries(JournalStorage.getEntries());
    }
  };

  const handleSaveModalEdit = () => {
    if (!editingEntry) return;
    const updated = JournalStorage.updateOutcome(
      editingEntry.id,
      editOutcome,
      editExitPrice > 0 ? editExitPrice : undefined,
      editReview
    );
    if (updated) {
      onUpdateEntries(JournalStorage.getEntries());
    }
    setEditingEntry(null);
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this trade journal entry?')) {
      JournalStorage.deleteEntry(id);
      onUpdateEntries(JournalStorage.getEntries());
    }
  };

  const exportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(entries, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `forex_journal_export_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportCSV = () => {
    const headers = ['ID', 'Date', 'Pair', 'Timeframe', 'Direction', 'Entry', 'StopLoss', 'TakeProfit', 'Decision', 'Score', 'RR', 'Outcome', 'RealizedR', 'Notes'];
    const rows = entries.map(e => [
      e.id,
      new Date(e.createdAt).toISOString(),
      e.pair,
      e.timeframe,
      e.direction,
      e.entryPrice,
      e.stopLoss,
      e.takeProfit,
      e.decision,
      e.overallScore,
      e.riskRewardRatio,
      e.outcome,
      e.realizedR || 0,
      `"${(e.userNotes || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a');
    a.setAttribute('href', encodeURI(csvContent));
    a.setAttribute('download', `forex_journal_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div id="journal_main_view" className="space-y-6 pb-20 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-blue-400" />
            <span>Forex Trade Journal & Performance</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Log setups, track realized R-multiples, and review execution psychology.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={exportCSV}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold flex items-center space-x-1.5 border border-zinc-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={exportJSON}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold flex items-center space-x-1.5 border border-zinc-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Win Rate */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
            <span>Realized Win Rate</span>
            <Percent className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono">{stats.winRate}%</div>
          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
            {stats.wins}W - {stats.losses}L - {stats.breakevens}BE
          </div>
        </div>

        {/* Net Realized R */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
            <span>Net Realized R</span>
            <TrendingUp className={`w-3.5 h-3.5 ${stats.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
          </div>
          <div
            className={`text-2xl font-black font-mono ${
              stats.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {stats.netR > 0 ? `+${stats.netR}` : stats.netR} R
          </div>
          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
            Avg {stats.averageR > 0 ? `+${stats.averageR}` : stats.averageR} R / closed trade
          </div>
        </div>

        {/* Expectancy */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
            <span>Trade Expectancy</span>
            <Award className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div
            className={`text-2xl font-black font-mono ${
              stats.expectancy >= 0 ? 'text-amber-400' : 'text-rose-400'
            }`}
          >
            {stats.expectancy > 0 ? `+${stats.expectancy}` : stats.expectancy} R
          </div>
          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
            Statistical edge per execution
          </div>
        </div>

        {/* Valid Setups Win Rate */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] mb-1">
            <span>Valid Setup Hit Rate</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {stats.validSetupsWinRate}%
          </div>
          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
            When strictly following VALID setups
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-zinc-400" />
          <span className="font-semibold text-zinc-300">Filter By:</span>

          <select
            value={outcomeFilter}
            onChange={e => setOutcomeFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-zinc-200 font-medium"
          >
            <option value="ALL">All Outcomes</option>
            <option value="PENDING">Pending (Active)</option>
            <option value="WIN">Wins (TP)</option>
            <option value="LOSS">Losses (SL)</option>
            <option value="BREAKEVEN">Breakeven</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {uniquePairs.length > 0 && (
            <select
              value={pairFilter}
              onChange={e => setPairFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-zinc-200 font-medium"
            >
              <option value="ALL">All Pairs</option>
              {uniquePairs.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
        </div>

        <span className="text-zinc-500 font-mono">
          Showing {filteredEntries.length} of {entries.length} logged setups
        </span>
      </div>

      {/* Journal Cards List */}
      <div className="space-y-3">
        {filteredEntries.map(entry => {
          const isBuy = entry.direction === 'BUY';
          const isPending = entry.outcome === 'PENDING';
          const isWin = entry.outcome === 'WIN';
          const isLoss = entry.outcome === 'LOSS';

          return (
            <div
              key={entry.id}
              id={`journal_entry_${entry.id}`}
              className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-3 transition-all hover:border-zinc-700"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-zinc-800/80">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-bold text-sm text-zinc-100 font-mono">{entry.pair}</span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-blue-400 font-mono text-[10px] font-bold">
                      {entry.timeframe}
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded font-bold text-[10px] ${
                        isBuy ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      {isBuy ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                      {entry.direction}
                    </span>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      entry.decision === 'VALID SETUP'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : entry.decision === 'WAIT'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : 'bg-rose-950 text-rose-300 border border-rose-800'
                    }`}
                  >
                    {entry.decision} ({entry.overallScore}/100)
                  </span>
                </div>

                {/* Outcome Badge & Realized R */}
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-1">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase ${
                        isWin
                          ? 'bg-emerald-500 text-zinc-950'
                          : isLoss
                          ? 'bg-rose-500 text-white'
                          : isPending
                          ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                          : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {entry.outcome}
                    </span>
                    {entry.realizedR !== undefined && (
                      <span
                        className={`text-xs font-mono font-black ${
                          entry.realizedR > 0
                            ? 'text-emerald-400'
                            : entry.realizedR < 0
                            ? 'text-rose-400'
                            : 'text-zinc-400'
                        }`}
                      >
                        {entry.realizedR > 0 ? `+${entry.realizedR}` : entry.realizedR} R
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded-lg transition-colors"
                    title="Delete Entry"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Price Details Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-zinc-500 block">Entry Price</span>
                  <span className="text-zinc-200 font-bold">{entry.entryPrice.toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-rose-500/80 block">Stop Loss</span>
                  <span className="text-rose-400 font-bold">{entry.stopLoss.toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-emerald-500/80 block">Take Profit</span>
                  <span className="text-emerald-400 font-bold">{entry.takeProfit.toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">Target R:R</span>
                  <span className="text-zinc-200 font-bold">1 : {entry.riskRewardRatio}</span>
                </div>
              </div>

              {/* Reasoning & Notes */}
              <p className="text-xs text-zinc-300 leading-relaxed">
                {entry.reasoning}
              </p>

              {entry.userNotes && (
                <div className="bg-zinc-950/60 p-2 rounded-lg border border-zinc-800 text-xs text-zinc-300">
                  <span className="font-semibold text-zinc-400">Trade Note: </span>
                  {entry.userNotes}
                </div>
              )}

              {entry.postTradeReview && (
                <div className="bg-blue-950/20 p-2 rounded-lg border border-blue-900/40 text-xs text-blue-200">
                  <span className="font-semibold text-blue-400">Post-Trade Review: </span>
                  {entry.postTradeReview}
                </div>
              )}

              {/* Outcome Action Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/60 text-xs">
                <span className="text-[11px] text-zinc-500">
                  Logged: {new Date(entry.createdAt).toLocaleDateString()} {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                <div className="flex items-center space-x-1.5">
                  {isPending && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleUpdateOutcome(entry, 'WIN')}
                        className="px-2.5 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 text-[11px] font-bold"
                      >
                        + Hit TP (Win)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateOutcome(entry, 'LOSS')}
                        className="px-2.5 py-1 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[11px] font-bold"
                      >
                        - Hit SL (Loss)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateOutcome(entry, 'BREAKEVEN')}
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-bold"
                      >
                        Breakeven
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setEditingEntry(entry);
                      setEditOutcome(entry.outcome);
                      setEditExitPrice(entry.exitPrice || entry.entryPrice);
                      setEditReview(entry.postTradeReview || '');
                    }}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs"
                    title="Edit Outcome Details"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredEntries.length === 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500 text-sm">
            <BookOpen className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
            <p>No journal entries found for current filter.</p>
            <p className="text-xs text-zinc-600 mt-1">Analyze a forex setup and click "Save to Journal" to start logging.</p>
          </div>
        )}
      </div>

      {/* Edit Outcome Modal */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <h3 className="font-bold text-zinc-100 text-sm">
                Review & Close Trade: {editingEntry.pair}
              </h3>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="text-zinc-400 hover:text-zinc-200 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                  Eventual Outcome
                </label>
                <select
                  value={editOutcome}
                  onChange={e => setEditOutcome(e.target.value as JournalOutcome)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-zinc-100"
                >
                  <option value="PENDING">Pending (Active)</option>
                  <option value="WIN">WIN (Full TP / Profit Target)</option>
                  <option value="LOSS">LOSS (Full SL Invalidation)</option>
                  <option value="BREAKEVEN">BREAKEVEN (Exit @ Entry)</option>
                  <option value="CANCELLED">CANCELLED (Did not trigger)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                  Actual Exit Price
                </label>
                <input
                  type="number"
                  step="any"
                  value={editExitPrice}
                  onChange={e => setEditExitPrice(parseFloat(e.target.value) || 0)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-zinc-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                  Post-Trade Reflection & Execution Review
                </label>
                <textarea
                  value={editReview}
                  onChange={e => setEditReview(e.target.value)}
                  rows={3}
                  placeholder="What worked? Did you follow rules? Any premature exits?"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-2.5 text-zinc-100 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModalEdit}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md"
              >
                Save Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
