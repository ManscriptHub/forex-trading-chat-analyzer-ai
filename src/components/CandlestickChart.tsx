import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Candle } from '../types/market';
import { TradeDirection } from '../types/analyzer';
import { computeIndicatorSnapshot } from '../services/analyzer/technicalIndicators';
import { Eye, EyeOff } from 'lucide-react';

interface CandlestickChartProps {
  candles: Candle[];
  pair: string;
  timeframe: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  direction?: TradeDirection;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  candles,
  pair,
  timeframe,
  entryPrice,
  stopLoss,
  takeProfit,
  direction = 'BUY',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(600);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showEMAs, setShowEMAs] = useState<boolean>(true);
  const [showSR, setShowSR] = useState<boolean>(true);

  // Resize observer for responsive width
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width > 50) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Use last 45 candles for clean viewing on mobile
  const visibleCandles = useMemo(() => {
    return candles.slice(-50);
  }, [candles]);

  const indicators = useMemo(() => {
    return computeIndicatorSnapshot(visibleCandles);
  }, [visibleCandles]);

  const height = 260;
  const padding = { top: 20, right: 65, bottom: 25, left: 10 };
  const chartWidth = Math.max(300, containerWidth - padding.left - padding.right);
  const chartHeight = height - padding.top - padding.bottom;

  // Price Extents
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (visibleCandles.length === 0) {
      return { minPrice: 1.0, maxPrice: 1.1, priceRange: 0.1 };
    }

    let min = Math.min(...visibleCandles.map(c => c.low));
    let max = Math.max(...visibleCandles.map(c => c.high));

    if (entryPrice) {
      min = Math.min(min, entryPrice);
      max = Math.max(max, entryPrice);
    }
    if (stopLoss) {
      min = Math.min(min, stopLoss);
      max = Math.max(max, stopLoss);
    }
    if (takeProfit) {
      min = Math.min(min, takeProfit);
      max = Math.max(max, takeProfit);
    }

    const margin = (max - min) * 0.08 || 0.001;
    return {
      minPrice: min - margin,
      maxPrice: max + margin,
      priceRange: max - min + margin * 2,
    };
  }, [visibleCandles, entryPrice, stopLoss, takeProfit]);

  const getY = (price: number) => {
    if (priceRange === 0) return chartHeight / 2;
    return chartHeight - ((price - minPrice) / priceRange) * chartHeight;
  };

  const candleCount = visibleCandles.length;
  const candleSpacing = chartWidth / (candleCount || 1);
  const candleBodyWidth = Math.max(2, Math.min(10, candleSpacing * 0.7));

  // Generate price grid ticks
  const priceTicks = useMemo(() => {
    const ticks = [];
    const count = 5;
    for (let i = 0; i <= count; i++) {
      const p = minPrice + (priceRange / count) * i;
      ticks.push(p);
    }
    return ticks;
  }, [minPrice, priceRange]);

  const formatPrice = (p: number) => {
    if (pair.includes('JPY')) return p.toFixed(2);
    if (pair.includes('XAU')) return p.toFixed(1);
    return p.toFixed(4);
  };

  const activeCandle = hoverIndex !== null && visibleCandles[hoverIndex]
    ? visibleCandles[hoverIndex]
    : visibleCandles[visibleCandles.length - 1];

  return (
    <div id="candlestick_chart_wrapper" className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3 sm:p-4">
      {/* Header with quick toggles & OHLC readout */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2 border-b border-zinc-800/80 text-xs">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-zinc-100 font-mono text-sm">{pair}</span>
          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-blue-400 font-mono text-[11px] font-bold">
            {timeframe}
          </span>
          {indicators.currentSession && (
            <span className="hidden sm:inline-block text-[11px] text-zinc-400 font-medium">
              • {indicators.currentSession.name}
            </span>
          )}
        </div>

        {/* OHLC Bar Readout */}
        {activeCandle && (
          <div className="flex items-center space-x-2 font-mono text-[11px] text-zinc-400">
            <span>O: <span className="text-zinc-200">{formatPrice(activeCandle.open)}</span></span>
            <span>H: <span className="text-zinc-200">{formatPrice(activeCandle.high)}</span></span>
            <span>L: <span className="text-zinc-200">{formatPrice(activeCandle.low)}</span></span>
            <span>C: <span className={activeCandle.close >= activeCandle.open ? 'text-emerald-400' : 'text-rose-400'}>
              {formatPrice(activeCandle.close)}
            </span></span>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowEMAs(!showEMAs)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center space-x-1 ${
              showEMAs ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
            }`}
          >
            {showEMAs ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span>EMAs</span>
          </button>
          <button
            onClick={() => setShowSR(!showSR)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center space-x-1 ${
              showSR ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
            }`}
          >
            {showSR ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span>S/R Zones</span>
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div ref={containerRef} className="relative w-full overflow-hidden select-none">
        <svg
          width={containerWidth}
          height={height}
          className="cursor-crosshair"
          onMouseMove={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left - padding.left;
            const idx = Math.floor(x / candleSpacing);
            if (idx >= 0 && idx < candleCount) {
              setHoverIndex(idx);
            }
          }}
          onMouseLeave={() => setHoverIndex(null)}
          onTouchMove={e => {
            if (!e.touches[0]) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.touches[0].clientX - rect.left - padding.left;
            const idx = Math.floor(x / candleSpacing);
            if (idx >= 0 && idx < candleCount) {
              setHoverIndex(idx);
            }
          }}
        >
          <g transform={`translate(${padding.left}, ${padding.top})`}>
            {/* Horizontal Grid lines */}
            {priceTicks.map((p, idx) => {
              const y = getY(p);
              return (
                <g key={idx}>
                  <line
                    x1={0}
                    y1={y}
                    x2={chartWidth}
                    y2={y}
                    stroke="#27272a"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                  <text
                    x={chartWidth + 6}
                    y={y + 3}
                    fill="#71717a"
                    fontSize={10}
                    fontFamily="monospace"
                  >
                    {formatPrice(p)}
                  </text>
                </g>
              );
            })}

            {/* Support & Resistance zones */}
            {showSR && indicators.supportLevels.slice(0, 2).map((sup, idx) => {
              const y = getY(sup);
              return (
                <line
                  key={`sup_${idx}`}
                  x1={0}
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="#10b981"
                  strokeWidth={1.5}
                  strokeOpacity={0.4}
                  strokeDasharray="4 2"
                />
              );
            })}

            {showSR && indicators.resistanceLevels.slice(0, 2).map((res, idx) => {
              const y = getY(res);
              return (
                <line
                  key={`res_${idx}`}
                  x1={0}
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  strokeOpacity={0.4}
                  strokeDasharray="4 2"
                />
              );
            })}

            {/* Risk / Reward Zones Shading */}
            {entryPrice && stopLoss && (
              <rect
                x={0}
                y={Math.min(getY(entryPrice), getY(stopLoss))}
                width={chartWidth}
                height={Math.abs(getY(entryPrice) - getY(stopLoss))}
                fill="#ef4444"
                fillOpacity={0.08}
              />
            )}
            {entryPrice && takeProfit && (
              <rect
                x={0}
                y={Math.min(getY(entryPrice), getY(takeProfit))}
                width={chartWidth}
                height={Math.abs(getY(entryPrice) - getY(takeProfit))}
                fill="#10b981"
                fillOpacity={0.08}
              />
            )}

            {/* Setup Price Lines */}
            {entryPrice && (
              <g>
                <line
                  x1={0}
                  y1={getY(entryPrice)}
                  x2={chartWidth}
                  y2={getY(entryPrice)}
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <text
                  x={chartWidth - 5}
                  y={getY(entryPrice) - 4}
                  fill="#38bdf8"
                  fontSize={9}
                  fontWeight="bold"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  ENTRY {formatPrice(entryPrice)}
                </text>
              </g>
            )}

            {stopLoss && (
              <g>
                <line
                  x1={0}
                  y1={getY(stopLoss)}
                  x2={chartWidth}
                  y2={getY(stopLoss)}
                  stroke="#f43f5e"
                  strokeWidth={1.5}
                />
                <text
                  x={chartWidth - 5}
                  y={getY(stopLoss) - 4}
                  fill="#f43f5e"
                  fontSize={9}
                  fontWeight="bold"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  SL {formatPrice(stopLoss)}
                </text>
              </g>
            )}

            {takeProfit && (
              <g>
                <line
                  x1={0}
                  y1={getY(takeProfit)}
                  x2={chartWidth}
                  y2={getY(takeProfit)}
                  stroke="#10b981"
                  strokeWidth={1.5}
                />
                <text
                  x={chartWidth - 5}
                  y={getY(takeProfit) - 4}
                  fill="#10b981"
                  fontSize={9}
                  fontWeight="bold"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  TP {formatPrice(takeProfit)}
                </text>
              </g>
            )}

            {/* EMAs Curves */}
            {showEMAs && indicators.ema20.length > 0 && (
              <path
                d={visibleCandles.map((c, i) => {
                  const x = i * candleSpacing + candleSpacing / 2;
                  const y = getY(indicators.ema20[i] || c.close);
                  return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ')}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1.2}
                strokeOpacity={0.8}
              />
            )}
            {showEMAs && indicators.ema50.length > 0 && (
              <path
                d={visibleCandles.map((c, i) => {
                  const x = i * candleSpacing + candleSpacing / 2;
                  const y = getY(indicators.ema50[i] || c.close);
                  return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ')}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={1.2}
                strokeOpacity={0.8}
              />
            )}
            {showEMAs && indicators.ema200.length > 0 && (
              <path
                d={visibleCandles.map((c, i) => {
                  const x = i * candleSpacing + candleSpacing / 2;
                  const y = getY(indicators.ema200[i] || c.close);
                  return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ')}
                fill="none"
                stroke="#a855f7"
                strokeWidth={1.4}
                strokeOpacity={0.85}
              />
            )}

            {/* Candlesticks */}
            {visibleCandles.map((c, i) => {
              const x = i * candleSpacing + candleSpacing / 2;
              const isBull = c.close >= c.open;
              const openY = getY(c.open);
              const closeY = getY(c.close);
              const highY = getY(c.high);
              const lowY = getY(c.low);

              const color = isBull ? '#10b981' : '#f43f5e';
              const top = Math.min(openY, closeY);
              const height = Math.max(1.5, Math.abs(closeY - openY));

              return (
                <g key={i}>
                  {/* High/Low Wick */}
                  <line
                    x1={x}
                    y1={highY}
                    x2={x}
                    y2={lowY}
                    stroke={color}
                    strokeWidth={1}
                  />
                  {/* Candle Body */}
                  <rect
                    x={x - candleBodyWidth / 2}
                    y={top}
                    width={candleBodyWidth}
                    height={height}
                    fill={color}
                    rx={0.5}
                  />
                </g>
              );
            })}

            {/* Crosshair when hovering */}
            {hoverIndex !== null && hoverIndex < candleCount && (
              <g>
                <line
                  x1={hoverIndex * candleSpacing + candleSpacing / 2}
                  y1={0}
                  x2={hoverIndex * candleSpacing + candleSpacing / 2}
                  y2={chartHeight}
                  stroke="#a1a1aa"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              </g>
            )}
          </g>
        </svg>
      </div>

      {/* Legend below chart */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-zinc-800/60 text-[10px] text-zinc-400">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
            <span>Bull Bar</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />
            <span>Bear Bar</span>
          </span>
          {showEMAs && (
            <>
              <span className="flex items-center space-x-1 text-blue-400">
                <span className="w-2 h-0.5 bg-blue-500 inline-block" />
                <span>20 EMA</span>
              </span>
              <span className="flex items-center space-x-1 text-amber-400">
                <span className="w-2 h-0.5 bg-amber-500 inline-block" />
                <span>50 EMA</span>
              </span>
              <span className="flex items-center space-x-1 text-purple-400">
                <span className="w-2 h-0.5 bg-purple-500 inline-block" />
                <span>200 EMA</span>
              </span>
            </>
          )}
        </div>
        <span className="text-zinc-400 font-mono">
          Last 50 bars • {indicators.marketStructure} Structure
        </span>
      </div>
    </div>
  );
};
