import { SetupInput, TradeDirection } from '../../types/analyzer';
import { Timeframe } from '../../types/market';

export interface ParsedChatSetup {
  input: Partial<SetupInput>;
  confidence: number;
  extractedText: string;
  matchedFields: string[];
}

export function parseChatPrompt(text: string): ParsedChatSetup {
  const result: Partial<SetupInput> = {};
  const matchedFields: string[] = [];
  const clean = text.trim();

  // 1. Detect Pair
  const pairRegex = /(EUR\/?USD|GBP\/?USD|USD\/?JPY|AUD\/?USD|USD\/?CAD|USD\/?CHF|NZD\/?USD|EUR\/?JPY|GBP\/?JPY|XAU\/?USD|GOLD)/i;
  const pairMatch = clean.match(pairRegex);
  if (pairMatch) {
    let p = pairMatch[1].toUpperCase();
    if (p === 'GOLD') p = 'XAU/USD';
    if (!p.includes('/')) {
      p = `${p.slice(0, 3)}/${p.slice(3)}`;
    }
    result.pair = p;
    matchedFields.push('pair');
  }

  // 2. Detect Timeframe
  const tfRegex = /\b(M1|M5|M15|M30|H1|H4|D1|1M|5M|15M|30M|1H|4H|1D|DAILY|HOUR|15MIN)\b/i;
  const tfMatch = clean.match(tfRegex);
  if (tfMatch) {
    let tf = tfMatch[1].toUpperCase();
    if (tf === '15M' || tf === '15MIN') tf = 'M15';
    else if (tf === '5M') tf = 'M5';
    else if (tf === '1M') tf = 'M1';
    else if (tf === '30M') tf = 'M30';
    else if (tf === '1H' || tf === 'HOUR') tf = 'H1';
    else if (tf === '4H') tf = 'H4';
    else if (tf === '1D' || tf === 'DAILY') tf = 'D1';
    result.timeframe = tf as Timeframe;
    matchedFields.push('timeframe');
  }

  // 3. Detect Direction (Buy/Long vs Sell/Short)
  const dirRegex = /\b(BUY|LONG|BULLISH|SELL|SHORT|BEARISH)\b/i;
  const dirMatch = clean.match(dirRegex);
  if (dirMatch) {
    const d = dirMatch[1].toUpperCase();
    if (d === 'BUY' || d === 'LONG' || d === 'BULLISH') {
      result.direction = 'BUY';
    } else {
      result.direction = 'SELL';
    }
    matchedFields.push('direction');
  }

  // 4. Detect Prices: Entry, Stop Loss (SL), Take Profit (TP / Target)
  const entryRegex = /(?:entry|at|@|price|in)\s*[:=]?\s*(\d+(?:\.\d+)?)/i;
  const slRegex = /(?:sl|stop\s*loss|stop|invalidation)\s*[:=]?\s*(\d+(?:\.\d+)?)/i;
  const tpRegex = /(?:tp|take\s*profit|target|pt)\s*[:=]?\s*(\d+(?:\.\d+)?)/i;

  const entryMatch = clean.match(entryRegex);
  if (entryMatch) {
    result.entryPrice = parseFloat(entryMatch[1]);
    matchedFields.push('entryPrice');
  }

  const slMatch = clean.match(slRegex);
  if (slMatch) {
    result.stopLoss = parseFloat(slMatch[1]);
    matchedFields.push('stopLoss');
  }

  const tpMatch = clean.match(tpRegex);
  if (tpMatch) {
    result.takeProfit = parseFloat(tpMatch[1]);
    matchedFields.push('takeProfit');
  }

  // Fallback: If 3 raw numbers exist and no keywords matched
  if (!result.entryPrice && !result.stopLoss && !result.takeProfit) {
    const allNumbers = clean.match(/\b\d+\.\d+\b/g);
    if (allNumbers && allNumbers.length >= 3) {
      result.entryPrice = parseFloat(allNumbers[0]);
      result.stopLoss = parseFloat(allNumbers[1]);
      result.takeProfit = parseFloat(allNumbers[2]);
      matchedFields.push('entryPrice', 'stopLoss', 'takeProfit');
    }
  }

  const confidence = matchedFields.length / 6; // Pair, TF, Dir, Entry, SL, TP

  return {
    input: result,
    confidence,
    extractedText: clean,
    matchedFields,
  };
}
