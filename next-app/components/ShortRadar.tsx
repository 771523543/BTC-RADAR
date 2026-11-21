"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {binance,calculateLevels,parseCandles,type Candle,type Level} from "@/lib/market";
type Data={price:number;mark:number;m5:Candle[];m15:Candle[];h1:Candle[];h4:Candle[];time:number};
type Watch={price:number;side:"support"|"resistance";started:number;result:string;resultAt:number|null};
const f=(n:number)=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
export default function ShortRadar(){
 const [d,setD]=useState<Data|null>(null),[error,setError]=useState("");
 const watch=useRef<Watch|null>(null);
 useEffect(()=>{let on=true;const load=async()=>{try{const [t,m,a,b,c,e]=await Promise.all([binance<{price:string}>("futures","/fapi/v1/ticker/price?symbol=BTCUSDT"),binance<{markPrice:string}>("futures","/fapi/v1/premiumIndex?symbol=BTCUSDT"),...["5m","15m","1h","4h"].map(x=>binance<unknown[][]>("futures",`/fapi/v1/klines?symbol=BTCUSDT&interval=${x}&limit=180`))]);if(on){setD({price:+t.price,mark:+m.markPrice,m5:parseCandles(a),m15:parseCandles(b),h1:parseCandles(c),h4:parseCandles(e),time:Date.now()});setError("");}}catch{if(on)setError("تعذر جلب بيانات العقود الآجلة؛ نحاول التحديث تلقائيًا.");}};void load();const id=setInterval(load,15000);return()=>{on=false;clearInterval(id)};},[]);
 const a=useMemo(()=>{if(!d)return null;
 const lv=calculateLevels(d.m5,d.m15,d.h1,d.h4,d.price),bars=d.m5.filter(x=>x.closeTime<Date.now()),last=bars.at(-1),live=d.m5.at(-1);
 // Keep watching the SAME pivot through every refresh. New nearby pivots cannot replace it.
 if(watch.current?.resultAt && Date.now()-watch.current.resultAt>60000)watch.current=null;
 if(!watch.current){
  const candidates=lv.all.filter(x=>x.price>0).sort((x,y)=>Math.abs(x.price-d.price)-Math.abs(y.price-d.price));
  const pick=candidates[0];
  if(pick)watch.current={price:pick.price,side:pick.price>=d.price?"resistance":"support",started:Date.now(),result:"قيد المراقبة — لم يصل السعر للمستوى بعد",resultAt:null};
 }
 const w=watch.current;
 if(w&&last&&!w.resultAt){
  const tol=Math.max(lv.atr*.18,d.price*.00025);
  const touched=w.side==="resistance"?last.high>=w.price-tol:last.low<=w.price+tol;
  if(touched){
   if(w.side==="resistance"){
    if(last.close>w.price+tol){w.result="تم اختراق المقاومة بإغلاق 5 دقائق";w.resultAt=Date.now();}
    else if(last.close<w.price-tol&&last.close<last.open){w.result="رفضت المقاومة السعر وأغلقت الشمعة أسفلها";w.resultAt=Date.now();}
    else w.result="وصل السعر للمقاومة؛ الشمعة لم تحسم النتيجة بعد";
   }else{
    if(last.close<w.price-tol){w.result="تم كسر الدعم بإغلاق 5 دقائق";w.resultAt=Date.now();}
    else if(last.close>w.price+tol&&last.close>last.open){w.result="ارتد السعر من الدعم وأغلقت الشمعة فوقه";w.resultAt=Date.now();}
    else w.result="وصل السعر للدعم؛ الشمعة لم تحسم النتيجة بعد";
   }
  }
 }
 const distance=w?Math.abs(d.price-w.price):0;
 const near=distance<=Math.max(lv.atr*.25,d.price*.0004);
 const status=w?.result||"لا يوجد مستوى قيد المراقبة";
 let action="استمر في متابعة المستوى نفسه؛ لا تغيّر المستوى لمجرد ظهور مستوى جديد أقرب.";
 if(w?.resultAt)action="تم تسجيل نتيجة المستوى. ستبقى النتيجة ظاهرة، ثم يبدأ الرادار مراقبة المستوى التالي بعد دقيقة.";
 else if(near&&w?.side==="resistance")action="السعر وصل إلى نطاق المقاومة التي نراقبها. انتظر إغلاق شمعة 5 دقائق لتحديد: رفض أم اختراق.";
 else if(near&&w?.side==="support")action="السعر وصل إلى نطاق الدعم الذي نراقبه. انتظر إغلاق شمعة 5 دقائق لتحديد: ارتداد أم كسر.";
 else if(w)action=`نراقب المستوى ${f(w.price)} ولن ننتقل عنه. المتبقي لوصول السعر إليه ${f(distance)} USDT.`;
 const supports=lv.support[0],resistances=lv.resistance[0];
 return {lv,last,live,w,distance,near,status,action,supports,resistances};
 },[d]);
 return <section className="panel short-radar"><div className="short-radar-head"><div><span className="eyebrow">BTCUSDT · Binance Futures</span><h3>رادار الشورت</h3><p className="muted">يثبت على المستوى الذي بدأ مراقبته حتى يسجل النتيجة.</p></div><span className="short-live-dot">● مباشر</span></div>
 {!d?<p className="muted">{error||"جارٍ تحميل السعر والشموع..."}</p>:<>
 <div className="short-price-strip"><div><small>السعر المباشر</small><b>{f(d.price)}</b></div><div><small>Mark Price</small><b>{f(d.mark)}</b></div><div><small>آخر تحديث</small><b>{new Date(d.time).toLocaleTimeString("ar")}</b></div></div>
 <div className="short-status"><small>المستوى المثبّت قيد المتابعة</small><h4>{a?.w?.side==="resistance"?"مقاومة نراقبها":"دعم نراقبه"} · {a?.w?f(a.w.price):"لم يتحدد"}</h4><p>{a?.status}</p><p>{a?.action}</p><p>السعر الحالي: {f(d.price)} USDT · المسافة عن المستوى: {a?f(a.distance):"—"} USDT</p></div>
 <div className="short-level-grid"><div><small>أقرب مقاومة متغيرة</small><b>{a?.resistances?f(a.resistances.price):"—"}</b></div><div><small>أقرب دعم متغير</small><b>{a?.supports?f(a.supports.price):"—"}</b></div><div><small>آخر إغلاق 5 دقائق</small><b>{a?.last?f(a.last.close):"—"}</b></div></div>
 <div className="short-plan"><h4>قراءة نتيجة المستوى</h4><p>إذا كانت مقاومة: نسجل رفض السعر أو الاختراق بعد إغلاق الشمعة.</p><p>إذا كان دعمًا: نسجل الارتداد أو الكسر بعد إغلاق الشمعة.</p><p>بعد تسجيل النتيجة تبقى ظاهرة دقيقة، ثم يختار الرادار مستوى جديدًا للمراقبة.</p></div>
 <p className="short-footnote">السعر يتحدث كل 15 ثانية. المستوى المثبّت لا يتغير بسبب ظهور مستويات أحدث. الحسم يعتمد على شموع 5 دقائق المغلقة؛ لا ينفذ الموقع صفقات حقيقية.{error?" "+error:""}</p>
 </>}</section>;
}