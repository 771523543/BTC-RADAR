"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { atr, binance, calculateLevels, ema, parseCandles, type Candle, type Interval, type Market } from "@/lib/market";

const frames:Interval[]=["1m","5m","15m","1h","4h"];
const fmt=(v:number,d=2)=>Number.isFinite(v)?v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
type Ticker={lastPrice:string;priceChangePercent:string;highPrice:string;lowPrice:string;volume:string};
type FuturesMetrics={funding:string;mark:string;oi:string;longShort:string;note:string};
type EventItem={id:number;time:string;title:string;detail:string;tone:"good"|"warn"|"bad"};
type BreakState={side:"up"|"down";level:number;time:number;retested:boolean};

function Chart({candles,price,levels}:{candles:Candle[];price:number;levels:ReturnType<typeof calculateLevels>}){
 const bars=candles.slice(-120);if(!bars.length)return <div className="chart-empty">بانتظار الشموع...</div>;
 const visibleResistance=levels.resistance.slice(0,4),visibleSupport=levels.support.slice(0,4);
 const plottedLevels=[...visibleResistance,...visibleSupport];
 const values=[...bars.flatMap(x=>[x.low,x.high]),price,...plottedLevels.map(x=>x.price)].filter(v=>Number.isFinite(v)&&v>0);
 const rawLow=Math.min(...values),rawHigh=Math.max(...values),padding=Math.max((rawHigh-rawLow)*.06,price*.00015);
 const lo=rawLow-padding,hi=rawHigh+padding;
 const y=(v:number)=>15+(hi-v)/(hi-lo||1)*310,step=900/bars.length;
 return <svg viewBox="0 0 1000 345" className="smart-svg" role="img" aria-label="شارت BTCUSDT مع الدعم والمقاومة">
  {visibleResistance.map((v,i)=><g key={"r"+i}><line x1="65" x2="990" y1={y(v.price)} y2={y(v.price)} stroke="#f16b76" strokeWidth="1.8" strokeDasharray="7 5"/><text x="985" y={y(v.price)-5} textAnchor="end" fill="#ff9aa4" fontSize="12">R{i+1} {fmt(v.price,0)}</text></g>)}
  {visibleSupport.map((v,i)=><g key={"s"+i}><line x1="65" x2="990" y1={y(v.price)} y2={y(v.price)} stroke="#27c58b" strokeWidth="1.8" strokeDasharray="7 5"/><text x="985" y={y(v.price)-5} textAnchor="end" fill="#62dfb1" fontSize="12">S{i+1} {fmt(v.price,0)}</text></g>)}
  {bars.map((c,i)=>{const x=70+i*step+step/2,up=c.close>=c.open,color=up?"#27c58b":"#f16b76",top=y(Math.max(c.open,c.close)),bottom=y(Math.min(c.open,c.close));return <g key={c.time}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="2"/><rect x={x-Math.max(2,step*.28)} y={top} width={Math.max(4,step*.56)} height={Math.max(2,bottom-top)} fill={color}/></g>})}
  {price>0&&<g><line x1="65" x2="990" y1={y(price)} y2={y(price)} stroke="#e7bd68" strokeDasharray="3 4" strokeWidth="2"/><text x="985" y={y(price)-8} textAnchor="end" fill="#e7bd68" fontSize="13">السعر {fmt(price,0)}</text></g>}
 </svg>;
}

