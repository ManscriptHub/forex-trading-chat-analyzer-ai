import {
  Candle,
  CandleValidationReport,
  CandleGapRecord,
  RejectedCandleRecord,
  PriceScaleInfo,
} from '../../types/market';

export interface ParseAndValidateOptions {
  expectedTimeframe?: string;
  pairSymbol?: string;
  explicitScaleFactor?: number; // Divisor, e.g. 100000 or 1
}

export interface ParseAndValidateResult {
  candles: Candle[];
  report: CandleValidationReport;
}

/**
 * CandleDataValidator
 *
 * Provides institutional-grade data ingestion, deterministic price-scale normalization,
 * and zero-alteration integrity validation for real broker historical candle datasets.
 *
 * DATA INTEGRITY CONTRACT:
 * 1. UNTOUCHED RAW DATA: Genuine historical OHLC prices are NEVER mutated or fabricated.
 *    Raw values are recorded identically in `rawOhlc` on each candle record for full auditability.
 * 2. DETERMINISTIC PRICE SCALE NORMALIZATION:
 *    Detects broker point/integer formats (e.g. 127801.0 for EUR/USD) vs standard decimal format (1.27801)
 *    and converts them via verified scale divisors (100,000, 1,000, 100, or 1.0).
 * 3. REJECTION OF CORRUPT BARS: Any candle with geometrically impossible relationships
 *    (High < Low, High < Open, High < Close, Low > Open, Low > Close) or non-positive prices
 *    is REJECTED from the valid dataset and preserved in `rejectedRowsDetails`.
 * 4. NO LOOKAHEAD INGESTION: Timestamps are sorted strictly ascending (t0 < t1 < ... < tN)
 *    and duplicate timestamps are deduplicated by retaining only the primary chronological bar.
 * 5. GAP DETECTION: Discontinuities (weekends vs. weekday/session gaps) are flagged for analysis
 *    without injecting fabricated/interpolated price candles.
 */
export class CandleDataValidator {
  /**
   * Expected bar interval in milliseconds based on timeframe standard
   */
  public static getTimeframeIntervalMs(tf: string): number {
    const t = tf.toUpperCase();
    if (t === 'M1') return 60 * 1000;
    if (t === 'M5') return 5 * 60 * 1000;
    if (t === 'M15') return 15 * 60 * 1000;
    if (t === 'M30') return 30 * 60 * 1000;
    if (t === 'H1') return 60 * 60 * 1000;
    if (t === 'H4') return 4 * 60 * 60 * 1000;
    if (t === 'D1') return 24 * 60 * 60 * 1000;
    return 60 * 60 * 1000; // Default H1
  }

  /**
   * Auto-detects and parses raw text from MT4/MT5, cTrader, TradingView, CSV or JSON.
   */
  public static parseAndValidate(
    rawText: string,
    optionsOrTimeframe: string | ParseAndValidateOptions = 'H1'
  ): ParseAndValidateResult {
    const options: ParseAndValidateOptions =
      typeof optionsOrTimeframe === 'string'
        ? { expectedTimeframe: optionsOrTimeframe }
        : optionsOrTimeframe;

    const expectedTimeframe = options.expectedTimeframe || 'H1';
    const pairSymbol = options.pairSymbol || 'EUR/USD';
    const explicitScaleFactor = options.explicitScaleFactor;

    const trimmed = rawText.trim();

    if (!trimmed) {
      return {
        candles: [],
        report: {
          isValid: false,
          sourceFormat: 'Unknown',
          totalRowsParsed: 0,
          validCandlesCount: 0,
          rejectedRowsCount: 0,
          duplicateTimestampsFixed: 0,
          chronologicalInversionsFixed: 0,
          impossibleOhlcCount: 0,
          detectedGapsCount: 0,
          detectedGaps: [],
          rejectedRowsDetails: [],
          warnings: [],
          errors: ['Uploaded file or content is empty.'],
        },
      };
    }

    // 1. JSON parsing check
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return this.parseAndValidateJson(trimmed, expectedTimeframe, pairSymbol, explicitScaleFactor);
    }

