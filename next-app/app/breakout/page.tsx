"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { atr, binance, calculateLevels, parseCandles, type Candle, type Interval, type Market } from "@/lib/market";

const intervals: Interval[] = ["5m", "15m", "1h", "4h"];
const fmt = (v: number, d = 2) => Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
type Tick = { lastPrice: string; priceChangePercent: string };
type BreakEvent = { side: "up" | "down"; level: number; time: number; retested: boolean; failed: boolean; volumeRatio: number };

function BreakChart({ candles, price, resistance, support, event }: { candles: Candle[]; price: number; resistance: number; support: number; event: BreakEvent | null }) {
  const bars = candles.filter(c => c.closeTime < Date.now()).slice(-90);
  if (!bars.length) return <div className="break-empty">بانتظار تحميل الشموع من Binance...</div>;
  const vals = [...bars.flatMap(c => [c.low, c.high]), price, resistance, support].filter(v => v > 0 && Number.isFinite(v));
  const min = Math.min(...vals), max = Math.max(...vals), pad = Math.max((max - min) * .09, price * .0002);
  const lo = min - pad, hi = max + pad, y = (v: number) => 12 + (hi - v) / (hi - lo || 1) * 300;
  const step = 920 / bars.length;
  return <svg viewBox="0 0 1000 330" className="break-svg" role="img" aria-label="شارت الشموع مع خط الدعم والمقاومة ومناطق الكسر">
    {[0, 1, 2, 3, 4].map(i => <line key={i} x1="55" x2="990" y1={12 + i * 75} y2={12 + i * 75} stroke="#e6ebf2" strokeDasharray="3 5" />)}
    {resistance > 0 && <g><line x1="55" x2="990" y1={y(resistance)} y2={y(resistance)} stroke="#d94b5b" strokeWidth="2.5" strokeDasharray="8 5" /><text x="985" y={y(resistance) - 7} textAnchor="end" fill="#c83d50" fontSize="14" fontWeight="700">المقاومة {fmt(resistance, 1)}</text></g>}
    {support > 0 && <g><line x1="55" x2="990" y1={y(support)} y2={y(support)} stroke="#12845f" strokeWidth="2.5" strokeDasharray="8 5" /><text x="985" y={y(support) - 7} textAnchor="end" fill="#087a56" fontSize="14" fontWeight="700">الدعم {fmt(support, 1)}</text></g>}
    {bars.map((c, i) => { const x = 60 + i * step + step / 2, up = c.close >= c.open, color = up ? "#12845f" : "#d94b5b", top = y(Math.max(c.open, c.close)), bottom = y(Math.min(c.open, c.close)); return <g key={c.time}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="2" /><rect x={x - Math.max(2, step * .28)} y={top} width={Math.max(4, step * .56)} height={Math.max(2, bottom - top)} fill={color} /></g>; })}
    {price > 0 && <g><line x1="55" x2="990" y1={y(price)} y2={y(price)} stroke="#b8872d" strokeWidth="2" strokeDasharray="3 4" /><text x="985" y={y(price) - 8} textAnchor="end" fill="#946716" fontSize="13">السعر {fmt(price, 1)}</text></g>}
    {event && !event.failed && <g><line x1="55" x2="990" y1={y(event.level)} y2={y(event.level)} stroke={event.side === "up" ? "#12845f" : "#d94b5b"} strokeWidth="3" /><circle cx="70" cy={y(event.level)} r="6" fill={event.side === "up" ? "#12845f" : "#d94b5b"} /></g>}
  </svg>;
}