export default function SmartChart(){
 const [market,setMarket]=useState<Market>("spot"),[interval,setInterval]=useState<Interval>("15m"),[ticker,setTicker]=useState<Ticker|null>(null),[candles,setCandles]=useState<Candle[]>([]),[m5,setM5]=useState<Candle[]>([]),[m15,setM15]=useState<Candle[]>([]),[h1,setH1]=useState<Candle[]>([]),[h4,setH4]=useState<Candle[]>([]),[connected,setConnected]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false),[permission,setPermission]=useState(false),[events,setEvents]=useState<EventItem[]>([]),[lastBreak,setLastBreak]=useState<BreakState|null>(null),[volumeStatus,setVolumeStatus]=useState("بانتظار بيانات الشموع"),[futures,setFutures]=useState<FuturesMetrics>({funding:"—",mark:"—",oi:"—",longShort:"—",note:"اختر Futures لعرض بيانات العقود الآجلة."});
 const eventId=useRef(0),lastAnalyzed=useRef(0),lastProximity=useRef("");
 const price=Number(ticker?.lastPrice||0),levels=useMemo(()=>calculateLevels(m5,m15,h1,h4,price),[m5,m15,h1,h4,price]);
 const closed=candles.filter(c=>c.closeTime<Date.now()),last=closed.at(-1),previous=closed.at(-2),avgVol=closed.slice(-21,-1).reduce((s,c)=>s+c.volume,0)/Math.max(1,Math.min(20,closed.length-1)),ratio=last&&avgVol?last.volume/avgVol:0;
 const addEvent=useCallback((title:string,detail:string,tone:EventItem["tone"])=>{setEvents(old=>[{id:++eventId.current,time:new Date().toLocaleTimeString("ar"),title,detail,tone},...old].slice(0,35));if(permission&&"Notification"in window&&Notification.permission==="granted")new Notification("BTC RADAR · "+title,{body:detail});},[permission]);
 const refresh=useCallback(async()=>{setBusy(true);try{const root=market==="futures"?"/fapi/v1":"/api/v3";const [t,c,c5,c15,a,b]=await Promise.all([binance<Ticker>(market,root+"/ticker/24hr?symbol=BTCUSDT"),binance<unknown[][]>(market,root+"/klines?symbol=BTCUSDT&interval="+interval+"&limit=300"),binance<unknown[][]>(market,root+"/klines?symbol=BTCUSDT&interval=5m&limit=300"),binance<unknown[][]>(market,root+"/klines?symbol=BTCUSDT&interval=15m&limit=300"),binance<unknown[][]>(market,root+"/klines?symbol=BTCUSDT&interval=1h&limit=240"),binance<unknown[][]>(market,root+"/klines?symbol=BTCUSDT&interval=4h&limit=240")]);setTicker(t);setCandles(parseCandles(c));setM5(parseCandles(c5));setM15(parseCandles(c15));setH1(parseCandles(a));setH4(parseCandles(b));setConnected(true);setError("");if(market==="futures"){
 const results=await Promise.allSettled([
  binance<{symbol:string;markPrice:string;lastFundingRate:string;time:number}>(market,"/fapi/v1/premiumIndex?symbol=BTCUSDT"),
  binance<{symbol:string;openInterest:string;time:number}>(market,"/fapi/v1/openInterest?symbol=BTCUSDT"),
  binance<{symbol:string;longShortRatio:string;longAccount:string;shortAccount:string;timestamp:number}[]>(market,"/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=15m&limit=1")
 ]);
 const premium=results[0].status==="fulfilled"?results[0].value:null;
 const open=results[1].status==="fulfilled"?results[1].value:null;
 const ratio=results[2].status==="fulfilled"?results[2].value[0]:null;
 const markValue=premium?Number(premium.markPrice):0;
 const oiValue=open?Number(open.openInterest):0;
 const loaded=results.filter(x=>x.status==="fulfilled").length;
 setFutures({
  funding:premium&&Number.isFinite(Number(premium.lastFundingRate))?(Number(premium.lastFundingRate)*100).toFixed(4)+"%":"غير متاح",
  mark:premium&&markValue>0?fmt(markValue):"غير متاح",
  oi:open&&oiValue>0?oiValue.toLocaleString("en-US",{maximumFractionDigits:3})+" BTC · "+(oiValue*markValue).toLocaleString("en-US",{maximumFractionDigits:0})+" USDT":"غير متاح",
  longShort:ratio&&Number.isFinite(Number(ratio.longShortRatio))?Number(ratio.longShortRatio).toFixed(3)+":1":"غير متاح",
  note:loaded===3?"تم التحقق من المقاييس الأربعة عبر واجهات Binance USDⓈ-M REST.": "تم تحميل "+loaded+" من 3 مصادر للعقود الآجلة؛ قد تكون بعض المقاييس غير متاحة مؤقتًا."
 });
}else setFutures({funding:"—",mark:"—",oi:"—",longShort:"—",note:"اختر Futures لعرض بيانات العقود الآجلة."});}catch(e){setConnected(false);setError(e instanceof Error?e.message:"تعذر الاتصال بـ Binance");}finally{setBusy(false);}},[market,interval]);
 useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(timer);},[refresh]);
 useEffect(()=>{const host=market==="futures"?"wss://fstream.binance.com/ws/":"wss://stream.binance.com:9443/ws/";let stopped=false,ws:WebSocket|undefined,retry:number|undefined;const connect=()=>{if(stopped)return;ws=new WebSocket(host+"btcusdt@ticker");ws.onopen=()=>setConnected(true);ws.onmessage=e=>{try{const d=JSON.parse(e.data);setTicker(p=>({...p,lastPrice:d.c,priceChangePercent:d.P,highPrice:p?.highPrice||d.h,lowPrice:p?.lowPrice||d.l,volume:p?.volume||d.v}));}catch{}};ws.onclose=()=>{if(!stopped)retry=window.setTimeout(connect,4000);};ws.onerror=()=>setConnected(false);};connect();return()=>{stopped=true;if(retry)window.clearTimeout(retry);ws?.close();};},[market]);
 useEffect(()=>{if(market!=="futures")return;let stopped=false,ws:WebSocket|undefined,retry:number|undefined;const connect=()=>{if(stopped)return;ws=new WebSocket("wss://fstream.binance.com/ws/btcusdt@markPrice@1s");ws.onmessage=e=>{try{const d=JSON.parse(e.data) as {p?:string;r?:string};if(d.p&&d.r)setFutures(prev=>({...prev,mark:Number(d.p).toLocaleString("en-US",{maximumFractionDigits:2}),funding:(Number(d.r)*100).toFixed(4)+"%",note:"السعر العادل ومعدل التمويل من بث Binance Futures المباشر."}));}catch{}};ws.onclose=()=>{if(!stopped)retry=window.setTimeout(connect,4000);};};connect();return()=>{stopped=true;if(retry)window.clearTimeout(retry);ws?.close();};},[market]);
 useEffect(()=>{
  if(!last||!previous||last.time===lastAnalyzed.current)return;
  lastAnalyzed.current=last.time;
  const intervalMs:Record<Interval,number>={"1m":60000,"5m":300000,"15m":900000,"1h":3600000,"4h":14400000,"1d":86400000};
  const expired=!!lastBreak&&!lastBreak.retested&&last.time-lastBreak.time>intervalMs[interval]*8;
  if(expired){addEvent("انتهت متابعة إعادة الاختبار","لم تعد الشموع إلى مستوى الاختراق خلال 8 شموع؛ ستبدأ مراقبة فرص جديدة","warn");setLastBreak(null);}
  const volumeRatio=avgVol?last.volume/avgVol:0;
  setVolumeStatus((volumeRatio>=1.2?"حجم مرتفع":volumeRatio<.8?"حجم منخفض":"حجم قريب من المتوسط")+" · "+fmt(volumeRatio,2)+"x من متوسط 20 شمعة");
  if(volumeRatio>=1.2)addEvent("ارتفاع حجم التداول","الحجم "+fmt(volumeRatio,2)+"x من متوسط آخر 20 شمعة مكتملة","good");
  else if(volumeRatio<.8)addEvent("انخفاض حجم التداول","الحجم "+fmt(volumeRatio,2)+"x من متوسط آخر 20 شمعة مكتملة","warn");
  // Scan the latest eight completed candles, not only the newest one.
  // This also restores an active breakout when the page is opened after it happened.
  if(!lastBreak||lastBreak.retested||expired){
   const recent=closed.slice(-9);
   const candidates:{side:"up"|"down";level:number;time:number;index:number}[]=[];
   for(let i=1;i<recent.length;i++){
    const before=recent[i-1],bar=recent[i];
    for(const level of levels.all){
     if(before.close<=level.price&&bar.close>level.price)candidates.push({side:"up",level:level.price,time:bar.time,index:i});
     else if(before.close>=level.price&&bar.close<level.price)candidates.push({side:"down",level:level.price,time:bar.time,index:i});
    }
   }
   const candidate=candidates.sort((a,b)=>a.time-b.time).at(-1);
   if(candidate&&(!lastBreak||candidate.time>lastBreak.time)){
    const stillValid=candidate.side==="up"?last.close>candidate.level:last.close<candidate.level;
    if(stillValid){
     const retestBand=Math.max(atr(closed)*.15,price*.00035);
     const retested=recent.slice(candidate.index+1).some(bar=>candidate.side==="up"
      ?bar.low<=candidate.level+retestBand&&bar.close>candidate.level
      :bar.high>=candidate.level-retestBand&&bar.close<candidate.level);
     setLastBreak({side:candidate.side,level:candidate.level,time:candidate.time,retested});
     const barsAgo=recent.length-1-candidate.index;
     const detail=(barsAgo===0?"أغلقت آخر شمعة":"حدث قبل "+barsAgo+" شمعة مكتملة")+
      (candidate.side==="up"?" فوق المقاومة ":" تحت الدعم ")+fmt(candidate.level)+
      " · الحجم "+fmt(volumeRatio,2)+"x من المتوسط"+
      (volumeRatio>=1.2?" (داعم)":" (الحجم لا يؤكد وحده)")+
      (retested?" · رُصدت إعادة اختبار ناجحة":" · "+(barsAgo===0?"راقب إعادة الاختبار":"الاختراق ما زال قائماً؛ راقب إعادة الاختبار"));
     addEvent(candidate.side==="up"?(barsAgo===0?"اختراق المقاومة بإغلاق شمعة":"اختراق سابق ما زال قائماً"):(barsAgo===0?"كسر الدعم بإغلاق شمعة":"كسر سابق ما زال قائماً"),detail,candidate.side==="up"?"good":"bad");
    }
   }
  }
 },[last?.time,levels.all,avgVol,addEvent,lastBreak,interval]);
 useEffect(()=>{
  if(!lastBreak||!last||last.time<=lastBreak.time||lastBreak.retested)return;
  const band=Math.max(atr(closed)*.15,price*.00035);
  if(lastBreak.side==="up"&&last.low<=lastBreak.level+band&&last.close>lastBreak.level){setLastBreak({...lastBreak,retested:true});addEvent("إعادة اختبار ناجحة للمقاومة","عاد السعر إلى مستوى المقاومة وأغلق فوق "+fmt(lastBreak.level),"good");}
  else if(lastBreak.side==="down"&&last.high>=lastBreak.level-band&&last.close<lastBreak.level){setLastBreak({...lastBreak,retested:true});addEvent("إعادة اختبار ناجحة للدعم المكسور","عاد السعر للمنطقة وفشل في استعادتها","good");}
  else if(lastBreak.side==="up"&&last.close<lastBreak.level-band){addEvent("فشل الاختراق","أغلق السعر مجددًا أسفل "+fmt(lastBreak.level),"bad");setLastBreak(null);}
  else if(lastBreak.side==="down"&&last.close>lastBreak.level+band){addEvent("فشل الكسر","استعاد السعر مستوى "+fmt(lastBreak.level),"bad");setLastBreak(null);}
 },[last?.time,lastBreak,price,closed,addEvent]);
 useEffect(()=>{if(!price)return;const r=levels.resistance[0],s=levels.support[0],near=Math.max(levels.atr*.35,price*.0015);let key="";if(r&&r.price-price<=near)key="r"+Math.round(r.price);else if(s&&price-s.price<=near)key="s"+Math.round(s.price);if(key&&key!==lastProximity.current){lastProximity.current=key;const l=key[0]==="r"?r:s;addEvent(key[0]==="r"?"اقترب السعر من المقاومة":"اقترب السعر من الدعم","السعر "+fmt(price)+" · المستوى "+fmt(l!.price),"warn");}if(!key)lastProximity.current="";},[price,levels.resistance,levels.support,levels.atr,addEvent]);
 const enable=async()=>{if(!("Notification"in window)){setError("المتصفح لا يدعم إشعارات النظام.");return;}const p=await Notification.requestPermission();setPermission(p==="granted");};
 const r=levels.resistance[0],s=levels.support[0];
 const closedBars=(items:Candle[])=>items.filter(x=>x.closeTime<Date.now());
 const trendOf=(items:Candle[])=>{const closes=closedBars(items).map(x=>x.close);const e20=ema(closes,20),e50=ema(closes,50);if(closes.length<55||!e20.length||!e50.length)return "unknown" as const;const a=e20.at(-1)!,b=e50.at(-1)!,p=closes.at(-1)!;return p>a&&a>b?"up" as const:p<a&&a<b?"down" as const:"side" as const;};
 const trend1h=trendOf(h1),trend4h=trendOf(h4);
 const trendLabel=(v:"up"|"down"|"side"|"unknown")=>v==="up"?"صاعد":v==="down"?"هابط":v==="side"?"عرضي / متذبذب":"بيانات غير كافية";
 const overallTrend=trend1h==="up"&&trend4h==="up"?"up":trend1h==="down"&&trend4h==="down"?"down":"mixed";
 const proximityLimit=Math.max(levels.atr*.35,price*.0015);
 const nearResistance=!!r&&r.price-price<=proximityLimit;
 const nearSupport=!!s&&price-s.price<=proximityLimit;
 const decisionTitle=lastBreak?(lastBreak.side==="up"?(lastBreak.retested?"اختراق صاعد مع إعادة اختبار ناجحة":"اختراق صاعد أولي — انتظر إعادة الاختبار"):(lastBreak.retested?"كسر هابط مع إعادة اختبار ناجحة":"كسر هابط أولي — انتظر إعادة الاختبار")):nearResistance?"السعر يقترب من المقاومة — راقب رد الفعل":nearSupport?"السعر يقترب من الدعم — راقب رد الفعل":overallTrend==="up"?"الاتجاه متوافق صعودًا — انتظر فرصة مؤكدة":overallTrend==="down"?"الاتجاه متوافق هبوطًا — انتظر فرصة مؤكدة":"لا توجد أفضلية واضحة — الانتظار";
 const decisionTone=lastBreak?(lastBreak.side==="up"?"good":"bad"):nearResistance||nearSupport?"warn":"neutral";
 const bullTarget=levels.resistance.find(x=>r&&x.price>r.price);
 const bearTarget=levels.support.find(x=>s&&x.price<s.price);
 const bullStatus=lastBreak?.side==="up"?(lastBreak.retested?"تمت إعادة الاختبار بنجاح؛ راقب الثبات فوق المستوى":"تم الإغلاق فوق المستوى؛ انتظر إعادة الاختبار"):r?"انتظار إغلاق شمعة "+interval+" فوق "+fmt(r.price):"لا يوجد مستوى مقاومة صالح في البيانات";
 const bearStatus=lastBreak?.side==="down"?(lastBreak.retested?"تمت إعادة الاختبار بنجاح؛ راقب استمرار الرفض":"تم الإغلاق تحت المستوى؛ انتظر إعادة الاختبار"):s?"انتظار إغلاق شمعة "+interval+" تحت "+fmt(s.price):"لا يوجد مستوى دعم صالح في البيانات";
 return <main className="shell"><header className="topbar"><a className="brand" href="/BTC-RADAR/"><span className="brand-icon">₿</span><span><b>BTC RADAR</b><small>رادار السوق والتحليل</small></span></a><nav className="smart-nav"><a className="active" href="/">لوحة التحليل الموحدة</a><a href="/BTC-RADAR/breakout/">رادار الكسر</a></nav><div className={"connection "+(connected?"online":"offline")}><i/>{connected?"متصل ببيانات Binance":"بانتظار الاتصال"}</div><button className="refresh" onClick={()=>void refresh()} disabled={busy}><RefreshCw size={16}/> تحديث</button></header>
 <section className="hero"><div><div className="eyebrow">شارت مباشر متزامن مع Binance</div><h1>الشارت الذكي <span>BTCUSDT</span></h1><p>مستويات موحّدة من قمم وقيعان 5د و15د وساعة و4 ساعات، والسعر المرجعي واحد للشارت والتنبيهات والسيناريوهات.</p></div><div className="market-toggle"><button className={market==="spot"?"selected":""} onClick={()=>{setMarket("spot");setLastBreak(null);}}>Spot فوري</button><button className={market==="futures"?"selected":""} onClick={()=>{setMarket("futures");setLastBreak(null);}}>Futures عقود</button></div></section>
 {error&&<div className="error-banner"><WifiOff size={16}/>{error}</div>}
 <section className="price-panel panel"><div><span className="muted">السعر المباشر · USDT</span><div className="price-line"><strong>{price?fmt(price):"—"}</strong><span className={Number(ticker?.priceChangePercent||0)>=0?"positive":"negative"}>{ticker?(Number(ticker.priceChangePercent)>=0?"+":"")+fmt(Number(ticker.priceChangePercent))+"%":"—"}</span></div><small className="muted">تحديث لحظي عبر WebSocket</small></div><div className="stats"><div><span>أعلى 24 ساعة</span><b>{ticker?fmt(Number(ticker.highPrice)):"—"}</b></div><div><span>أدنى 24 ساعة</span><b>{ticker?fmt(Number(ticker.lowPrice)):"—"}</b></div><div><span>حجم 24 ساعة</span><b>{ticker?fmt(Number(ticker.volume),0)+" BTC":"—"}</b></div></div></section>
 {market==="futures"&&<section className="panel"><div className="section-head"><div><h2>بيانات العقود الآجلة</h2><p className="muted">Funding · Mark Price · Open Interest · Long/Short</p></div><span className="muted">Binance USDⓈ-M</span></div><div className="metric-grid"><div className="metric"><span>Funding Rate</span><b>{futures.funding}</b></div><div className="metric"><span>Mark Price</span><b>{futures.mark}</b></div><div className="metric"><span>Open Interest</span><b>{futures.oi}</b></div><div className="metric"><span>Long / Short</span><b>{futures.longShort}</b></div></div><p className="muted">{futures.note}</p></section>}
 <section className="decision-panel panel">
  <div className="decision-heading"><div><div className="eyebrow">قراءة آلية للسوق · BTCUSDT</div><h2>ماذا يحدث الآن؟</h2></div><span className={"decision-chip "+decisionTone}>{decisionTone==="good"?"إشارة مرصودة":decisionTone==="bad"?"إشارة هبوط":decisionTone==="warn"?"مراقبة":"انتظار"}</span></div>
  <div className={"decision-main "+decisionTone}><strong>{decisionTitle}</strong><p>{lastBreak?"المستوى المرصود "+fmt(lastBreak.level)+" · "+(lastBreak.retested?"إعادة الاختبار مرصودة":"إعادة الاختبار لم تكتمل"):nearResistance?"المقاومة القريبة "+fmt(r!.price):nearSupport?"الدعم القريب "+fmt(s!.price):"لا توجد إشارة اختراق أو كسر مكتملة الآن"}</p></div>
  <div className="trend-grid"><div><span>اتجاه الساعة</span><b>{trendLabel(trend1h)}</b></div><div><span>اتجاه 4 ساعات</span><b>{trendLabel(trend4h)}</b></div><div><span>الخلاصة</span><b>{overallTrend==="up"?"توافق صاعد":overallTrend==="down"?"توافق هابط":"غير متوافق"}</b></div></div>
  <div className="scenario-grid">
   <article className="scenario-card bull"><h3>سيناريو الصعود</h3><div className="scenario-line"><span>شرط التأكيد</span><b>{r?"إغلاق "+interval+" فوق "+fmt(r.price):"غير متاح"}</b></div><div className="scenario-line"><span>الهدف التالي</span><b>{bullTarget?fmt(bullTarget.price):"لا يوجد مستوى تالٍ"}</b></div><div className="scenario-line"><span>إلغاء السيناريو</span><b>{r?"إغلاق "+interval+" مجددًا تحت "+fmt(r.price):"غير محدد"}</b></div><p>{bullStatus}</p></article>
   <article className="scenario-card bear"><h3>سيناريو الهبوط</h3><div className="scenario-line"><span>شرط التأكيد</span><b>{s?"إغلاق "+interval+" تحت "+fmt(s.price):"غير متاح"}</b></div><div className="scenario-line"><span>الهدف التالي</span><b>{bearTarget?fmt(bearTarget.price):"لا يوجد مستوى تالٍ"}</b></div><div className="scenario-line"><span>إلغاء السيناريو</span><b>{s?"إغلاق "+interval+" مجددًا فوق "+fmt(s.price):"غير محدد"}</b></div><p>{bearStatus}</p></article>
  </div>
  <p className="decision-note">هذه شروط مراقبة وليست أوامر دخول. لا يُعد لمس المستوى اختراقًا أو كسرًا؛ نعتمد إغلاق الشمعة، ثم ننتظر إعادة الاختبار. الأهداف تعرض فقط عند وجود مستوى سعري تالٍ مستخرج من البيانات.</p>
 </section>
 <section className="panel chart-panel"><div className="section-head"><div><h2>الشموع والمستويات</h2><p className="muted">كل مستوى ناتج من توافق قمم وقيعان عدة أطر زمنية؛ السعر المعروض نقطة فعلية من الشموع</p></div><div className="timeframes">{frames.map(x=><button key={x} className={interval===x?"selected":""} onClick={()=>{setInterval(x);setLastBreak(null);lastAnalyzed.current=0;}}>{x}</button>)}</div></div><div className="smart-chart-wrap"><Chart candles={candles} price={price} levels={levels}/></div><div className="chart-foot"><span>{last?"آخر شمعة مكتملة: "+new Date(last.time).toLocaleString("ar"):"بانتظار الشموع"}</span><span>مستويات متوافقة: 5د / 15د / 1س / 4س · الشارت {interval}</span></div></section>
 <section className="smart-levels-grid"><article className="panel"><div className="section-head"><div><h2>المقاومات</h2><p className="muted">أقرب أربعة مستويات فوق السعر الحالي</p></div><span className="res-title">R</span></div><div className="level-list">{levels.resistance.slice(0,4).map((level,i)=><div className="alert-state" key={"res"+i}><b className="res-title">R{i+1} · {fmt(level.price)}</b><span>المسافة {fmt(level.price-price)} USDT · القوة {level.strength} · {level.timeframes.join(" / ")}</span></div>)}{!levels.resistance.length&&<p className="muted">لا توجد مقاومات أعلى السعر ضمن البيانات الحالية.</p>}</div></article><article className="panel"><div className="section-head"><div><h2>الدعوم</h2><p className="muted">أقرب أربعة مستويات تحت السعر الحالي</p></div><span className="sup-title">S</span></div><div className="level-list">{levels.support.slice(0,4).map((level,i)=><div className="alert-state" key={"sup"+i}><b className="sup-title">S{i+1} · {fmt(level.price)}</b><span>المسافة {fmt(price-level.price)} USDT · القوة {level.strength} · {level.timeframes.join(" / ")}</span></div>)}{!levels.support.length&&<p className="muted">لا توجد دعوم أدنى السعر ضمن البيانات الحالية.</p>}</div></article></section><section className="grid"><article className="panel"><div className="section-head"><div><h2>حالة الاختراق وإعادة الاختبار</h2><p className="muted">لا نعلن تأكيدًا قبل إغلاق شمعة مكتملة</p></div><Bell size={18}/></div><div className="alert-state"><b>الاختراق / الكسر</b><span>{lastBreak?(lastBreak.side==="up"?"اختراق صاعد أولي":"كسر هابط أولي")+" عند "+fmt(lastBreak.level):"لا يوجد اختراق مؤكد حاليًا"}</span></div><div className="alert-state"><b>إعادة الاختبار</b><span>{lastBreak?(lastBreak.retested?"تم رصد إعادة اختبار ناجحة":"بانتظار عودة السعر إلى مستوى الاختراق"):"لا توجد إعادة اختبار قيد المتابعة"}</span></div><div className="alert-state"><b>حجم التداول</b><span>{volumeStatus}</span></div><div className="alert-state"><b>الاقتراب</b><span>{r&&r.price-price<=Math.max(levels.atr*.35,price*.0015)?"السعر قريب من مستوى المقاومة":s&&price-s.price<=Math.max(levels.atr*.35,price*.0015)?"السعر قريب من مستوى الدعم":"السعر ليس ضمن نطاق التنبيه القريب"}</span></div><button className="refresh" onClick={()=>void enable()}><Bell size={15}/>{permission?"الإشعارات مفعّلة":"تفعيل إشعارات المتصفح"}</button><p className="muted">تعمل الإشعارات أثناء فتح الصفحة، وقد لا تصل بعد إغلاق المتصفح.</p></article><article className="panel"><div className="section-head"><div><h2>سجل التنبيهات</h2><p className="muted">أحدث 35 حدثًا تم رصده</p></div><button className="clear-btn" onClick={()=>setEvents([])}>مسح السجل</button></div><div className="alert-log">{events.length?events.map(e=><div className={"log-item "+e.tone} key={e.id}><time>{e.time}</time><div><b>{e.title}</b><span>{e.detail}</span></div></div>):<div className="empty-log">لم يتم رصد أحداث بعد. ستظهر التنبيهات هنا.</div>}</div></article></section>
 <div className="disclaimer">الاقتراب تنبيه مسافة فقط. الاختراق أو الكسر الأولي يحتاج إغلاق شمعة وحجم تداول داعم، ثم تقييم إعادة الاختبار. لا ينفذ الموقع أي صفقة تلقائيًا.</div><footer><span>BTC RADAR · الشارت الذكي</span><span>مصدر البيانات Binance</span><span>تحليل BTCUSDT متعدد الأطر</span></footer></main>;
}
