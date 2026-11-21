"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {binance,calculateLevels,parseCandles,type Candle} from "@/lib/market";

type Data={price:number;mark:number;m5:Candle[];m15:Candle[];h1:Candle[];h4:Candle[];time:number};
type Watch={
 price:number;side:"support"|"resistance";started:number;
 result:string;resultAt:number|null;
 phase:"approach"|"retest"|"done";
 breakCloseTime?:number;
};
const STORAGE_KEY="btc-radar-short-watch-v2";
const f=(n:number)=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

export default function ShortRadar(){
 const [d,setD]=useState<Data|null>(null),[error,setError]=useState("");
 const watch=useRef<Watch|null>(null);
 const [restored,setRestored]=useState(false);

 // Restore the active level so a page refresh does not make the radar forget it.
 useEffect(()=>{
  try{
   const raw=localStorage.getItem(STORAGE_KEY);
   if(raw){
    const saved=JSON.parse(raw) as Watch;
    if(saved&&Number.isFinite(saved.price)&&
      (saved.side==="support"||saved.side==="resistance")&&
      ["approach","retest","done"].includes(saved.phase)) watch.current=saved;
   }
  }catch{localStorage.removeItem(STORAGE_KEY);}
  setRestored(true);
 },[]);

 useEffect(()=>{
  let on=true;
  const load=async()=>{
   try{
    const [t,m,a,b,c,e]=await Promise.all([
     binance<{price:string}>("futures","/fapi/v1/ticker/price?symbol=BTCUSDT"),
     binance<{markPrice:string}>("futures","/fapi/v1/premiumIndex?symbol=BTCUSDT"),
     ...["5m","15m","1h","4h"].map(x=>binance<unknown[][]>("futures",`/fapi/v1/klines?symbol=BTCUSDT&interval=${x}&limit=180`))
    ]);
    if(on){setD({price:+t.price,mark:+m.markPrice,m5:parseCandles(a),m15:parseCandles(b),h1:parseCandles(c),h4:parseCandles(e),time:Date.now()});setError("");}
   }catch{if(on)setError("تعذر جلب بيانات العقود الآجلة؛ نحاول التحديث تلقائيًا.");}
  };
  void load();const id=setInterval(load,15000);
  return()=>{on=false;clearInterval(id);};
 },[]);

 const a=useMemo(()=>{
  if(!d||!restored)return null;
  const lv=calculateLevels(d.m5,d.m15,d.h1,d.h4,d.price);
  const bars=d.m5.filter(x=>x.closeTime<Date.now());
  const last=bars.at(-1);
  if(!last)return null;

  // Keep a completed result visible briefly, then select a fresh level.
  if(watch.current?.phase==="done"&&watch.current.resultAt&&Date.now()-watch.current.resultAt>60000){
   watch.current=null;
  }

  // Choose a level by its position relative to price, not by the pivot's old label.
  // Once selected, it remains locked through breakout/breakdown and retest.
  if(!watch.current){
   const candidates=lv.all.filter(x=>x.price>0&&x.price!==d.price)
    .map(x=>({...x,side:(x.price>d.price?"resistance":"support") as "support"|"resistance"}))
    .sort((x,y)=>Math.abs(x.price-d.price)-Math.abs(y.price-d.price));
   const pick=candidates[0];
   if(pick)watch.current={
    price:pick.price,side:pick.side,started:last.closeTime,
    result:"تم اختيار المستوى وتثبيته. ننتظر شمعة 5 دقائق جديدة تتفاعل معه.",
    resultAt:null,phase:"approach"
   };
  }

  const w=watch.current;
  if(w&&w.phase!=="done"&&last.closeTime>w.started){
   const tol=Math.max(lv.atr*.18,d.price*.00025);
   if(w.phase==="approach"){
    const touched=w.side==="resistance"?last.high>=w.price-tol:last.low<=w.price+tol;
    if(touched&&w.side==="support"&&last.close<w.price-tol){
     w.result="تم كسر الدعم بإغلاق شمعة 5 دقائق. ثبّتنا المستوى وننتظر إعادة اختباره من الأسفل.";
     w.phase="retest";w.breakCloseTime=last.closeTime;
    }else if(touched&&w.side==="resistance"&&last.close>w.price+tol){
     w.result="تم اختراق المقاومة بإغلاق شمعة 5 دقائق. ثبّتنا المستوى وننتظر إعادة اختباره من الأعلى.";
     w.phase="retest";w.breakCloseTime=last.closeTime;
    }else if(touched&&w.side==="support"&&last.close>w.price+tol&&last.close>last.open){
     w.result="ارتداد من الدعم: أغلقت شمعة 5 دقائق فوق المستوى.";
     w.phase="done";w.resultAt=Date.now();
    }else if(touched&&w.side==="resistance"&&last.close<w.price-tol&&last.close<last.open){
     w.result="رفض من المقاومة: أغلقت شمعة 5 دقائق أسفل المستوى.";
     w.phase="done";w.resultAt=Date.now();
    }else if(touched){
     w.result="السعر يختبر المستوى؛ لم تحسم شمعة 5 دقائق النتيجة بعد.";
    }
   }else if(w.phase==="retest"&&last.closeTime>(w.breakCloseTime??0)){
    if(w.side==="support"){
     const retested=last.high>=w.price-tol;
     if(retested&&last.close<w.price-tol){
      w.result="إعادة اختبار ناجحة للدعم المكسور: عاد السعر من الأسفل وفشل في الإغلاق فوقه — تأكيد مبدئي لاستمرار الهبوط.";
      w.phase="done";w.resultAt=Date.now();
     }else if(last.close>w.price+tol){
      w.result="فشل كسر الدعم: أغلقت شمعة 5 دقائق فوق المستوى — أُلغي سيناريو استمرار الهبوط.";
      w.phase="done";w.resultAt=Date.now();
     }else w.result="كسر الدعم قائم؛ ننتظر عودة السعر للمستوى من الأسفل. المستوى ما زال مثبتًا.";
    }else{
     const retested=last.low<=w.price+tol;
     if(retested&&last.close>w.price+tol){
      w.result="إعادة اختبار ناجحة للمقاومة المخترقة: عاد السعر من الأعلى وثبت فوقها — تأكيد مبدئي لاستمرار الصعود.";
      w.phase="done";w.resultAt=Date.now();
     }else if(last.close<w.price-tol){
      w.result="فشل اختراق المقاومة: أغلقت شمعة 5 دقائق أسفل المستوى — أُلغي سيناريو استمرار الصعود.";
      w.phase="done";w.resultAt=Date.now();
     }else w.result="اختراق المقاومة قائم؛ ننتظر عودة السعر إليها من الأعلى والثبات فوقها. المستوى ما زال مثبتًا.";
    }
   }
  }

  const distance=w?Math.abs(d.price-w.price):0;
  const near=!!w&&distance<=Math.max(lv.atr*.25,d.price*.0004);
  let action="لا تغيّر المستوى. الرادار ينتظر تفاعل شمعة 5 دقائق مغلقة جديدة.";
  if(w?.phase==="retest"&&w.side==="support")action="لا تعتبر الكسر وحده فرصة مكتملة. انتظر إعادة الاختبار من الأسفل؛ الفشل في الإغلاق فوق الدعم يعطي تأكيدًا مبدئيًا للهبوط، والإغلاق فوقه يلغي السيناريو.";
  else if(w?.phase==="retest"&&w.side==="resistance")action="لا تعتبر الاختراق وحده تأكيدًا. انتظر إعادة الاختبار من الأعلى؛ الثبات فوق المقاومة يؤكد مبدئيًا استمرار الصعود، والإغلاق أسفلها يلغي السيناريو.";
  else if(w?.phase==="done")action="حُسم تفاعل هذا المستوى. ستبقى النتيجة ظاهرة دقيقة، ثم يبدأ الرادار اختيار مستوى جديد.";
  else if(near&&w?.side==="support")action="السعر قريب من الدعم المثبّت. ننتظر إغلاق 5 دقائق لتحديد: ارتداد أم كسر.";
  else if(near&&w?.side==="resistance")action="السعر قريب من المقاومة المثبّتة. ننتظر إغلاق 5 دقائق لتحديد: رفض أم اختراق.";
  else if(w)action=`نراقب المستوى ${f(w.price)} ولا ننتقل عنه. المسافة الحالية ${f(distance)} USDT.`;

  return {lv,last,w,distance,near,action,
   supports:lv.support[0],resistances:lv.resistance[0]};
 },[d,restored]);

 // Persist every state transition, including the locked level and retest phase.
 useEffect(()=>{
  if(!restored)return;
  if(watch.current)localStorage.setItem(STORAGE_KEY,JSON.stringify(watch.current));
  else localStorage.removeItem(STORAGE_KEY);
 },[a,restored]);

 return <section className="panel short-radar">
  <div className="short-radar-head"><div><span className="eyebrow">BTCUSDT · Binance Futures</span><h3>رادار الشورت</h3><p className="muted">متابعة مستوى ثابت حتى اكتمال الكسر أو الاختراق وإعادة الاختبار.</p></div><span className="short-live-dot">● مباشر</span></div>
  {!d||!a?<p className="muted">{error||"جارٍ تحميل السعر والشموع..."}</p>:<>
   <div className="short-price-strip"><div><small>السعر المباشر</small><b>{f(d.price)}</b></div><div><small>Mark Price</small><b>{f(d.mark)}</b></div><div><small>آخر تحديث</small><b>{new Date(d.time).toLocaleTimeString("ar")}</b></div></div>
   <div className="short-status"><small>المستوى المثبّت قيد المتابعة</small><h4>{a.w?.side==="resistance"?"مقاومة نراقبها":"دعم نراقبه"} · {a.w?f(a.w.price):"لم يتحدد"}</h4><p>{a.w?.result||"لا يوجد مستوى قيد المراقبة"}</p><p>{a.action}</p><p>السعر الحالي: {f(d.price)} USDT · المسافة عن المستوى: {f(a.distance)} USDT</p></div>
   <div className="short-level-grid"><div><small>أقرب مقاومة متغيرة</small><b>{a.resistances?f(a.resistances.price):"—"}</b></div><div><small>أقرب دعم متغير</small><b>{a.supports?f(a.supports.price):"—"}</b></div><div><small>آخر إغلاق 5 دقائق</small><b>{f(a.last.close)}</b></div></div>
   <div className="short-plan"><h4>ماذا تعني النتيجة؟</h4><p>الدعم: كسر بإغلاق 5 دقائق ثم إعادة اختبار من الأسفل؛ الفشل في استعادة المستوى يؤكد مبدئيًا استمرار الهبوط.</p><p>المقاومة: اختراق بإغلاق 5 دقائق ثم إعادة اختبار من الأعلى؛ الثبات فوقها يؤكد مبدئيًا استمرار الصعود.</p><p>إذا أغلقت الشمعة في الجهة المعاكسة أثناء إعادة الاختبار، يعتبر الرادار الكسر أو الاختراق فاشلًا ويلغي السيناريو.</p></div>
   <p className="short-footnote">السعر يتحدث كل 15 ثانية، والتحليل يعتمد على شموع 5 دقائق المغلقة الجديدة فقط. المستوى ومرحلة المتابعة محفوظان عند تحديث الصفحة. الرادار لا ينفذ صفقات حقيقية ولا يضمن النتائج.{error?" "+error:""}</p>
  </>}
 </section>;
}