export default function BreakoutMonitorPage() {
  const [market, setMarket] = useState<Market>("spot");
  const [interval, setInterval] = useState<Interval>("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [m5, setM5] = useState<Candle[]>([]);
  const [m15, setM15] = useState<Candle[]>([]);
  const [h1, setH1] = useState<Candle[]>([]);
  const [h4, setH4] = useState<Candle[]>([]);
  const [tick, setTick] = useState<Tick | null>(null);
  const [event, setEvent] = useState<BreakEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState(false);
  const [lastScan, setLastScan] = useState(0);
  const price = Number(tick?.lastPrice || 0);
  const levels = useMemo(() => calculateLevels(m5, m15, h1, h4, price), [m5, m15, h1, h4, price]);
  const resistance = levels.resistance[0];
  const support = levels.support[0];
  const closed = candles.filter(c => c.closeTime < Date.now());
  const last = closed.at(-1);
  const averageVolume = closed.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / Math.max(1, Math.min(20, closed.length - 1));
  const volumeRatio = last && averageVolume > 0 ? last.volume / averageVolume : 0;

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const root = market === "futures" ? "/fapi/v1" : "/api/v3";
      const [ticker, selected, five, fifteen, oneHour, fourHour] = await Promise.all([
        binance<Tick>(market, root + "/ticker/24hr?symbol=BTCUSDT"),
        binance<unknown[][]>(market, root + "/klines?symbol=BTCUSDT&interval=" + interval + "&limit=180"),
        binance<unknown[][]>(market, root + "/klines?symbol=BTCUSDT&interval=5m&limit=240"),
        binance<unknown[][]>(market, root + "/klines?symbol=BTCUSDT&interval=15m&limit=240"),
        binance<unknown[][]>(market, root + "/klines?symbol=BTCUSDT&interval=1h&limit=200"),
        binance<unknown[][]>(market, root + "/klines?symbol=BTCUSDT&interval=4h&limit=200")
      ]);
      setTick(ticker); setCandles(parseCandles(selected)); setM5(parseCandles(five)); setM15(parseCandles(fifteen)); setH1(parseCandles(oneHour)); setH4(parseCandles(fourHour));
      setConnected(true); setError("");
    } catch (e) { setConnected(false); setError(e instanceof Error ? e.message : "تعذر تحميل بيانات Binance"); }
    finally { setBusy(false); }
  }, [market, interval]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => {
    const host = market === "futures" ? "wss://fstream.binance.com/ws/" : "wss://stream.binance.com:9443/ws/";
    let stopped = false, ws: WebSocket | undefined, retry: number | undefined;
    const connect = () => { if (stopped) return; ws = new WebSocket(host + "btcusdt@ticker"); ws.onopen = () => setConnected(true); ws.onmessage = e => { try { const d = JSON.parse(e.data); setTick(p => ({ lastPrice: d.c, priceChangePercent: d.P })); } catch { /* ignore malformed stream data */ } }; ws.onclose = () => { if (!stopped) retry = window.setTimeout(connect, 4000); }; ws.onerror = () => setConnected(false); };
    connect(); return () => { stopped = true; if (retry) window.clearTimeout(retry); ws?.close(); };
  }, [market]);

  useEffect(() => {
    if (!last || !resistance || !support || last.time === lastScan) return;
    setLastScan(last.time);
    const recent = closed.slice(-16);
    const candidates: BreakEvent[] = [];
    for (let i = 1; i < recent.length; i++) {
      const before = recent[i - 1], bar = recent[i];
      for (const level of levels.all) {
        if (level.side === "resistance" && before.close <= level.price && bar.close > level.price)
          candidates.push({ side: "up", level: level.price, time: bar.time, retested: false, failed: false, volumeRatio: averageVolume ? bar.volume / averageVolume : 0 });
        if (level.side === "support" && before.close >= level.price && bar.close < level.price)
          candidates.push({ side: "down", level: level.price, time: bar.time, retested: false, failed: false, volumeRatio: averageVolume ? bar.volume / averageVolume : 0 });
      }
    }
    const latest = candidates.sort((a, b) => a.time - b.time).at(-1);
    if (latest) {
      const stillValid = latest.side === "up" ? last.close > latest.level : last.close < latest.level;
      if (stillValid) {
        const after = recent.filter(c => c.time > latest.time);
        const band = Math.max(atr(closed) * .15, price * .00035);
        const retested = after.some(c => latest.side === "up" ? c.low <= latest.level + band && c.close > latest.level : c.high >= latest.level - band && c.close < latest.level);
        const next = { ...latest, retested };
        setEvent(current => !current || latest.time > current.time ? next : current);
        if (latest.time === last.time && permission && "Notification" in window && Notification.permission === "granted") {
          new Notification(latest.side === "up" ? "BTC RADAR · اختراق المقاومة" : "BTC RADAR · كسر الدعم", { body: "إغلاق " + interval + " عند مستوى " + fmt(latest.level) + " USDT" });
        }
      }
    }
  }, [last?.time, levels.all, resistance?.price, support?.price, averageVolume, interval, lastScan, permission, price]);

  useEffect(() => {
    if (!event || !last || last.time <= event.time || event.retested || event.failed) return;
    const band = Math.max(atr(closed) * .15, price * .00035);
    if (event.side === "up" && last.low <= event.level + band && last.close > event.level) setEvent({ ...event, retested: true });
    else if (event.side === "down" && last.high >= event.level - band && last.close < event.level) setEvent({ ...event, retested: true });
    else if (event.side === "up" && last.close < event.level - band) setEvent({ ...event, failed: true });
    else if (event.side === "down" && last.close > event.level + band) setEvent({ ...event, failed: true });
  }, [last?.time, event, price]);

  const enableNotifications = async () => {
    if (!("Notification" in window)) { setError("المتصفح لا يدعم إشعارات النظام."); return; }
    const result = await Notification.requestPermission(); setPermission(result === "granted");
  };
  const distanceUp = resistance && price ? (resistance.price - price) / price * 100 : null;
  const distanceDown = support && price ? (price - support.price) / price * 100 : null;
  const status = event && !event.failed
    ? event.side === "up" ? (event.retested ? "اختراق المقاومة مؤكد مع إعادة اختبار" : "تم اختراق المقاومة بإغلاق شمعة — انتظر إعادة الاختبار") : (event.retested ? "كسر الدعم مؤكد مع إعادة اختبار" : "تم كسر الدعم بإغلاق شمعة — انتظر إعادة الاختبار")
    : event?.failed ? "فشل الاختراق / الكسر السابق — عاد السعر عبر المستوى" : "لم يحدث كسر مؤكد — نراقب الجهتين";
  return <main className="shell breakout-page">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-icon">₿</span><span><b>BTC RADAR</b><small>رادار السوق والتحليل</small></span></Link><nav className="smart-nav"><Link href="/">لوحة التحليل</Link><Link className="active" href="/breakout/">رادار الكسر</Link></nav><div className={"connection " + (connected ? "online" : "offline")}><i />{connected ? "متصل ببيانات Binance" : "بانتظار الاتصال"}</div><button className="refresh" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} /> تحديث</button></header>
    <section className="hero"><div><div className="eyebrow">مراقبة مباشرة للاتجاهين</div><h1>رادار كسر الدعم والمقاومة <span>BTCUSDT</span></h1><p>شارت واحد يراقب اختراق المقاومة للأعلى وكسر الدعم للأسفل، مع تأكيد الإغلاق وإعادة الاختبار.</p></div><div className="market-toggle"><button className={market === "spot" ? "selected" : ""} onClick={() => { setMarket("spot"); setEvent(null); }}>Spot فوري</button><button className={market === "futures" ? "selected" : ""} onClick={() => { setMarket("futures"); setEvent(null); }}>Futures عقود</button></div></section>
    {error && <div className="error-banner"><WifiOff size={16} />{error}</div>}
    <section className="price-panel panel"><div><span className="muted">السعر المباشر · USDT</span><div className="price-line"><strong>{price ? fmt(price) : "—"}</strong><span className={Number(tick?.priceChangePercent || 0) >= 0 ? "positive" : "negative"}>{tick ? (Number(tick.priceChangePercent) >= 0 ? "+" : "") + fmt(Number(tick.priceChangePercent)) + "%" : "—"}</span></div><small className="muted">سعر آخر صفقة · بث مباشر</small></div><div className="stats"><div><span>المقاومة الأقرب</span><b className="res-title">{resistance ? fmt(resistance.price) : "—"}</b></div><div><span>الدعم الأقرب</span><b className="sup-title">{support ? fmt(support.price) : "—"}</b></div><div><span>حجم آخر شمعة / المتوسط</span><b>{last ? fmt(volumeRatio, 2) + "x" : "—"}</b></div></div></section>
    <section className="panel breakout-status"><div className="section-head"><div><h2>حالة الرصد الآن</h2><p className="muted">التأكيد حسب إغلاق شمعة {interval} المكتملة</p></div><span className={"decision-chip " + (event && !event.failed ? event.side === "up" ? "good" : "bad" : "warn")}>{event && !event.failed ? "حدث مرصود" : "مراقبة"}</span></div><strong>{status}</strong><p>{event ? (event.side === "up" ? "المقاومة المكسورة: " : "الدعم المكسور: ") + fmt(event.level) + " USDT · " + (event.retested ? "إعادة الاختبار تمت" : "إعادة الاختبار " + (event.failed ? "فشلت" : "لم تتم بعد")) + " · حجم الحدث " + fmt(event.volumeRatio, 2) + "x" : "لا تعتبر ملامسة الخط كسرًا. ننتظر إغلاق الشمعة خارج المستوى."}</p></section>
    <section className="panel chart-panel"><div className="section-head"><div><h2>الشارت: الدعم والمقاومة معًا</h2><p className="muted">خط أحمر للمقاومة · خط أخضر للدعم · خط ذهبي للسعر الحالي</p></div><div className="timeframes">{intervals.map(x => <button key={x} className={interval === x ? "selected" : ""} onClick={() => { setInterval(x); setEvent(null); setLastScan(0); }}>{x}</button>)}</div></div><div className="break-chart-wrap"><BreakChart candles={candles} price={price} resistance={resistance?.price || 0} support={support?.price || 0} event={event} /></div><div className="chart-foot"><span>{last ? "آخر شمعة مكتملة: " + new Date(last.time).toLocaleString("ar") : "بانتظار الشموع"}</span><span>المستويات من 5د / 15د / 1س / 4س · الشارت {interval}</span></div></section>
    <section className="break-side-grid"><article className="panel"><div className="section-head"><div><h2 className="res-title">مراقبة اختراق المقاومة ↑</h2><p className="muted">السيناريو الصاعد</p></div></div><b className="break-big res-title">{resistance ? fmt(resistance.price) : "—"}</b><div className="alert-state"><b>شرط التأكيد</b><span>إغلاق شمعة {interval} فوق {resistance ? fmt(resistance.price) : "المقاومة"}، وليس مجرد لمسها.</span></div><div className="alert-state"><b>المسافة الحالية</b><span>{distanceUp === null ? "—" : fmt(distanceUp, 3) + "% فوق السعر"}</span></div><div className="alert-state"><b>قوة المستوى</b><span>{resistance ? resistance.strength + " · توافق " + resistance.timeframes.join(" / ") : "لا تتوفر بيانات كافية"}</span></div></article><article className="panel"><div className="section-head"><div><h2 className="sup-title">مراقبة كسر الدعم ↓</h2><p className="muted">السيناريو الهابط</p></div></div><b className="break-big sup-title">{support ? fmt(support.price) : "—"}</b><div className="alert-state"><b>شرط التأكيد</b><span>إغلاق شمعة {interval} تحت {support ? fmt(support.price) : "الدعم"}، وليس مجرد لمسه.</span></div><div className="alert-state"><b>المسافة الحالية</b><span>{distanceDown === null ? "—" : fmt(distanceDown, 3) + "% تحت السعر"}</span></div><div className="alert-state"><b>قوة المستوى</b><span>{support ? support.strength + " · توافق " + support.timeframes.join(" / ") : "لا تتوفر بيانات كافية"}</span></div></article></section>
    <section className="panel"><div className="section-head"><div><h2>التنبيهات</h2><p className="muted">يتم فحص الشموع المكتملة وتحديث الأسعار تلقائيًا كل 30 ثانية</p></div><button className="refresh" onClick={() => void enableNotifications()}><Bell size={15} />{permission ? "الإشعارات مفعّلة" : "تفعيل الإشعارات"}</button></div><p className="muted">ستظهر رسالة عند رصد إغلاق فوق المقاومة أو تحت الدعم، ثم عند إعادة الاختبار أو فشل الكسر. تعمل إشعارات المتصفح أثناء فتح الصفحة.</p></section>
    <div className="disclaimer">هذه صفحة رصد فني وليست أمر تداول. اختراق المقاومة أو كسر الدعم لا يتأكد بمجرد حركة السعر داخل الشمعة؛ ننتظر الإغلاق، ثم نراقب إعادة الاختبار. لا ينفذ الموقع أي صفقة تلقائيًا.</div>
    <footer><span>BTC RADAR · رادار كسر الدعم والمقاومة</span><span>المصدر: Binance</span><span><Link href="/">العودة للوحة التحليل</Link></span></footer>
  </main>;
}
