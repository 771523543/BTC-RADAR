export type Market = "spot" | "futures";
export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type Candle = { time: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
export type Level = { price: number; side: "support" | "resistance"; touches: number; timeframes: string[]; strength: string; flipped: boolean; score: number };

const hosts = (market: Market) => market === "futures"
  ? ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com", "https://fapi3.binance.com"]
  : ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com", "https://api4.binance.com"];

export async function binance<T>(market: Market, path: string): Promise<T> {
  let last: unknown;
  for (const host of hosts(market)) {
    try {
      const response = await fetch(host + path, { cache: "no-store" });
      if (!response.ok) throw new Error(host + " HTTP " + response.status);
      return await response.json() as T;
    } catch (error) { last = error; }
  }
  throw last instanceof Error ? last : new Error("تعذر الاتصال بواجهات Binance");
}

export function parseCandles(rows: unknown[][]): Candle[] {
  return rows.map((r) => ({ time: Number(r[0]), closeTime: Number(r[6]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) }));
}
export function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = Array(period - 1).fill(0);
  result.push(previous);
  for (let i = period; i < values.length; i++) { previous = values[i] * k + previous * (1 - k); result.push(previous); }
  return result;
}
export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; if (d > 0) gain += d; else loss -= d; }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) { const d = values[i] - values[i - 1]; avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period; avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period; }
  return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
}
export function atr(candles: Candle[], period = 14): number {
  const recent = candles.slice(-period);
  if (!recent.length) return 0;
  return recent.reduce((sum, c, i) => { const prev = i ? recent[i - 1].close : c.open; return sum + Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)); }, 0) / recent.length;
}
function frameLevels(candles: Candle[], frame: string, tolerance: number): Level[] {
  const c = candles
    .filter(x => Number.isFinite(x.open) && Number.isFinite(x.high) && Number.isFinite(x.low) && Number.isFinite(x.close) && x.closeTime < Date.now())
    .slice(-240);
  if (c.length < 25) return [];

  // Confirm pivots only after two candles have formed on both sides.
  const pivots: { price: number; side: "support" | "resistance"; index: number; time: number }[] = [];
  for (let i = 2; i < c.length - 2; i++) {
    const w = c.slice(i - 2, i + 3);
    const highs = w.map(x => x.high), lows = w.map(x => x.low);
    if (c[i].high === Math.max(...highs) && highs.filter(x => x === c[i].high).length === 1) {
      pivots.push({ price: c[i].high, side: "resistance", index: i, time: c[i].time });
    }
    if (c[i].low === Math.min(...lows) && lows.filter(x => x === c[i].low).length === 1) {
      pivots.push({ price: c[i].low, side: "support", index: i, time: c[i].time });
    }
  }

  // Cluster around a stable weighted centre instead of allowing sequential
  // matches to drift a zone away from the actual swing prices.
  const clusters: { side: "support" | "resistance"; prices: number[]; indexes: number[]; times: string[] }[] = [];
  for (const pivot of pivots) {
    let best: typeof clusters[number] | undefined;
    let bestDistance = Infinity;
    for (const group of clusters) {
      if (group.side !== pivot.side) continue;
      const centre = group.prices.reduce((sum, value) => sum + value, 0) / group.prices.length;
      const distance = Math.abs(centre - pivot.price);
      if (distance <= tolerance && distance < bestDistance) { best = group; bestDistance = distance; }
    }
    if (!best) clusters.push({ side: pivot.side, prices: [pivot.price], indexes: [pivot.index], times: [frame] });
    else { best.prices.push(pivot.price); best.indexes.push(pivot.index); }
  }

  const result: Level[] = [];
  for (const group of clusters) {
    const centre = group.prices.reduce((sum, value) => sum + value, 0) / group.prices.length;
    const interactions: number[] = [];
    let lastInteraction = -10;
    for (let i = 0; i < c.length; i++) {
      if (c[i].high >= lower && c[i].low <= upper && i - lastInteraction > 2) {
        interactions.push(i);
        lastInteraction = i;
      }
    }

    // A touch is more meaningful when price rejects the zone afterwards.
    const rangeAtr = atr(c.slice(Math.max(0, c.length - 30)));
    let reactions = 0;
    for (const index of interactions) {
      const later = c.slice(index + 1, Math.min(c.length, index + 4));
      const rejected = later.some(bar => group.side === "support"
        ? bar.close >= centre + rangeAtr * 0.35
        : bar.close <= centre - rangeAtr * 0.35);
      if (rejected) reactions++;
    }
    const touchCount = Math.max(interactions.length, group.indexes.length);
    const recency = group.indexes.length
      ? Math.max(...group.indexes) / Math.max(1, c.length - 1)
      : 0;
    const score = touchCount + reactions * 0.75 + recency;
    result.push({
      price: centre,
      side: group.side,
      touches: touchCount,
      timeframes: [frame],
      strength: score >= 10 ? "قوية" : score >= 5 ? "متوسطة" : "مراقبة",
      score,
      flipped: false,
    });
  }
  return result;
}
export function calculateLevels(current: Candle[], h1: Candle[], h4: Candle[], price: number, currentFrame: string = "15m") {
  const closed = (items: Candle[]) => items.filter(x => x.closeTime < Date.now()).slice(-240);
  const currentClosed = closed(current);
  const baseAtr = atr(currentClosed);
  // Volatility controls zone width; small timeframe-specific price floors prevent
  // low-volatility candles from producing zero-width zones without making 1m/5m
  // levels as wide as higher-timeframe levels.
  const toleranceFor = (items: Candle[], floorPct: number) => Math.max(atr(closed(items)) * 0.35, price > 0 ? price * floorPct : 0);
  const currentTolerance = toleranceFor(current, 0.00018);
  const h1Tolerance = toleranceFor(h1, 0.00028);
  const h4Tolerance = toleranceFor(h4, 0.0004);
  const all = [
    ...frameLevels(current, currentFrame, currentTolerance),
    ...frameLevels(h1, "1h", h1Tolerance),
    ...frameLevels(h4, "4h", h4Tolerance),
  ].sort((a, b) => a.price - b.price);

  // Merge only nearby zones, using a conservative cross-timeframe tolerance.
  const mergeTolerance = Math.max(price > 0 ? price * 0.0002 : 0, Math.min(currentTolerance, h1Tolerance, h4Tolerance) * 0.8);
  const merged: Level[] = [];
  for (const item of all) {
    const found = merged.find(x => x.side === item.side && Math.abs(x.price - item.price) <= mergeTolerance);
    if (!found) merged.push({ ...item });
    else {
      const totalTouches = found.touches + item.touches;
      found.price = (found.price * found.touches + item.price * item.touches) / totalTouches;
      found.touches = totalTouches;
      found.score += item.score;
      if (!found.timeframes.includes(item.timeframes[0])) found.timeframes.push(item.timeframes[0]);
    }
  }
  merged.forEach(x => {
    const frameBonus = x.timeframes.length >= 3 ? 2 : x.timeframes.length === 2 ? 1 : 0;
    const score = x.score + frameBonus;
    x.score = score;
    x.strength = score >= 12 ? "قوية" : score >= 6 ? "متوسطة" : "مراقبة";
    x.flipped = (x.side === "support" && x.price > price) || (x.side === "resistance" && x.price < price);
  });
  return {
    all: merged,
    // Show the nearest zones on each side of the live price, while preserving
    // each pivot's original identity for breakout/breakdown event detection.
    resistance: merged.filter(x => x.price > price).map(x => ({ ...x, flipped: x.side === "support" })).sort((a, b) => a.price - b.price).slice(0, 4),
    support: merged.filter(x => x.price < price).map(x => ({ ...x, flipped: x.side === "resistance" })).sort((a, b) => b.price - a.price).slice(0, 4),
    atr: baseAtr,
  };
}