"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, RadioTower, TrendingDown, TrendingUp, Wifi, WifiOff } from "lucide-react";

type Market = "spot" | "futures";
type Interval = "5m" | "15m" | "1h" | "4h" | "1d";
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Ticker = { lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; volume: string };

const intervals: Interval[] = ["5m", "15m", "1h", "4h", "1d"];
const format = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
const endpoint = (market: Market) => market === "futures" ? "https://fapi.binance.com" : "https://api.binance.com";

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json() as Promise<T>;
}

function findLevels(candles: Candle[], price: number) {
  const pivots: { price: number; side: "support" | "resistance"; touches: number }[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    const isHigh = c.high > candles[i - 1].high && c.high > candles[i - 2].high && c.high >= candles[i + 1].high && c.high >= candles[i + 2].high;
    const isLow = c.low < candles[i - 1].low && c.low < candles[i - 2].low && c.low <= candles[i + 1].low && c.low <= candles[i + 2].low;
    if (isHigh) pivots.push({ price: c.high, side: "resistance", touches: 1 });
    if (isLow) pivots.push({ price: c.low, side: "support", touches: 1 });
  }
  const merged: typeof pivots = [];
  const tolerance = price * 0.0015;
  for (const pivot of pivots) {
    const match = merged.find((item) => item.side === pivot.side && Math.abs(item.price - pivot.price) <= tolerance);
    if (match) {
      match.price = (match.price * match.touches + pivot.price) / (match.touches + 1);
      match.touches++;
    } else merged.push({ ...pivot });
  }
  const support = merged.filter((x) => x.side === "support" && x.price < price).sort((a, b) => b.price - a.price).slice(0, 4);
  const resistance = merged.filter((x) => x.side === "resistance" && x.price > price).sort((a, b) => a.price - b.price).slice(0, 4);
  return { support, resistance };
}

function CandleChart({ candles, price, levels }: { candles: Candle[]; price: number; levels: ReturnType<typeof findLevels> }) {
  const chart = useMemo(() => {
    const visible = candles.slice(-70);
    if (!visible.length) return null;
    const low = Math.min(...visible.map((c) => c.low), ...levels.support.slice(0, 2).map((x) => x.price));
    const high = Math.max(...visible.map((c) => c.high), ...levels.resistance.slice(0, 2).map((x) => x.price));
    const range = high - low || 1;
    const y = (v: number) => 18 + (high - v) / range * 255;
    const step = 900 / visible.length;
    return { visible, y, step, low, high };
  }, [candles, levels]);
  if (!chart) return <div className="chart-empty">بانتظار تحميل الشموع...</div>;
  return (
    <svg className="chart-svg" viewBox="0 0 1000 300" role="img" aria-label="رسم شموع البيتكوين">
      {levels.resistance.slice(0, 3).map((level, i) => <g key={"r" + i}><line x1="75" x2="990" y1={chart.y(level.price)} y2={chart.y(level.price)} className="res-line" strokeDasharray="7 5" /><text x="985" y={chart.y(level.price) - 5} className="chart-label" textAnchor="end">R{i + 1} {format(level.price, 0)}</text></g>)}
      {levels.support.slice(0, 3).map((level, i) => <g key={"s" + i}><line x1="75" x2="990" y1={chart.y(level.price)} y2={chart.y(level.price)} className="sup-line" strokeDasharray="7 5" /><text x="985" y={chart.y(level.price) - 5} className="chart-label" textAnchor="end">S{i + 1} {format(level.price, 0)}</text></g>)}
      {chart.visible.map((c, i) => {
        const x = 80 + i * chart.step + chart.step / 2;
        const up = c.close >= c.open;
        const color = up ? "var(--green)" : "var(--red)";
        const top = chart.y(Math.max(c.open, c.close));
        const bottom = chart.y(Math.min(c.open, c.close));
        return <g key={c.time}><line x1={x} x2={x} y1={chart.y(c.high)} y2={chart.y(c.low)} stroke={color} strokeWidth="2" /><rect x={x - Math.max(2, chart.step * .28)} y={top} width={Math.max(4, chart.step * .56)} height={Math.max(2, bottom - top)} fill={color} rx="1" /></g>;
      })}
      {price > 0 && <g><line x1="75" x2="990" y1={chart.y(price)} y2={chart.y(price)} className="price-line" /><text x="985" y={chart.y(price) - 7} textAnchor="end" className="price-label">السعر {format(price, 0)}</text></g>}
    </svg>
  );
}

