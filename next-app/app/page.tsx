"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, CircleDollarSign, RadioTower, RefreshCw, ShieldAlert, TrendingDown, TrendingUp, Wifi, WifiOff } from "lucide-react";
import { atr, binance, calculateLevels, ema, parseCandles, rsi, type Candle, type Interval, type Market } from "@/lib/market";

type Ticker = { lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; volume: string };
type Book = { asks: [string,string][]; bids: [string,string][] };
type FuturesMetrics = { funding: string; mark: string; oi: string; longShort: string; note: string };
const intervals: Interval[] = ["5m", "15m", "1h", "4h", "1d"];
const fmt = (v: number, d = 2) => Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
const endpoint = (market: Market, path: string) => (market === "futures" ? "/fapi/v1" : "/api/v3") + path;

function CandleChart({ candles, price, levels }: { candles: Candle[]; price: number; levels: ReturnType<typeof calculateLevels> }) {
  const bars = candles.slice(-90);
  if (!bars.length) return <div className="chart-empty">بانتظار بيانات الشموع...</div>;
  const low = Math.min(...bars.map(c => c.low), ...levels.support.slice(0, 2).map(x => x.price));
  const high = Math.max(...bars.map(c => c.high), ...levels.resistance.slice(0, 2).map(x => x.price));
  const y = (v: number) => 14 + (high - v) / (high - low || 1) * 250;
  const step = 900 / bars.length;
  return <svg className="chart-svg" viewBox="0 0 1000 285" role="img" aria-label="شموع البيتكوين مع الدعم والمقاومة">
    {levels.resistance.slice(0,3).map((v,i)=><g key={"r"+i}><line x1="70" x2="990" y1={y(v.price)} y2={y(v.price)} className="res-line" strokeDasharray="7 5"/><text x="985" y={y(v.price)-5} textAnchor="end" className="chart-label">R{i+1} {fmt(v.price,0)}</text></g>)}
    {levels.support.slice(0,3).map((v,i)=><g key={"s"+i}><line x1="70" x2="990" y1={y(v.price)} y2={y(v.price)} className="sup-line" strokeDasharray="7 5"/><text x="985" y={y(v.price)-5} textAnchor="end" className="chart-label">S{i+1} {fmt(v.price,0)}</text></g>)}
    {bars.map((c,i)=>{const x=75+i*step+step/2,up=c.close>=c.open,color=up?"var(--green)":"var(--red)",top=y(Math.max(c.open,c.close)),bottom=y(Math.min(c.open,c.close));return <g key={c.time}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="2"/><rect x={x-Math.max(2,step*.28)} y={top} width={Math.max(4,step*.56)} height={Math.max(2,bottom-top)} fill={color} rx="1"/></g>})}
    {price>0&&<g><line x1="70" x2="990" y1={y(price)} y2={y(price)} className="price-line"/><text x="985" y={y(price)-7} textAnchor="end" className="price-label">السعر {fmt(price,0)}</text></g>}
  </svg>;
}

