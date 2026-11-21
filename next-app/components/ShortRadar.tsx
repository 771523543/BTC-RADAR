"use client";
import {useEffect,useMemo,useState} from "react";
import {binance,calculateLevels,parseCandles,type Candle} from "@/lib/market";
type Data={price:number;mark:number;m5:Candle[];m15:Candle[];h1:Candle[];h4:Candle[];time:number};
const f=(n:number)=>n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
export default function ShortRadar(){
 const [d,setD]=useState<Data|null>(null),[error,setError]=useState("");
 useEffect(()=>{let on=true;const load=async()=>{try{const [t,m,a,b,c,e]=await Promise.all([binance<{price:string}>("futures","/fapi/v1/ticker/price?symbol=BTCUSDT"),binance<{markPrice:string}>("futures","/fapi/v1/premiumIndex?symbol=BTCUSDT"),...["5m","15m","1h","4h"].map(x=>binance<unknown[][]>("futures",`/fapi/v1/klines?symbol=BTCUSDT&interval=${x}&limit=180`))]);if(on){setD({price:+t.price,mark:+m.markPrice,m5:parseCandles(a),m15:parseCandles(b),h1:parseCandles(c),h4:parseCandles(e),time:Date.now()});setError("");}}catch{if(on)setError("تعذر جلب بيانات العقود الآجلة؛ نحاول التحديث تلقائيًا.");}};void load();const id=setInterval(load,15000);return()=>{on=false;clearInterval(id)};},[]);
 const a=useMemo(()=>{if(!d)return null;const lv=calculateLevels(d.m5,d.m15,d.h1,d.h4,d.price),bars=d.m15.filter(x=>x.closeTime<Date.now()),last=bars.at(-1),prev=bars.at(-2),live=d.m15.at(-1),r=lv.resistance[0],s=lv.support[0];
 const reject=!!(last&&r&&last.high>=r.price-lv.atr*.25&&last.close<r.price&&last.close<last.open);
 const broke=!!(last&&s&&last.close<s.price&&last.open>=s.price);
 const retest=!!(last&&prev&&s&&prev.close<s.price&&last.high>=s.price-lv.atr*.15&&last.close<s.price);
 const ok=retest;
 let title="لا توجد إشارة شورت مؤكدة",desc="السعر لم يكمل شروط الشورت حتى الآن.";
 if(ok){title="الشورت تأكد مبدئيًا";desc="حدث كسر وإعادة اختبار فاشلة حسب شموع 15 دقيقة المغلقة. راقب بقاء السعر أسفل المستوى."}
 else if(broke){title="كسر دعم بإغلاق 15 دقيقة";desc="تم الإغلاق أسفل الدعم. الخطوة التالية هي انتظار إعادة اختبار المستوى من الأسفل؛ لا تطارد الهبوط."}
 else if(reject){title="رفض واضح من المقاومة";desc="شمعة 15 دقيقة أغلقت هابطة بعد ملامسة المقاومة. لم يتأكد الشورت قبل كسر الدعم."}
 else if(last&&last.close>last.open){title="آخر شمعة مغلقة صاعدة";desc="الإغلاق الأخير صاعد؛ الأفضل عدم فتح شورت قبل ظهور ضعف أو كسر دعم."}
 const near=(level:number)=>Math.abs(d.price-level)<=Math.max(lv.atr*.2,d.price*.00035);
 let nowTitle="السعر يتحرك داخل النطاق";
 let nowDesc=`السعر الآن ${f(d.price)} بين الدعم ${s?f(s.price):"غير محدد"} والمقاومة ${r?f(r.price):"غير محددة"}.`;
 if(r&&near(r.price)){nowTitle="السعر يختبر المقاومة الآن";nowDesc=`السعر يبعد ${f(Math.abs(r.price-d.price))} عن المقاومة ${f(r.price)}. إذا فشل في تجاوزها وظهرت شمعة 15 دقيقة هابطة، تصبح فرصة الشورت تحت المراقبة؛ التأكيد بكسر الدعم.`;}
 else if(s&&near(s.price)){nowTitle="السعر يضغط على الدعم الآن";nowDesc=`السعر يبعد ${f(Math.abs(d.price-s.price))} عن الدعم ${f(s.price)}. لا تبيع قبل إغلاق 15 دقيقة تحته؛ الارتداد من الدعم يبطل فكرة الشورت مؤقتًا.`;}
 else if(live&&live.close<live.open){nowTitle="الحركة الحالية تميل للهبوط";nowDesc="شمعة 15 دقيقة الحالية هابطة، لكن ما زالت تتكوّن. لا يُعد ذلك كسرًا مؤكدًا إلا بعد إغلاقها أسفل الدعم.";}
 else if(live&&live.close>live.open){nowTitle="الحركة الحالية تميل للصعود";nowDesc="شمعة 15 دقيقة الحالية صاعدة، وما زالت تتكوّن. ضغط الشراء الحالي لا يدعم استعجال الشورت.";}
 const entry=ok&&last?last.close:null;
 const stop=ok&&last&&s?Math.max(last.high,s.price+lv.atr*.35):null;
 const t1=ok&&s&&entry!==null?Math.min(s.price-lv.atr*.25,entry-lv.atr*.6):null;
 const t2=t1!==null?t1-lv.atr:null;
 let action="الآن: لا تفتح شورت. انتظر إغلاق 15 دقيقة أسفل الدعم، ثم إعادة اختباره وفشل السعر في استعادته.";
 if(ok)action="الآن: تحقق شرط الشورت مبدئيًا. راقب الثبات أسفل المستوى، وألغِ السيناريو إذا عاد وأغلق فوقه.";
 else if(broke)action="الآن: تم كسر الدعم بإغلاق. انتظر إعادة الاختبار من الأسفل؛ لا تدخل لمجرد أن السعر هبط.";
 else if(reject)action="الآن: ظهر رفض من المقاومة. انتظر كسر الدعم؛ الرفض وحده ليس تأكيد دخول.";
 else if(r&&near(r.price))action="الآن: السعر عند المقاومة تقريبًا. انتظر إغلاقًا هابطًا؛ لا تدخل قبل تأكيد كسر الدعم.";
 else if(s&&near(s.price))action="الآن: السعر عند الدعم تقريبًا. انتظر إغلاق 15 دقيقة تحته؛ إذا ارتد فلا تفتح شورت.";
 return {lv,r,s,last,live,title,desc,ok,broke,entry,stop,t1,t2,nowTitle,nowDesc,action};
 },[d]);
 return <section className="panel short-radar"><div className="short-radar-head"><div><span className="eyebrow">BTCUSDT · Binance Futures</span><h3>رادار الشورت</h3><p className="muted">ماذا يحدث الآن؟ وما الخطوة التالية؟</p></div><span className="short-live-dot">● مباشر</span></div>
 {!d?<p className="muted">{error||"جارٍ تحميل السعر والشموع..."}</p>:<>
 <div className="short-price-strip"><div><small>السعر المباشر</small><b>{f(d.price)}</b></div><div><small>Mark Price</small><b>{f(d.mark)}</b></div><div><small>آخر تحديث</small><b>{new Date(d.time).toLocaleTimeString("ar")}</b></div></div>
 <div className="short-status"><small>ماذا يحدث الآن؟</small><h4>{a?.nowTitle}</h4><p>{a?.nowDesc}</p></div>
 <div className="short-status"><small>نتيجة الشموع المغلقة</small><h4>{a?.title}</h4><p>{a?.desc}</p></div>
 <div className="short-level-grid"><div><small>أقرب مقاومة</small><b>{a?.r?f(a.r.price):"—"}</b></div><div><small>أقرب دعم</small><b>{a?.s?f(a.s.price):"—"}</b></div><div><small>آخر إغلاق 15 دقيقة</small><b>{a?.last?f(a.last.close):"—"}</b></div></div>
 <div className="short-plan"><h4>ماذا تعمل الآن؟</h4><p>{a?.action}</p><h4>مستويات الشورت بعد التأكيد</h4><p><b>الدخول المرجعي:</b> {a?.entry?f(a.entry)+" USDT":"لا يوجد دخول مؤكد الآن"}</p><p><b>وقف/إبطال:</b> {a?.stop?f(a.stop)+" USDT":"يُحسب بعد تحقق الإشارة"}</p><p><b>الهدف الأول:</b> {a?.t1?f(a.t1)+" USDT":"لا يُحدد قبل التأكيد"}</p><p><b>الهدف الثاني:</b> {a?.t2?f(a.t2)+" USDT":"لا يُحدد قبل التأكيد"}</p></div>
 <p className="short-footnote">السعر يتحدث كل 15 ثانية. وصف الحركة الحالية يستخدم الشمعة الجارية، أما تأكيد الكسر والرفض فيعتمد على شموع 15 دقيقة المغلقة. تحليل احتمالي وليس ضمانًا أو أمر تداول؛ لا ينفذ الموقع صفقات حقيقية.{error?" "+error:""}</p>
 </>}</section>;
}