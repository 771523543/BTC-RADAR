"use client";
import {useEffect,useMemo,useState} from "react";
import {binance,calculateLevels,ema,parseCandles,rsi,type Candle} from "@/lib/market";

type Frame="15m"|"1h"|"4h";
type Pattern={name:string;kind:"bull"|"bear"|"neutral";description:string;score:number};
const fmt=(n:number)=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const body=(c:Candle)=>Math.abs(c.close-c.open);
const bullish=(c:Candle)=>c.close>c.open;
const bearish=(c:Candle)=>c.close<c.open;
function detect(c:Candle[]):Pattern[]{
 const x=c.slice(-3);if(x.length<3)return [];
 const [a,b,z]=x, out:Pattern[]=[];
 const range=Math.max(z.high-z.low,1e-9),bdy=body(z),upper=z.high-Math.max(z.open,z.close),lower=Math.min(z.open,z.close)-z.low;
 if(bdy/range<.1)out.push({name:"دوجي Doji",kind:"neutral",description:"تردد بين المشترين والبائعين؛ يحتاج تأكيد الشمعة التالية.",score:0});
 if(lower>=Math.max(bdy*2,range*.45)&&upper<=range*.2&&bdy/range<.38)out.push({name:"مطرقة Hammer",kind:"bull",description:"ظل سفلي طويل وجسم صغير؛ تكون أقوى بعد هبوط وعند دعم.",score:1});
 if(upper>=Math.max(bdy*2,range*.45)&&lower<=range*.2&&bdy/range<.38)out.push({name:"مطرقة مقلوبة / شهاب",kind:"bear",description:"ظل علوي طويل؛ يحتاج سياق صعود ومقاومة لتأكيد الانعكاس.",score:1});
 if(bullish(a)&&bearish(z)&&z.open>=a.close&&z.close<=a.open&&body(z)>body(a))out.push({name:"ابتلاع بيعي Bearish Engulfing",kind:"bear",description:"جسم هابط يبتلع جسم الشمعة السابقة.",score:2});
 if(bearish(a)&&bullish(z)&&z.open<=a.close&&z.close>=a.open&&body(z)>body(a))out.push({name:"ابتلاع شرائي Bullish Engulfing",kind:"bull",description:"جسم صاعد يبتلع جسم الشمعة السابقة.",score:2});
 if(bearish(a)&&body(a)>0&&body(b)/Math.max(a.high-a.low,1e-9)<.35&&bullish(z)&&z.close>(a.open+a.close)/2)out.push({name:"نجمة الصباح Morning Star",kind:"bull",description:"هبوط ثم شمعة تردد ثم إغلاق صاعد يتجاوز منتصف الشمعة الأولى.",score:2});
 if(bullish(a)&&body(a)>0&&body(b)/Math.max(a.high-a.low,1e-9)<.35&&bearish(z)&&z.close<(a.open+a.close)/2)out.push({name:"نجمة المساء Evening Star",kind:"bear",description:"صعود ثم شمعة تردد ثم إغلاق هابط دون منتصف الشمعة الأولى.",score:2});
 return out;
}
export default function CandleAnalysis(){
 const [frame,setFrame]=useState<Frame>("15m");
 const [candles,setCandles]=useState<Candle[]>([]);
 const [frames,setFrames]=useState<{m5:Candle[];m15:Candle[];h1:Candle[];h4:Candle[]}|null>(null);
 const [price,setPrice]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{
  let active=true;
  const load=async()=>{
   try{
    const [ticker,a,b,c,d]=await Promise.all([
     binance<{price:string}>("futures","/fapi/v1/ticker/price?symbol=BTCUSDT"),
     ...["5m","15m","1h","4h"].map(v=>binance<unknown[][]>("futures",`/fapi/v1/klines?symbol=BTCUSDT&interval=${v}&limit=180`))
    ]);
    if(!active)return;
    const parsed={m5:parseCandles(a),m15:parseCandles(b),h1:parseCandles(c),h4:parseCandles(d)};
    setFrames(parsed);setPrice(Number(ticker.price));
    const chosen=frame==="15m"?parsed.m15:frame==="1h"?parsed.h1:parsed.h4;
    setCandles(chosen.filter(v=>v.closeTime<Date.now()));setError("");setLoading(false);
   }catch{if(active){setError("تعذر تحميل بيانات الشموع من Binance Futures.");setLoading(false);}}
  };
  setLoading(true);void load();const timer=setInterval(load,15000);
  return()=>{active=false;clearInterval(timer);};
 },[frame]);
 const result=useMemo(()=>{
  if(!candles.length||!frames||!price)return null;
  const closed=candles.filter(x=>x.closeTime<Date.now()),closes=closed.map(x=>x.close);
  const last=closed.at(-1)!;const e20=ema(closes,20).at(-1)??null,e50=ema(closes,50).at(-1)??null,rv=rsi(closes,14);
  const patterns=detect(closed);
  const levels=calculateLevels(frames.m5,frames.m15,frames.h1,frames.h4,price);
  const support=levels.support[0],resistance=levels.resistance[0];
  const nearSupport=!!support&&Math.abs(price-support.price)<=Math.max(levels.atr*.65,price*.0015);
  const nearResistance=!!resistance&&Math.abs(resistance.price-price)<=Math.max(levels.atr*.65,price*.0015);
  const bull=patterns.filter(p=>p.kind==="bull").reduce((s,p)=>s+p.score,0),bear=patterns.filter(p=>p.kind==="bear").reduce((s,p)=>s+p.score,0);
  let score=bull-bear;
  if(e20!==null&&e50!==null){if(price>e20&&e20>e50)score+=1.5;else if(price<e20&&e20<e50)score-=1.5;}
  if(rv!==null){if(rv<35)score+=.5;if(rv>65)score-=.5;}
  if(nearSupport)score+=.75;if(nearResistance)score-=.75;
  const bullishPattern=patterns.some(p=>p.kind==="bull"&&p.score>=1),bearishPattern=patterns.some(p=>p.kind==="bear"&&p.score>=1);
  let decision:"شراء"|"بيع"|"انتظار"="انتظار",reason="الإشارات غير متوافقة أو لا توجد أفضلية واضحة؛ انتظر إغلاق شمعة جديدة.";
  if(score>=2.5&&bullishPattern&&e20!==null&&price>e20){decision="شراء";reason="نموذج صاعد مع توافق الاتجاه فوق EMA 20/50 أو دعم قريب. انتظر تأكيدًا إضافيًا ولا تعتبرها ضمانًا.";}
  else if(score<=-2.5&&bearishPattern&&e20!==null&&price<e20){decision="بيع";reason="نموذج هابط مع توافق الاتجاه أسفل EMA 20/50 أو مقاومة قريبة. انتظر تأكيدًا إضافيًا ولا تعتبرها ضمانًا.";}
  else if(nearSupport&&nearResistance)reason="السعر بين مناطق قريبة؛ لا توجد مساحة حركة كافية لإشارة واضحة.";
  return {last,patterns,e20,e50,rv,support,resistance,nearSupport,nearResistance,decision,reason,score};
 },[candles,frames,price]);
 return <section className="panel candle-analysis">
  <div className="analysis-head"><div><span className="eyebrow">ANALYSIS ENGINE · BTCUSDT</span><h3>محرك تحليل الشموع والمؤشرات</h3><p>تحليل آخر ثلاث شموع مغلقة مع RSI وEMA والدعم والمقاومة.</p></div><span className="analysis-live">● بيانات مباشرة</span></div>
  <div className="analysis-controls"><div><small>السعر الحالي</small><b>{price?fmt(price)+" USDT":"—"}</b></div><div className="analysis-frames">{(["15m","1h","4h"] as Frame[]).map(v=><button key={v} className={frame===v?"active":""} onClick={()=>setFrame(v)}>{v}</button>)}</div></div>
  {loading?<p className="analysis-muted">جارٍ تحليل الشموع...</p>:error?<p className="analysis-error">{error}</p>:result&&<>
   <div className={"analysis-decision "+(result.decision==="شراء"?"buy":result.decision==="بيع"?"sell":"wait")}><small>حكم المساعد النهائي · {frame}</small><strong>{result.decision}</strong><p>{result.reason}</p></div>
   <div className="analysis-metrics"><div><small>RSI (14)</small><b>{result.rv===null?"—":result.rv.toFixed(1)}</b><span>{result.rv===null?"غير متاح":result.rv>=70?"تشبع شرائي":result.rv<=30?"تشبع بيعي":"منطقة متوسطة"}</span></div><div><small>EMA 20</small><b>{result.e20?fmt(result.e20):"—"}</b><span>{result.e20?(price>result.e20?"السعر فوقه":"السعر تحته"):"غير متاح"}</span></div><div><small>EMA 50</small><b>{result.e50?fmt(result.e50):"—"}</b><span>{result.e50?(result.e20&&result.e20>result.e50?"اتجاه EMA صاعد": "اتجاه EMA غير صاعد"):"غير متاح"}</span></div></div>
   <div className="analysis-patterns"><h4>النماذج المكتشفة في آخر 3 شموع</h4>{result.patterns.length?result.patterns.map((p,i)=><div key={p.name+i}><b>{p.name}</b><span>{p.description}</span></div>):<p>لم يكتشف نموذجًا واضحًا في آخر ثلاث شموع مغلقة.</p>}</div>
   <div className="analysis-levels"><div><small>أقرب دعم</small><b>{result.support?fmt(result.support.price):"—"}</b><span>{result.nearSupport?"السعر قريب من الدعم":"ليس قريبًا"}</span></div><div><small>أقرب مقاومة</small><b>{result.resistance?fmt(result.resistance.price):"—"}</b><span>{result.nearResistance?"السعر قريب من المقاومة":"ليس قريبًا"}</span></div></div>
   <p className="analysis-last">آخر شمعة مغلقة: {new Date(result.last.closeTime).toLocaleString("ar")} · إغلاقها {fmt(result.last.close)} · التحديث كل 15 ثانية.</p>
  </>}
  <p className="analysis-disclaimer">النتيجة تحليل احتمالي وليست توصية مالية أو أمر تنفيذ. لا يصدر شراء أو بيع إلا عند توافق النموذج مع المؤشرات والسياق السعري؛ وإلا فالقرار انتظار.</p>
 </section>;
}