export default function Home() {
  const [market, setMarket] = useState<Market>("spot");
  const [interval, setInterval] = useState<Interval>("15m");
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const price = Number(ticker?.lastPrice || 0);
  const levels = useMemo(() => findLevels(candles, price), [candles, price]);
  const loadTicker = useCallback(async () => {
    try {
      const path = market === "futures" ? "/fapi/v1/ticker/24hr?symbol=BTCUSDT" : "/api/v3/ticker/24hr?symbol=BTCUSDT";
      const data = await requestJson<Ticker>(endpoint(market) + path);
      setTicker(data);
      setConnected(true);
      setError("");
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : "تعذر الاتصال بـ Binance");
    }
  }, [market]);
  const loadCandles = useCallback(async () => {
    setBusy(true);
    try {
      const path = market === "futures" ? "/fapi/v1/klines" : "/api/v3/klines";
      const rows = await requestJson<unknown[][]>(endpoint(market) + path + "?symbol=BTCUSDT&interval=" + interval + "&limit=240");
      setCandles(rows.map((r) => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الشموع");
    } finally {
      setBusy(false);
    }
  }, [market, interval]);
  const refresh = useCallback(async () => { await Promise.all([loadTicker(), loadCandles()]); }, [loadTicker, loadCandles]);

  useEffect(() => { void refresh(); const tickerTimer = window.setInterval(() => void loadTicker(), 5000); const candleTimer = window.setInterval(() => void loadCandles(), 60000); return () => { window.clearInterval(tickerTimer); window.clearInterval(candleTimer); }; }, [refresh, loadTicker, loadCandles]);

  const lastCandle = candles.at(-1);
  const avgVolume = candles.length > 21 ? candles.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / 20 : 0;
  const volumeRatio = avgVolume && lastCandle ? lastCandle.volume / avgVolume : 0;
  const change = Number(ticker?.priceChangePercent || 0);

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="BTC RADAR"><span className="brand-icon">₿</span><span><b>BTC RADAR</b><small>رادار السوق والتحليل</small></span></a>
        <div className={"connection " + (connected ? "online" : "offline")}><i />{connected ? "متصل ببيانات Binance" : "بانتظار الاتصال"}</div>
        <button className="refresh" onClick={() => void refresh()} disabled={busy}><RefreshCw size={17} /> تحديث</button>
      </header>

      <section className="hero">
        <div><div className="eyebrow"><RadioTower size={15} /> بيانات سوق مباشرة</div><h1>رادار البيتكوين <span>BTCUSDT</span></h1><p>راقب السعر والشموع والمستويات، واتخذ قرارك بنفسك.</p></div>
        <div className="market-toggle"><button className={market === "spot" ? "selected" : ""} onClick={() => setMarket("spot")}>Spot فوري</button><button className={market === "futures" ? "selected" : ""} onClick={() => setMarket("futures")}>Futures عقود</button></div>
      </section>

      {error && <div className="error-banner"><WifiOff size={16} /> تعذر تحديث بعض البيانات: {error}</div>}

      <section className="price-panel panel">
        <div><span className="muted">سعر البيتكوين مقابل USDT</span><div className="price-line"><strong>{price ? format(price, 2) : "—"}</strong><span className={change >= 0 ? "positive" : "negative"}>{ticker ? (change >= 0 ? "+" : "") + format(change, 2) + "%" : "—"}</span></div><small className="muted">تحديث السعر كل 5 ثوانٍ · {market.toUpperCase()}</small></div>
        <div className="stats"><div><span>أعلى 24 ساعة</span><b>{ticker ? format(Number(ticker.highPrice)) : "—"}</b></div><div><span>أدنى 24 ساعة</span><b>{ticker ? format(Number(ticker.lowPrice)) : "—"}</b></div><div><span>حجم التداول 24س</span><b>{ticker ? format(Number(ticker.volume), 0) + " BTC" : "—"}</b></div></div>
      </section>

      <section className="panel chart-panel">
        <div className="section-head"><div><h2>الشارت المباشر</h2><p className="muted">شموع يابانية مع مناطق الدعم والمقاومة</p></div><div className="timeframes">{intervals.map((tf) => <button key={tf} className={interval === tf ? "selected" : ""} onClick={() => setInterval(tf)}>{tf}</button>)}</div></div>
        <div className="chart-wrap">{busy && candles.length === 0 ? <div className="chart-empty">تحميل الشموع...</div> : <CandleChart candles={candles} price={price} levels={levels} />}</div>
        <div className="chart-foot"><span>{lastCandle ? "آخر شمعة: " + new Date(lastCandle.time).toLocaleString("ar") : "بانتظار الشموع"}</span><span>المصدر: Binance API</span></div>
      </section>

      <section className="grid">
        <article className="panel levels-panel"><div className="section-head"><div><h2>الدعم والمقاومة</h2><p className="muted">مستويات محورية من آخر 240 شمعة</p></div><span className="tag">تقديرية</span></div>
          <div className="level-group"><b className="res-title">المقاومات</b>{levels.resistance.length ? levels.resistance.map((x, i) => <div className="level-row" key={"r" + i}><span>R{i + 1} · {x.touches} تفاعلات</span><b>{format(x.price, 2)}</b></div>) : <p className="muted">لا توجد مقاومة أعلى السعر ضمن البيانات الحالية.</p>}</div>
          <div className="level-group"><b className="sup-title">الدعوم</b>{levels.support.length ? levels.support.map((x, i) => <div className="level-row" key={"s" + i}><span>S{i + 1} · {x.touches} تفاعلات</span><b>{format(x.price, 2)}</b></div>) : <p className="muted">لا يوجد دعم أسفل السعر ضمن البيانات الحالية.</p>}</div>
        </article>
        <article className="panel"><div className="section-head"><div><h2>حجم التداول</h2><p className="muted">مقارنة بمتوسط آخر 20 شمعة</p></div><Activity size={18} /></div><div className="volume-value">{volumeRatio ? format(volumeRatio, 2) + "x" : "—"}</div><p className="muted">{volumeRatio >= 1.2 ? "حجم التداول أعلى من المتوسط؛ راقب تأكيد الإغلاق." : volumeRatio > 0 ? "حجم التداول ليس أعلى بوضوح من المتوسط." : "بانتظار بيانات كافية لحساب المتوسط."}</p></article>
      </section>

      <footer><span>BTC RADAR · أداة متابعة وتعليم</span><span>المستويات استنتاجات حسابية وليست توصيات استثمارية.</span></footer>
    </main>
  );
}