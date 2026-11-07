export type Market = "spot" | "futures";
export type Interval = "5m" | "15m" | "1h" | "4h" | "1d";
export type Candle = { time: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
export type Level = { price: number; side: "support" | "resistance"; touches: number; timeframes: string[]; strength: string; lower: number; upper: number; flipped: boolean };

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
  const c = candles.filter(x => x.closeTime < Date.now()).slice(-240);
  if (c.length < 25) return [];
  const pivots: { price: number; side: "support" | "resistance" }[] = [];
  for (let i = 2; i < c.length - 2; i++) {
    const w = c.slice(i - 2, i + 3);
    if (c[i].high === Math.max(...w.map(x => x.high)) && w.filter(x => x.high === c[i].high).length === 1) pivots.push({ price: c[i].high, side: "resistance" });
    if (c[i].low === Math.min(...w.map(x => x.low)) && w.filter(x => x.low === c[i].low).length === 1) pivots.push({ price: c[i].low, side: "support" });
  }
  const groups: Level[] = [];
  for (const p of pivots) {
    const found = groups.find(x => x.side === p.side && Math.abs(x.price - p.price) <= tolerance);
    if (found) { found.price = (found.price * found.touches + p.price) / (found.touches + 1); found.touches++; }
    else groups.push({ price: p.price, side: p.side, touches: 1, timeframes: [frame], strength: "مراقبة", lower: p.price - tolerance * .35, upper: p.price + tolerance * .35, flipped: false });
  }
  for (const g of groups) {
    let hits = 0, last = -10;
    c.forEach((x, i) => { if (x.high >= g.price - tolerance * .55 && x.low <= g.price + tolerance * .55 && i - last > 2) { hits++; last = i; } });
    g.touches = Math.max(g.touches, hits);
  }
  return groups;
}
export function calculateLevels(current: Candle[], h1: Candle[], h4: Candle[], price: number) {
  const baseAtr = atr(current.filter(x => x.closeTime < Date.now()).slice(-240));
  const tolerance = Math.max(baseAtr * .35, price * .0008);
  const all = [...frameLevels(current, "15m", tolerance), ...frameLevels(h1, "1h", tolerance), ...frameLevels(h4, "4h", tolerance)].sort((a, b) => a.price - b.price);
  const merged: Level[] = [];
  for (const item of all) {
    const found = merged.find(x => x.side === item.side && Math.abs(x.price - item.price) <= tolerance);
    if (!found) merged.push({ ...item });
    else { found.price = (found.price * found.touches + item.price * item.touches) / (found.touches + item.touches); found.touches += item.touches; if (!found.timeframes.includes(item.timeframes[0])) found.timeframes.push(item.timeframes[0]); }
  }
  merged.forEach(x => { x.lower = x.price - tolerance * .45; x.upper = x.price + tolerance * .45; x.strength = x.touches >= 7 ? "قوية" : x.touches >= 3 ? "متوسطة" : "مراقبة"; x.flipped = (x.side === "support" && x.price > price) || (x.side === "resistance" && x.price < price); });
  return {
    all: merged,
    // Display levels by their current position relative to price, while keeping
    // the original pivot side in `all` for breakout / breakdown detection.
    // This makes a broken resistance appear as support, and a broken support
    // appear as resistance, without losing the original level identity.
    resistance: merged.filter(x => x.price > price).sort((a, b) => a.price - b.price).slice(0, 4),
    support: merged.filter(x => x.price < price).sort((a, b) => b.price - a.price).slice(0, 4),
    atr: baseAtr,
  };
}