export default function Home() {
  const [market,setMarket]=useState<Market>("spot");
  const [interval,setInterval]=useState<Interval>("15m");
  const [ticker,setTicker]=useState<Ticker|null>(null);
  const [candles,setCandles]=useState<Candle[]>([]);
  const [h1,setH1]=useState<Candle[]>([]);
  const [h4,setH4]=useState<Candle[]>([]);
  const [book,setBook]=useState<Book|null>(null);
  const [futures,setFutures]=useState<FuturesMetrics>({funding:"—",mark:"—",oi:"—",longShort:"—",note:"اختر سوق العقود الآجلة لعرض بياناته."});
  const [busy,setBusy]=useState(false);
  const [connected,setConnected]=useState(false);
  const [error,setError]=useState("");
  const [capital,setCapital]=useState("10000");
  const [riskPct,setRiskPct]=useState("1");
  const [stopPct,setStopPct]=useState("1");
  const [alertPermission,setAlertPermission]=useState(false);
  const lastProximityAlert=useRef("");
  const price=Number(ticker?.lastPrice||0);
  const levels=useMemo(()=>calculateLevels(candles,h1,h4,price),[candles,h1,h4,price]);
  const closes=candles.filter(c=>c.closeTime<Date.now()).map(c=>c.close);
  const e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200),currentRsi=rsi(closes);
  const latest=candles.filter(c=>c.closeTime<Date.now()).at(-1);
  const averageVolume=candles.filter(c=>c.closeTime<Date.now()).slice(-21,-1).reduce((s,c)=>s+c.volume,0)/20;
  const volumeRatio=latest&&averageVolume?latest.volume/averageVolume:0;
  const trend=closes.length>=200&&e20.length&&e50.length&&e200.length?(closes.at(-1)!>e20.at(-1)!&&e20.at(-1)!>e50.at(-1)!&&e50.at(-1)!>e200.at(-1)!?"صاعد":closes.at(-1)!<e20.at(-1)!&&e20.at(-1)!<e50.at(-1)!&&e50.at(-1)!<e200.at(-1)!?"هابط":"عرضي / غير محسوم"):"بيانات غير كافية";
  const riskAmount=Math.max(0,Number(capital)||0)*Math.max(0,Number(riskPct)||0)/100;
  const positionSize=Math.min(Math.max(0,Number(capital)||0),riskAmount/(Math.max(.0001,Number(stopPct)||0)/100));
  const distance=(level?:{price:number})=>level&&price?fmt(Math.abs(level.price-price),2)+" USDT · "+fmt(Math.abs(level.price-price)/price*100,2)+"%":"—";

  const refresh=useCallback(async()=>{
    setBusy(true);
    try {
      const [t,rows,one,four,depth]=await Promise.all([
        binance<Ticker>(market,endpoint(market,"/ticker/24hr?symbol=BTCUSDT")),
        binance<unknown[][]>(market,endpoint(market,"/klines?symbol=BTCUSDT&interval="+interval+"&limit=300")),
        binance<unknown[][]>(market,endpoint(market,"/klines?symbol=BTCUSDT&interval=1h&limit=240")),
        binance<unknown[][]>(market,endpoint(market,"/klines?symbol=BTCUSDT&interval=4h&limit=240")),
        binance<Book>(market,endpoint(market,"/depth?symbol=BTCUSDT&limit=10"))
      ]);
      setTicker(t);setCandles(parseCandles(rows));setH1(parseCandles(one));setH4(parseCandles(four));setBook(depth);setConnected(true);setError("");
      if(market==="futures"){
        const results=await Promise.allSettled([
          binance<{lastFundingRate:string;markPrice:string}>(market,"/premiumIndex?symbol=BTCUSDT"),
          binance<{openInterest:string}>(market,"/openInterest?symbol=BTCUSDT"),
          binance<{longShortRatio:string}[]>(market,"/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=15m&limit=1")
        ]);
        const premium=results[0].status==="fulfilled"?results[0].value:null,oi=results[1].status==="fulfilled"?results[1].value:null,ls=results[2].status==="fulfilled"?results[2].value[0]:null;
        setFutures({funding:premium?fmt(Number(premium.lastFundingRate)*100,4)+"%":"غير متاح",mark:premium?fmt(Number(premium.markPrice)):"غير متاح",oi:oi?Number(oi.openInterest).toLocaleString("en-US"):"غير متاح",longShort:ls?fmt(Number(ls.longShortRatio),3)+":1":"غير متاح",note:results.some(x=>x.status==="rejected")?"تعذر تحميل بعض المقاييس من Binance Futures.":"تم جلب بيانات العقود الآجلة."});
      }else setFutures({funding:"—",mark:"—",oi:"—",longShort:"—",note:"اختر Futures لعرض بيانات التمويل والعقود المفتوحة."});
    }catch(e){setConnected(false);setError(e instanceof Error?e.message:"تعذر تحميل بيانات السوق");}
    finally{setBusy(false);}
  },[market,interval]);

  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),30000);return()=>window.clearInterval(timer);},[refresh]);
  useEffect(()=>{
    const host=market==="futures"?"wss://fstream.binance.com/ws/":"wss://stream.binance.com:9443/ws/";
    let socket:WebSocket|undefined;
    let retry:number|undefined;
    let stopped=false;
    const connect=()=>{if(stopped)return;socket=new WebSocket(host+"btcusdt@ticker");socket.onopen=()=>setConnected(true);socket.onmessage=e=>{try{const d=JSON.parse(e.data);setTicker(prev=>({...prev,lastPrice:d.c,priceChangePercent:d.P,highPrice:prev?.highPrice||d.h,lowPrice:prev?.lowPrice||d.l,volume:prev?.volume||d.v}));}catch{}};socket.onclose=()=>{if(!stopped)retry=window.setTimeout(connect,4000);};socket.onerror=()=>setConnected(false);};
    connect();return()=>{stopped=true;if(retry)window.clearTimeout(retry);socket?.close();};
  },[market]);

  const notify=async()=>{if(!("Notification"in window)){setError("هذا المتصفح لا يدعم إشعارات النظام.");return;}const p=await Notification.requestPermission();setAlertPermission(p==="granted");};
  const askAlert=(title:string,body:string)=>{if(alertPermission&&"Notification"in window&&Notification.permission==="granted")new Notification(title,{body});};

  useEffect(()=>{
    if(!price){lastProximityAlert.current="";return;}
    const near=Math.max(levels.atr*.35,price*.0015),r=levels.resistance[0],s=levels.support[0];
    let key="";
    if(r&&r.price-price>=0&&r.price-price<=near)key="resistance:"+Math.round(r.price);
    else if(s&&price-s.price>=0&&price-s.price<=near)key="support:"+Math.round(s.price);
    if(!key){lastProximityAlert.current="";return;}
    if(key===lastProximityAlert.current)return;
    lastProximityAlert.current=key;
    if(key.startsWith("resistance:"))askAlert("اقترب BTC من المقاومة", "السعر "+fmt(price)+" والمقاومة "+fmt(r!.price));
    else askAlert("اقترب BTC من الدعم", "السعر "+fmt(price)+" والدعم "+fmt(s!.price));
  },[price,levels.resistance,levels.support,levels.atr]);

  const asks=book?.asks.slice(0,5).reverse()||[],bids=book?.bids.slice(0,5)||[];
  const spread=book?Number(book.asks[0][0])-Number(book.bids[0][0]):0;
  const maxDepth=Math.max(...[...asks,...bids].map(x=>Number(x[1])),1);
  const resistance=levels.resistance[0],support=levels.support[0];

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-icon">₿</span><span><b>BTC RADAR</b><small>رادار السوق والتحليل</small></span></a><nav className="smart-nav"><a className="active" href="/">لوحة الرادار</a><a href="/chart">الشارت الذكي</a></nav><div className={"connection "+(connected?"online":"offline")}><i/>{connected?"متصل ببيانات Binance":"بانتظار الاتصال"}</div><button className="refresh" onClick={()=>void refresh()} disabled={busy}><RefreshCw size={16}/> تحديث</button></header>
    <section className="hero"><div><div className="eyebrow"><RadioTower size={15}/> بيانات سوق مباشرة</div><h1>رادار البيتكوين <span>BTCUSDT</span></h1><p>السعر والشموع والمؤشرات والدعم والمقاومة وبيانات العقود في لوحة واحدة.</p></div><div className="market-toggle"><button className={market==="spot"?"selected":""} onClick={()=>setMarket("spot")}>Spot فوري</button><button className={market==="futures"?"selected":""} onClick={()=>setMarket("futures")}>Futures عقود</button></div></section>
    {error&&<div className="error-banner"><WifiOff size={16}/> تعذر تحديث البيانات: {error}</div>}
    <section className="price-panel panel"><div><span className="muted">سعر البيتكوين مقابل USDT · {market.toUpperCase()}</span><div className="price-line"><strong>{price?fmt(price):"—"}</strong><span className={Number(ticker?.priceChangePercent||0)>=0?"positive":"negative"}>{ticker?(Number(ticker.priceChangePercent)>=0?"+":"")+fmt(Number(ticker.priceChangePercent))+"%":"—"}</span></div><small className="muted">البث المباشر عبر Binance WebSocket</small></div><div className="stats"><div><span>أعلى 24 ساعة</span><b>{ticker?fmt(Number(ticker.highPrice)):"—"}</b></div><div><span>أدنى 24 ساعة</span><b>{ticker?fmt(Number(ticker.lowPrice)):"—"}</b></div><div><span>حجم 24 ساعة</span><b>{ticker?fmt(Number(ticker.volume),0)+" BTC":"—"}</b></div></div></section>
    <section className="panel chart-panel"><div className="section-head"><div><h2>الشارت المباشر</h2><p className="muted">شموع يابانية ومستويات محسوبة من 15د و1س و4س</p></div><div className="timeframes">{intervals.map(tf=><button key={tf} className={interval===tf?"selected":""} onClick={()=>setInterval(tf)}>{tf}</button>)}</div></div><div className="chart-wrap"><CandleChart candles={candles} price={price} levels={levels}/></div><div className="chart-foot"><span>{latest?"آخر شمعة مكتملة: "+new Date(latest.time).toLocaleString("ar"):"بانتظار الشموع"}</span><span>EMA 20/50/200 · {interval}</span></div></section>
    <section className="grid">
      <article className="panel"><div className="section-head"><div><h2>الدعم والمقاومة</h2><p className="muted">مناطق سعرية من القمم والقيعان والتفاعلات المتكررة</p></div><span className="tag">تقديرية</span></div><div className="level-group"><b className="res-title">المقاومات</b>{levels.resistance.map((x,i)=><div className="level-row" key={"r"+i}><span>R{i+1} · {x.strength} · {x.timeframes.join("/")}</span><b>{fmt(x.lower)} – {fmt(x.upper)}</b><small>المركز {fmt(x.price)} · {distanceText(x.price,price)}</small></div>)}</div><div className="level-group"><b className="sup-title">الدعوم</b>{levels.support.map((x,i)=><div className="level-row" key={"s"+i}><span>S{i+1} · {x.strength} · {x.timeframes.join("/")}</span><b>{fmt(x.lower)} – {fmt(x.upper)}</b><small>المركز {fmt(x.price)} · {distanceText(x.price,price)}</small></div>)}</div><p className="muted">المستويات التي ينتقل السعر عبرها لا تُحذف من التاريخ؛ قد تتحول المقاومة إلى دعم أو العكس.</p></article>
      <article className="panel"><div className="section-head"><div><h2>الاتجاه والمؤشرات</h2><p className="muted">قراءة مبنية على آخر شمعة مكتملة</p></div><Activity size={18}/></div><div className="trend-box"><b>{trend}</b><p>الاتجاه لا يكفي وحده لاتخاذ قرار؛ راقب الإغلاق والمستويات.</p></div><div className="metric-row"><span>EMA 20</span><b>{e20.length?fmt(e20.at(-1)!):"—"}</b></div><div className="metric-row"><span>EMA 50</span><b>{e50.length?fmt(e50.at(-1)!):"—"}</b></div><div className="metric-row"><span>EMA 200</span><b>{e200.length?fmt(e200.at(-1)!):"—"}</b></div><div className="metric-row"><span>RSI 14</span><b>{currentRsi===null?"—":fmt(currentRsi,1)+(currentRsi>70?" · تشبع شراء":currentRsi<30?" · تشبع بيع":"")}</b></div><div className="metric-row"><span>ATR 14</span><b>{fmt(atr(candles))}</b></div></article>
    </section>
    <section className="grid">
      <article className="panel"><div className="section-head"><div><h2>بيانات العقود الآجلة</h2><p className="muted">Funding · Open Interest · Long/Short</p></div><TrendingUp size={18}/></div><div className="metric-grid"><div className="metric"><span>Funding Rate</span><b>{futures.funding}</b></div><div className="metric"><span>Mark Price</span><b>{futures.mark}</b></div><div className="metric"><span>Open Interest</span><b>{futures.oi}</b></div><div className="metric"><span>Long / Short</span><b>{futures.longShort}</b></div></div><p className="muted">{futures.note}</p></article>
      <article className="panel"><div className="section-head"><div><h2>دفتر الأوامر</h2><p className="muted">أفضل خمسة مستويات شراء وبيع</p></div><BookOpen size={18}/></div><div className="book-head"><span>السعر (USDT)</span><span>الكمية (BTC)</span></div>{asks.map((x,i)=><div className="book-row ask" key={"a"+i} style={{"--depth":(Number(x[1])/maxDepth*100)+"%"} as React.CSSProperties}><span>{fmt(Number(x[0]),1)}</span><span>{fmt(Number(x[1]),4)}</span></div>)}<div className="book-spread">فرق السعر <b>{fmt(spread,2)} USDT</b></div>{bids.map((x,i)=><div className="book-row bid" key={"b"+i} style={{"--depth":(Number(x[1])/maxDepth*100)+"%"} as React.CSSProperties}><span>{fmt(Number(x[0]),1)}</span><span>{fmt(Number(x[1]),4)}</span></div>)}</article>
    </section>
    <section className="grid">
      <article className="panel"><div className="section-head"><div><h2>سيناريوهات مشروطة</h2><p className="muted">ليست إشارات دخول ولا تنفذ صفقات</p></div><ShieldAlert size={18}/></div><div className="scenario"><b className="res-title">السيناريو الصاعد</b><p>{resistance?"انتظر إغلاق شمعة "+interval+" فوق "+fmt(resistance.upper)+" ثم عودة لاختبار المنطقة والثبات فوقها.":"لا توجد مقاومة قريبة كافية لبناء سيناريو."}</p></div><div className="scenario"><b className="sup-title">السيناريو الهابط</b><p>{support?"انتظر إغلاق شمعة "+interval+" تحت "+fmt(support.lower)+" ثم إعادة اختبار فاشلة للمنطقة.":"لا يوجد دعم قريب كافٍ لبناء سيناريو."}</p></div><div className="metric-row"><span>حجم آخر شمعة / متوسط 20</span><b>{volumeRatio?fmt(volumeRatio,2)+"x":"—"} {volumeRatio>=1.2?"· مرتفع":volumeRatio>0?"· عادي":""}</b></div><p className="muted">لا يُعد الاختراق مؤكدًا لمجرد لمس المستوى؛ انتظر إغلاق الشمعة واختبار المنطقة.</p></article>
      <article className="panel"><div className="section-head"><div><h2>حاسبة المخاطرة</h2><p className="muted">رأس المال الافتراضي 10,000 USDT</p></div><CircleDollarSign size={18}/></div><div className="risk-inputs"><label>رأس المال USDT<input value={capital} onChange={e=>setCapital(e.target.value)} inputMode="decimal"/></label><label>المخاطرة %<input value={riskPct} onChange={e=>setRiskPct(e.target.value)} inputMode="decimal"/></label><label>مسافة الوقف %<input value={stopPct} onChange={e=>setStopPct(e.target.value)} inputMode="decimal"/></label></div><div className="risk-results"><div><span>قيمة المخاطرة</span><b>{fmt(riskAmount)} USDT</b></div><div><span>حجم المركز التقريبي</span><b>{fmt(positionSize)} USDT</b></div><div><span>كمية BTC التقريبية</span><b>{price?fmt(positionSize/price,6):"—"}</b></div><div><span>السعر المرجعي</span><b>{price?fmt(price):"—"}</b></div></div><p className="muted">حساب تعليمي لا يشمل الرسوم أو الانزلاق أو التمويل، ولا يرسل أوامر إلى Binance.</p></article>
    </section>
    <section className="panel alert-panel"><div className="section-head"><div><h2>التنبيهات</h2><p className="muted">تنبيه اقتراب السعر من أقرب دعم أو مقاومة</p></div><button className="refresh" onClick={()=>void notify()}><Wifi size={15}/> {alertPermission?"الإشعارات مفعّلة":"تفعيل إشعارات المتصفح"}</button></div><p className="muted">تعمل إشعارات المتصفح بعد منح الإذن، ويجب إبقاء الصفحة مفتوحة.</p></section>
    <footer><span>BTC RADAR · منصة متابعة وتعليم</span><span>المصدر Binance · البيانات قد تتأخر أو تتعذر</span><span>لا تنفيذ آلي للصفقات</span></footer>
  </main>;
}
function distanceText(level:number,price:number){return price?fmt(Math.abs(level-price),2)+" USDT · "+fmt(Math.abs(level-price)/price*100,2)+"%":"—";}