    // 2. CSV / Delimited text parsing
    return this.parseAndValidateCsv(trimmed, expectedTimeframe, pairSymbol, explicitScaleFactor);
  }

  private static parseAndValidateJson(
    jsonText: string,
    expectedTimeframe: string,
    pairSymbol: string,
    explicitScaleFactor?: number
  ): ParseAndValidateResult {
    let parsed: any;

    try {
      parsed = JSON.parse(jsonText);
    } catch (e: any) {
      return {
        candles: [],
        report: {
          isValid: false,
          sourceFormat: 'JSON Array',
          totalRowsParsed: 0,
          validCandlesCount: 0,
          rejectedRowsCount: 0,
          duplicateTimestampsFixed: 0,
          chronologicalInversionsFixed: 0,
          impossibleOhlcCount: 0,
          detectedGapsCount: 0,
          detectedGaps: [],
          rejectedRowsDetails: [],
          warnings: [],
          errors: [`JSON syntax error: ${e.message}`],
        },
      };
    }

    const rawList = Array.isArray(parsed) ? parsed : parsed.candles || parsed.data || parsed.bars || [];
    if (!Array.isArray(rawList) || rawList.length === 0) {
      return {
        candles: [],
        report: {
          isValid: false,
          sourceFormat: 'JSON Array',
          totalRowsParsed: 0,
          validCandlesCount: 0,
          rejectedRowsCount: 0,
          duplicateTimestampsFixed: 0,
          chronologicalInversionsFixed: 0,
          impossibleOhlcCount: 0,
          detectedGapsCount: 0,
          detectedGaps: [],
          rejectedRowsDetails: [],
          warnings: [],
          errors: ['No candle records found in JSON structure.'],
        },
      };
    }

    const candidateBars: { raw: any; lineNum: number }[] = rawList.map((item, idx) => ({ raw: item, lineNum: idx + 1 }));
    return this.processCandidateBars(
      candidateBars.map(c => this.extractBarFromJson(c.raw, c.lineNum)),
      'JSON Array',
      expectedTimeframe,
      pairSymbol,
      explicitScaleFactor
    );
  }

  private static extractBarFromJson(item: any, lineNum: number): {
    timestamp: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number;
    rawDateStr?: string;
    rawLine?: string;
    lineNum: number;
  } {
    const timeVal = item.timestamp ?? item.time ?? item.t ?? item.datetime ?? item.date;
    let ts: number | null = null;
    if (typeof timeVal === 'number') {
      ts = timeVal > 1e11 ? timeVal : timeVal * 1000;
    } else if (typeof timeVal === 'string') {
      ts = this.parseTimestampString(timeVal);
    }

    const open = this.parseNumeric(item.open ?? item.o);
    const high = this.parseNumeric(item.high ?? item.h);
    const low = this.parseNumeric(item.low ?? item.l);
    const close = this.parseNumeric(item.close ?? item.c);
    const volume = this.parseNumeric(item.volume ?? item.vol ?? item.v) ?? 1000;

    return {
      timestamp: ts,
      open,
      high,
      low,
      close,
      volume,
      rawDateStr: typeof timeVal === 'string' ? timeVal : undefined,
      rawLine: JSON.stringify(item),
      lineNum,
    };
  }

  private static parseAndValidateCsv(
    csvText: string,
    expectedTimeframe: string,
    pairSymbol: string,
    explicitScaleFactor?: number
  ): ParseAndValidateResult {
    const rawLines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (rawLines.length === 0) {
      return {
        candles: [],
        report: {
          isValid: false,
          sourceFormat: 'Unknown',
          totalRowsParsed: 0,
          validCandlesCount: 0,
          rejectedRowsCount: 0,
          duplicateTimestampsFixed: 0,
          chronologicalInversionsFixed: 0,
          impossibleOhlcCount: 0,
          detectedGapsCount: 0,
          detectedGaps: [],
          rejectedRowsDetails: [],
          warnings: [],
          errors: ['CSV file is empty.'],
        },
      };
    }

    // Determine delimiter (comma, semicolon, tab)
    const firstLine = rawLines[0];
    let delimiter = ',';
    if (firstLine.includes('\t') && firstLine.split('\t').length >= 4) {
      delimiter = '\t';
    } else if (firstLine.includes(';') && firstLine.split(';').length >= 4) {
      delimiter = ';';
    }

    // Detect format archetype
    const lowerFirst = firstLine.toLowerCase();
    let detectedSourceFormat: 'MetaTrader 4/5' | 'cTrader' | 'TradingView' | 'Generic CSV' = 'Generic CSV';
    if (lowerFirst.includes('tradingview') || lowerFirst.includes('volume,open') || lowerFirst.includes('time,open')) {
      detectedSourceFormat = 'TradingView';
    } else if (lowerFirst.includes('ctrader') || lowerFirst.includes('timestamp (utc)')) {
      detectedSourceFormat = 'cTrader';
    } else if (lowerFirst.includes('<date>') || lowerFirst.includes('<time>') || lowerFirst.includes('<open>')) {
      detectedSourceFormat = 'MetaTrader 4/5';
    }

    // Determine if first row is header
    let startIdx = 0;
    const firstTokens = firstLine.split(delimiter).map(s => s.trim().replace(/^["']|["']$/g, ''));
    const isFirstRowHeader = isNaN(parseFloat(firstTokens[1])) || isNaN(Date.parse(firstTokens[0]));
    if (isFirstRowHeader) {
      startIdx = 1;
    }

    const rawBars: Array<{
      timestamp: number | null;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
      volume: number;
      rawDateStr?: string;
      rawLine: string;
      lineNum: number;
    }> = [];

    for (let i = startIdx; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue;
      const parts = line.split(delimiter).map(s => s.trim().replace(/^["']|["']$/g, ''));

      let ts: number | null = null;
      let openIdx = 1;
      let highIdx = 2;
      let lowIdx = 3;
      let closeIdx = 4;
      let volIdx = 5;
      let dateString = parts[0];

      if (parts.length >= 6 && this.isTimeString(parts[1])) {
        detectedSourceFormat = 'MetaTrader 4/5';
        dateString = `${parts[0]} ${parts[1]}`;
        openIdx = 2;
        highIdx = 3;
        lowIdx = 4;
        closeIdx = 5;
        volIdx = 6;
      }

      ts = this.parseTimestampString(dateString);

      const open = this.parseNumeric(parts[openIdx]);
      const high = this.parseNumeric(parts[highIdx]);
      const low = this.parseNumeric(parts[lowIdx]);
      const close = this.parseNumeric(parts[closeIdx]);
      const volume = this.parseNumeric(parts[volIdx]) ?? 1000;

      rawBars.push({
        timestamp: ts,
        open,
        high,
        low,
        close,
        volume,
        rawDateStr: dateString,
        rawLine: line,
        lineNum: i + 1,
      });
    }

    return this.processCandidateBars(
      rawBars,
      detectedSourceFormat,
      expectedTimeframe,
      pairSymbol,
      explicitScaleFactor
    );
  }

  private static isTimeString(val: string): boolean {
    if (!val) return false;
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(val.trim());
  }

  private static parseTimestampString(val: string): number | null {
    if (!val) return null;
    const trimmed = val.trim();

    // 1. Numeric unix timestamp
    const num = Number(trimmed);
    if (!isNaN(num) && num > 0) {
      if (num > 1e11) return num;
      if (num > 1e8) return num * 1000;
    }

    // 2. MT4/MT5 Dot notation: "2026.01.15 14:00" or "2012-11-16 00:00:00"
    if (/^\d{4}[\.-]\d{2}[\.-]\d{2}/.test(trimmed)) {
      const normalized = trimmed.replace(/^(\d{4})[\.-](\d{2})[\.-](\d{2})/, '$1-$2-$3');
      const isoCandidate = normalized.includes('T') ? normalized : normalized.replace(' ', 'T') + 'Z';
      const parsedIso = Date.parse(isoCandidate);
      if (!isNaN(parsedIso)) return parsedIso;
      const fallback = Date.parse(normalized);
      if (!isNaN(fallback)) return fallback;
    }

    // 3. cTrader slash format: "05/01/2026 08:00:00" (DD/MM/YYYY)
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0');
      const month = slashMatch[2].padStart(2, '0');
      const year = slashMatch[3];
      const timePart = slashMatch[4] || '00:00:00';
      const isoStr = `${year}-${month}-${day}T${timePart}Z`;
      const parsed = Date.parse(isoStr);
      if (!isNaN(parsed)) return parsed;
    }

    // 4. Standard ISO 8601 or RFC 2822
    const parsedStandard = Date.parse(trimmed);
    if (!isNaN(parsedStandard)) {
      return parsedStandard;
    }

    return null;
  }

  private static parseNumeric(val: any): number | null {
    if (val === undefined || val === null || val === '') return null;
    const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? null : n;
  }

  /**
   * Deterministically determines the original price scaling factor from sample bars.
   * e.g., MetaTrader integer point exports (127801.0 for EUR/USD -> 1.27801 with scale divisor 100,000).
   */
  public static detectPriceScale(
    samplePrices: number[],
    pairSymbol = 'EUR/USD',
    explicitScaleFactor?: number
  ): PriceScaleInfo {
    if (samplePrices.length === 0) {
      return {
        scaleFactor: 1,
        detectedScaleType: 'STANDARD_DECIMAL',
        detectionReason: 'No prices provided; defaulting to 1.0 (Standard Decimal)',
        rawSamplePrice: 1.0,
        normalizedSamplePrice: 1.0,
        rawPriceRange: { min: 1.0, max: 1.0 },
        normalizedPriceRange: { min: 1.0, max: 1.0 },
        wasScaleApplied: false,
      };
    }

    let rawMin = Infinity;
    let rawMax = -Infinity;
    let sum = 0;

    for (const p of samplePrices) {
      if (p < rawMin) rawMin = p;
      if (p > rawMax) rawMax = p;
      sum += p;
    }

    const medianSample = sum / samplePrices.length;
    const isJpy = pairSymbol.toUpperCase().includes('JPY');

    // If explicit user scale factor is specified
    if (explicitScaleFactor !== undefined && explicitScaleFactor > 0) {
      return {
        scaleFactor: explicitScaleFactor,
        detectedScaleType: explicitScaleFactor === 1 ? 'STANDARD_DECIMAL' : 'CUSTOM_SCALE',
        detectionReason: `User specified explicit scaling divisor of ${explicitScaleFactor}`,
        rawSamplePrice: medianSample,
        normalizedSamplePrice: medianSample / explicitScaleFactor,
        rawPriceRange: { min: rawMin, max: rawMax },
        normalizedPriceRange: { min: rawMin / explicitScaleFactor, max: rawMax / explicitScaleFactor },
        wasScaleApplied: explicitScaleFactor !== 1,
      };
    }

    // Heuristic detection based on asset domain and sample magnitude
    if (!isJpy) {
      // For EUR/USD, GBP/USD, AUD/USD, USD/CAD, USD/CHF (normal price 0.5 - 3.0)
      if (medianSample >= 10000 && medianSample <= 500000) {
        const factor = 100000;
        return {
          scaleFactor: factor,
          detectedScaleType: '5_DIGIT_POINTS',
          detectionReason: `Integer/Point format detected (sample ${medianSample.toFixed(1)} converted via divisor 100,000 to standard 5-decimal FX representation ${(medianSample / factor).toFixed(5)})`,
          rawSamplePrice: medianSample,
          normalizedSamplePrice: medianSample / factor,
          rawPriceRange: { min: rawMin, max: rawMax },
          normalizedPriceRange: { min: rawMin / factor, max: rawMax / factor },
          wasScaleApplied: true,
        };
      }
    } else {
      // For JPY pairs (USD/JPY, EUR/JPY, GBP/JPY normal price 50 - 250)
      if (medianSample >= 50000 && medianSample <= 500000) {
        const factor = 1000;
        return {
          scaleFactor: factor,
          detectedScaleType: '3_DIGIT_JPY_POINTS',
          detectionReason: `3-Digit JPY Point format detected (sample ${medianSample.toFixed(1)} converted via divisor 1,000 to standard JPY decimal representation ${(medianSample / factor).toFixed(3)})`,
          rawSamplePrice: medianSample,
          normalizedSamplePrice: medianSample / factor,
          rawPriceRange: { min: rawMin, max: rawMax },
          normalizedPriceRange: { min: rawMin / factor, max: rawMax / factor },
          wasScaleApplied: true,
        };
      } else if (medianSample >= 5000 && medianSample < 50000) {
        const factor = 100;
        return {
          scaleFactor: factor,
          detectedScaleType: '2_DIGIT_CENTS_POINTS',
          detectionReason: `2-Digit Point format detected (sample ${medianSample.toFixed(1)} converted via divisor 100 to standard representation ${(medianSample / factor).toFixed(2)})`,
          rawSamplePrice: medianSample,
          normalizedSamplePrice: medianSample / factor,
          rawPriceRange: { min: rawMin, max: rawMax },
          normalizedPriceRange: { min: rawMin / factor, max: rawMax / factor },
          wasScaleApplied: true,
        };
      }
    }

    // Default standard decimal
    return {
      scaleFactor: 1,
      detectedScaleType: 'STANDARD_DECIMAL',
      detectionReason: `Standard decimal format detected (sample price ${medianSample.toFixed(5)} within expected floating point range)`,
      rawSamplePrice: medianSample,
      normalizedSamplePrice: medianSample,
      rawPriceRange: { min: rawMin, max: rawMax },
      normalizedPriceRange: { min: rawMin, max: rawMax },
      wasScaleApplied: false,
    };
  }

  /**
   * Rigorous normalization & validation pipeline
   * Strictly enforces data integrity: corrupted bars are REJECTED, not silently altered.
   * Raw values are preserved intact alongside normalized decimal representations.
   */
  private static processCandidateBars(
    rawBars: Array<{
      timestamp: number | null;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
      volume: number;
      rawDateStr?: string;
      rawLine?: string;
      lineNum: number;
    }>,
    sourceFormat: 'MetaTrader 4/5' | 'cTrader' | 'TradingView' | 'Generic CSV' | 'JSON Array' | 'Unknown',
    expectedTimeframe: string,
    pairSymbol = 'EUR/USD',
    explicitScaleFactor?: number
  ): ParseAndValidateResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    const rejectedRowsDetails: RejectedCandleRecord[] = [];

    let rejectedRowsCount = 0;
    let impossibleOhlcCount = 0;

    // First collect valid numerical samples to establish price scaling
    const validSamplePrices: number[] = [];
    for (const b of rawBars) {
      if (b.open !== null && b.open > 0) validSamplePrices.push(b.open);
      if (validSamplePrices.length >= 100) break;
    }

    const priceScaleInfo = this.detectPriceScale(validSamplePrices, pairSymbol, explicitScaleFactor);
    const divisor = priceScaleInfo.scaleFactor;

    if (priceScaleInfo.wasScaleApplied) {
      warnings.push(`[Price Normalization Audit] ${priceScaleInfo.detectionReason}`);
    }

    const preliminaryValidBars: Candle[] = [];

    // Validate OHLC geometric integrity and reject invalid records without altering prices
    for (const b of rawBars) {
      // Check timestamp validity
      if (b.timestamp === null || isNaN(b.timestamp) || b.timestamp <= 0) {
        rejectedRowsCount++;
        const reason = `Invalid or missing timestamp (${b.rawDateStr || 'null'})`;
        rejectedRowsDetails.push({
          lineNum: b.lineNum,
          rawText: b.rawLine || b.rawDateStr,
          reason,
          ohlc: { open: b.open, high: b.high, low: b.low, close: b.close },
        });
        warnings.push(`Row ${b.lineNum}: ${reason}. Row rejected.`);
        continue;
      }

      // Check missing price fields
      if (b.open === null || b.high === null || b.low === null || b.close === null) {
        rejectedRowsCount++;
        const reason = 'Missing one or more OHLC price values';
        rejectedRowsDetails.push({
          lineNum: b.lineNum,
          rawText: b.rawLine,
          reason,
          ohlc: { open: b.open, high: b.high, low: b.low, close: b.close },
        });
        warnings.push(`Row ${b.lineNum}: ${reason}. Row rejected.`);
        continue;
      }

      // Check positive numeric price domain
      if (b.open <= 0 || b.high <= 0 || b.low <= 0 || b.close <= 0) {
        rejectedRowsCount++;
        const reason = `Non-positive price value detected (O=${b.open}, H=${b.high}, L=${b.low}, C=${b.close})`;
        rejectedRowsDetails.push({
          lineNum: b.lineNum,
          rawText: b.rawLine,
          reason,
          ohlc: { open: b.open, high: b.high, low: b.low, close: b.close },
        });
        warnings.push(`Row ${b.lineNum}: ${reason}. Row rejected.`);
        continue;
      }

      const rawOpen = b.open;
      const rawHigh = b.high;
      const rawLow = b.low;
      const rawClose = b.close;

      // Check impossible OHLC geometric relationships in raw prices
      if (rawHigh < rawLow) {
        rejectedRowsCount++;
        impossibleOhlcCount++;
        const reason = `Fatal geometric violation: High (${rawHigh}) is strictly less than Low (${rawLow})`;
        rejectedRowsDetails.push({
          lineNum: b.lineNum,
          rawText: b.rawLine,
          reason,
          ohlc: { open: rawOpen, high: rawHigh, low: rawLow, close: rawClose },
        });
        warnings.push(`Row ${b.lineNum}: ${reason}. Row rejected.`);
        continue;
      }

      if (rawHigh < rawOpen || rawHigh < rawClose) {
        rejectedRowsCount++;
        impossibleOhlcCount++;
        const reason = `Geometric violation: High (${rawHigh}) is less than Open (${rawOpen}) or Close (${rawClose})`;
        rejectedRowsDetails.push({
          lineNum: b.lineNum,
          rawText: b.rawLine,
          reason,
          ohlc: { open: rawOpen, high: rawHigh, low: rawLow, close: rawClose },
        });
        warnings.push(`Row ${b.lineNum}: ${reason}. Row rejected.`);
        continue;
      }

      if (rawLow > rawOpen || rawLow > rawClose) {
        rejectedRowsCount++;
        impossibleOhlcCount++;
        const reason = `Geometric violation: Low (${rawLow}) is greater than Open (${rawOpen}) or Close (${rawClose})`;
        rejectedRowsDetails.push({
          lineNum: b.lineNum,
          rawText: b.rawLine,
          reason,
          ohlc: { open: rawOpen, high: rawHigh, low: rawLow, close: rawClose },
        });
        warnings.push(`Row ${b.lineNum}: ${reason}. Row rejected.`);
        continue;
      }

      // Convert to normalized decimal price representation
      const open = rawOpen / divisor;
      const high = rawHigh / divisor;
      const low = rawLow / divisor;
      const close = rawClose / divisor;

      // Post-normalization geometric check confirmation
      if (high < low || high < open || high < close || low > open || low > close) {
        rejectedRowsCount++;
        impossibleOhlcCount++;
        const reason = `Post-normalization invariant check failure`;
        rejectedRowsDetails.push({
          lineNum: b.lineNum,
          rawText: b.rawLine,
          reason,
          ohlc: { open: rawOpen, high: rawHigh, low: rawLow, close: rawClose },
        });
        warnings.push(`Row ${b.lineNum}: ${reason}. Row rejected.`);
        continue;
      }

      preliminaryValidBars.push({
        timestamp: b.timestamp,
        open,
        high,
        low,
        close,
        volume: b.volume,
        datetime: new Date(b.timestamp).toISOString(),
        rawOhlc: {
          open: rawOpen,
          high: rawHigh,
          low: rawLow,
          close: rawClose,
        },
      });
    }

    if (preliminaryValidBars.length === 0) {
      return {
        candles: [],
        report: {
          isValid: false,
          sourceFormat,
          totalRowsParsed: rawBars.length,
          validCandlesCount: 0,
          rejectedRowsCount,
          duplicateTimestampsFixed: 0,
          chronologicalInversionsFixed: 0,
          impossibleOhlcCount,
          detectedGapsCount: 0,
          detectedGaps: [],
          rejectedRowsDetails,
          priceScaleInfo,
          warnings,
          errors: ['No valid OHLC candle records could be extracted from the file.'],
        },
      };
    }

    // Check & Enforce Chronological Sorting
    let chronologicalInversionsFixed = 0;
    let isMonotonic = true;
    for (let i = 1; i < preliminaryValidBars.length; i++) {
      if (preliminaryValidBars[i].timestamp < preliminaryValidBars[i - 1].timestamp) {
        isMonotonic = false;
        chronologicalInversionsFixed++;
      }
    }

    const sortedBars = [...preliminaryValidBars];
    if (!isMonotonic) {
      sortedBars.sort((a, b) => a.timestamp - b.timestamp);
      warnings.push(`Detected ${chronologicalInversionsFixed} out-of-sequence chronological inversions. Array sorted strictly ascending.`);
    }

    // Deduplicate duplicate timestamps: Preserve primary bar, reject subsequent duplicate timestamps
    let duplicateTimestampsFixed = 0;
    const deduplicatedBars: Candle[] = [];
    const seenTimestamps = new Set<number>();

    for (const bar of sortedBars) {
      if (seenTimestamps.has(bar.timestamp)) {
        duplicateTimestampsFixed++;
        rejectedRowsCount++;
        rejectedRowsDetails.push({
          lineNum: 0,
          reason: `Duplicate timestamp: ${bar.datetime} (${bar.timestamp}) already exists in dataset`,
          ohlc: bar.rawOhlc || { open: bar.open, high: bar.high, low: bar.low, close: bar.close },
        });
      } else {
        seenTimestamps.add(bar.timestamp);
        deduplicatedBars.push(bar);
      }
    }

    if (duplicateTimestampsFixed > 0) {
      warnings.push(`Rejected ${duplicateTimestampsFixed} duplicate timestamp entries to maintain strict temporal uniqueness.`);
    }

    // Timezone & Span Metadata
    const startTime = deduplicatedBars[0]?.datetime;
    const endTime = deduplicatedBars[deduplicatedBars.length - 1]?.datetime;

    // Recalculate exact min and max ranges from deduplicated valid bars
    let minRawPrice = Infinity;
    let maxRawPrice = -Infinity;
    let minNormPrice = Infinity;
    let maxNormPrice = -Infinity;

    for (const bar of deduplicatedBars) {
      if (bar.rawOhlc) {
        if (bar.rawOhlc.low < minRawPrice) minRawPrice = bar.rawOhlc.low;
        if (bar.rawOhlc.high > maxRawPrice) maxRawPrice = bar.rawOhlc.high;
      }
      if (bar.low < minNormPrice) minNormPrice = bar.low;
      if (bar.high > maxNormPrice) maxNormPrice = bar.high;
    }

    priceScaleInfo.rawPriceRange = { min: minRawPrice, max: maxRawPrice };
    priceScaleInfo.normalizedPriceRange = { min: minNormPrice, max: maxNormPrice };

    // Gap Detection (Reporting discontinuities without fabricating candles)
    const expectedIntervalMs = this.getTimeframeIntervalMs(expectedTimeframe);
    const detectedGaps: CandleGapRecord[] = [];

    for (let i = 1; i < deduplicatedBars.length; i++) {
      const prev = deduplicatedBars[i - 1];
      const curr = deduplicatedBars[i];
      const deltaMs = curr.timestamp - prev.timestamp;

      if (deltaMs > expectedIntervalMs * 1.5) {
        const prevDate = new Date(prev.timestamp);
        const currDate = new Date(curr.timestamp);
        const prevDay = prevDate.getUTCDay();
        const currDay = currDate.getUTCDay();

        const isWeekend =
          (prevDay === 5 && (currDay === 0 || currDay === 1)) ||
          (deltaMs <= 72 * 60 * 60 * 1000 && (prevDay === 5 || prevDay === 6));

        detectedGaps.push({
          fromIndex: i - 1,
          toIndex: i,
          fromDate: prev.datetime || prevDate.toISOString(),
          toDate: curr.datetime || currDate.toISOString(),
          gapMinutes: Math.round(deltaMs / (60 * 1000)),
          isWeekend,
        });
      }
    }

    if (detectedGaps.length > 0) {
      const nonWeekendGaps = detectedGaps.filter(g => !g.isWeekend);
      if (nonWeekendGaps.length > 0) {
        warnings.push(`Detected ${nonWeekendGaps.length} intraday/weekday data gaps in time series.`);
      }
    }

    const isValid = deduplicatedBars.length >= 35;
    if (!isValid) {
      errors.push(`Insufficient candle depth: ${deduplicatedBars.length} valid bars parsed (minimum 35 required for 200 EMA and indicator warmup).`);
    }

    return {
      candles: deduplicatedBars,
      report: {
        isValid,
        sourceFormat,
        totalRowsParsed: rawBars.length,
        validCandlesCount: deduplicatedBars.length,
        rejectedRowsCount,
        duplicateTimestampsFixed,
        chronologicalInversionsFixed,
        impossibleOhlcCount,
        detectedGapsCount: detectedGaps.length,
        detectedGaps,
        rejectedRowsDetails,
        priceScaleInfo,
        rawPriceRange: { min: minRawPrice, max: maxRawPrice },
        normalizedPriceRange: { min: minNormPrice, max: maxNormPrice },
        startTime,
        endTime,
        timeframeDetected: expectedTimeframe,
        warnings,
        errors,
      },
    };
  }
}
