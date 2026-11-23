"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Frame = "5m" | "15m" | "1h" | "4h";
type C = { time:number; closeTime:number; open:number; high:number; low:number; close:number; volume:number };
type Trend4H = { ema20:number; ema50:number; direction:"صاعد"|"هابط"|"محايد" };
type Data = { price:number; mark:number; funding:number; oi:number; oiDelta:number|null; candles:C[]; chartCandles:C[]; trend1h:Trend4H; trend4h:Trend4H; updated:number };
type Side = "LONG" | "SHORT" | "NO TRADE";
type BreakType = "BROKEN_SUPPORT" | "BROKEN_RESISTANCE";
type BreakStatus = "instant" | "confirmed" | "retest" | "retest-confirmed" | "retest-bounce" | "retest-rejection" | "reclaimed" | "expired";
type BreakTracker = {frame:Frame;level:number|null;type:BreakType|null;status:BreakStatus|null;remaining:number;lastCandleTime:number;detail:string;impactLong:number;impactShort:number};
type ReportCategory = "candles" | "levels" | "trades";
type ReportEvent = "CANDLE_CLOSE" | "OPEN_TRADE" | "SUPPORT_BREAK" | "RESISTANCE_BREAK" | "RETEST_OR_RECLAIM" | "TRADE_CLOSED_OR_EXPIRED" | "STREAK_GUARD";
type EventReport = {id:string;time:number;frame:Frame;price:number;category:ReportCategory;events:ReportEvent[];title:string;reason:string;interpretation:string;figures:string;followUp:string;fullText:string};
const hosts=["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com"];
async function api<T>(path:string):Promise<T>{let err:unknown;for(const h of hosts){try{const r=await fetch(h+path,{cache:"no-store"});if(!r.ok)throw new Error("Binance HTTP "+r.status);return await r.json() as T;}catch(e){err=e;}}throw err instanceof Error?err:new Error("Binance API unavailable");}
const fmt=(v:number,d=2)=>Number.isFinite(v)?v.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const avg=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function ema(a:number[],p:number){if(a.length<p)return 0;let v=avg(a.slice(0,p)),k=2/(p+1);for(let i=p;i<a.length;i++)v=a[i]*k+v*(1-k);return v;}
function rsi(a:number[],p=14){if(a.length<=p)return 50;let g=0,l=0;for(let i=1;i<=p;i++){let d=a[i]-a[i-1];if(d>0)g+=d;else l-=d;}let ag=g/p,al=l/p;for(let i=p+1;i<a.length;i++){let d=a[i]-a[i-1];ag=(ag*(p-1)+Math.max(0,d))/p;al=(al*(p-1)+Math.max(0,-d))/p;}return al===0?100:100-100/(1+ag/al);}
function atr(c:C[],p=14){if(c.length<=p)return 0;const tr=c.slice(1).map((x,i)=>Math.max(x.high-x.low,Math.abs(x.high-c[i].close),Math.abs(x.low-c[i].close)));if(tr.length<p)return 0;let value=avg(tr.slice(0,p));for(let i=p;i<tr.length;i++)value=(value*(p-1)+tr[i])/p;return value;}
type Pattern={name:string;nameAr:string;kind:"bull"|"bear"|"neutral";score:number;type:string;confirmation:number;status:"confirmed"|"pending"|"failed"|"weak"|"none";detail:string;signal:C|null;volumeConfirmed:boolean};
type PatternContext={support:number|null;resistance:number|null;nearSupport:boolean;nearResistance:boolean;sweepLow:boolean;sweepHigh:boolean;atr:number;volumeRatio:number};
function pattern(c:C[],ctx:PatternContext):Pattern{
 const empty:Pattern={name:"لا يوجد نموذج قوي",nameAr:"لا يوجد نموذج واضح",kind:"neutral",score:0,type:"—",confirmation:0,status:"none",detail:"لا يوجد نموذج مكتمل ضمن آخر الشموع المغلقة",signal:null,volumeConfirmed:false};
 if(c.length<4)return empty;
 const n=c.length,confirmCandle=c[n-1],a=c[n-3],b=c[n-2],prior=c[n-4];
 const body=(z:C)=>Math.abs(z.close-z.open);
 const range=(z:C)=>Math.max(0,z.high-z.low);
 const upper=(z:C)=>Math.max(0,z.high-Math.max(z.open,z.close));
 const lower=(z:C)=>Math.max(0,Math.min(z.open,z.close)-z.low);
 const safeRatio=(v:number,d:number)=>d>0&&Number.isFinite(v)&&Number.isFinite(d)?v/d:0;
 const bull=(z:C)=>z.close>z.open,bear=(z:C)=>z.close<z.open;
 const small=(z:C)=>safeRatio(body(z),range(z))<=.32;
 const large=(z:C)=>safeRatio(body(z),range(z))>=.55;
 type Candidate={name:string;nameAr:string;kind:"bull"|"bear"|"neutral";type:string;signal:C;model:C[];baseScore:number};
 let found:Candidate|null=null;
 const priorDown=prior.close>a.close,priorUp=prior.close<a.close;
 const rb=range(b),bb=body(b),bu=upper(b),bl=lower(b),bodyRatio=safeRatio(bb,rb);
 // One-candle reversal patterns: the signal is the penultimate closed candle;
 // the latest closed candle is reserved exclusively for confirmation.
 if(!found&&bl>=2*bb&&small(b)&&bu<=Math.max(bb,rb*.25)&&priorDown)
  found={name:"Hammer / Bullish Pin Bar",nameAr:"المطرقة / شمعة دبوس صاعدة",kind:"bull",type:"انعكاسي صاعد",signal:b,model:[b],baseScore:8};
 if(!found&&bu>=2*bb&&small(b)&&bl<=Math.max(bb,rb*.25)&&priorUp)
  found={name:"Shooting Star / Bearish Pin Bar",nameAr:"الشهاب / شمعة دبوس هابطة",kind:"bear",type:"انعكاسي هابط",signal:b,model:[b],baseScore:8};
 const doji=bodyRatio<=.1,dragonfly=doji&&safeRatio(bu,rb)<=.1&&safeRatio(bl,rb)>=.65,gravestone=doji&&safeRatio(bl,rb)<=.1&&safeRatio(bu,rb)>=.65;
 if(!found&&dragonfly&&priorDown)found={name:"Dragonfly Doji",nameAr:"دوجي اليعسوب عند القاع",kind:"bull",type:"انعكاسي صاعد",signal:b,model:[b],baseScore:7};
 if(!found&&gravestone&&priorUp)found={name:"Gravestone Doji",nameAr:"دوجي شاهد القبر عند القمة",kind:"bear",type:"انعكاسي هابط",signal:b,model:[b],baseScore:7};
 if(!found&&!doji&&safeRatio(bb,rb)>=.9&&safeRatio(bu,rb)<=.05&&safeRatio(bl,rb)<=.05)
  found={name:"Marubozu",nameAr:"ماروبوزو · شمعة زخم",kind:bull(b)?"bull":"bear",type:"استمراري",signal:b,model:[b],baseScore:7};
 // Two-candle reversal patterns, with the last closed candle confirming them.
 if(!found&&bear(a)&&bull(b)&&b.open<=a.close&&b.close>=a.open&&body(b)>=body(a))
  found={name:"Bullish Engulfing",nameAr:"الابتلاع الشرائي",kind:"bull",type:"انعكاسي صاعد",signal:b,model:[a,b],baseScore:9};
 if(!found&&bull(a)&&bear(b)&&b.open>=a.close&&b.close<=a.open&&body(b)>=body(a))
  found={name:"Bearish Engulfing",nameAr:"الابتلاع البيعي",kind:"bear",type:"انعكاسي هابط",signal:b,model:[a,b],baseScore:9};
 // Three-candle reversal formations; the fourth/latest candle confirms the pattern.
 if(!found&&bear(prior)&&small(a)&&bull(b)&&large(prior)&&b.close>(prior.open+prior.close)/2)
  found={name:"Morning Star",nameAr:"نجمة الصباح",kind:"bull",type:"انعكاسي صاعد",signal:b,model:[prior,a,b],baseScore:10};
 if(!found&&bull(prior)&&small(a)&&bear(b)&&large(prior)&&b.close<(prior.open+prior.close)/2)
  found={name:"Evening Star",nameAr:"نجمة المساء",kind:"bear",type:"انعكاسي هابط",signal:b,model:[prior,a,b],baseScore:10};
 // Indecision patterns are informational and never generate directional points.
 if(!found&&doji)found={name:"Doji",nameAr:"دوجي · حيرة وتردد",kind:"neutral",type:"حيرة",signal:b,model:[b],baseScore:0};
 if(!found&&bodyRatio<=.35&&safeRatio(Math.min(bu,bl),rb)>=.15&&Math.abs(bu-bl)/Math.max(rb,1e-12)<=.35)
  found={name:"Spinning Top",nameAr:"سبينينغ توب · قمة دوارة",kind:"neutral",type:"حيرة",signal:b,model:[b],baseScore:0};
 if(!found)return empty;
 const modelHigh=Math.max(...found.model.map(z=>z.high)),modelLow=Math.min(...found.model.map(z=>z.low));
 const confirmation=found.kind==="bull"?modelHigh:found.kind==="bear"?modelLow:(modelHigh+modelLow)/2;
 const status=found.kind==="bull"?(confirmCandle.close>confirmation?"confirmed":"pending"):found.kind==="bear"?(confirmCandle.close<confirmation?"confirmed":"pending"):"pending";
 const volumeConfirmed=ctx.volumeRatio>=1.1;
 const signalLow=found.signal.low,signalHigh=found.signal.high;
 const nearSupportContext=ctx.nearSupport||ctx.sweepLow||(ctx.support!==null&&ctx.atr>0&&Math.abs(signalLow-ctx.support)<=Math.max(ctx.atr*.5,ctx.support*.001));
 const nearResistanceContext=ctx.nearResistance||ctx.sweepHigh||(ctx.resistance!==null&&ctx.atr>0&&Math.abs(signalHigh-ctx.resistance)<=Math.max(ctx.atr*.5,ctx.resistance*.001));
 const correctContext=found.kind==="bull"?nearSupportContext:found.kind==="bear"?nearResistanceContext:true;
 const weakContext=found.type.startsWith("انعكاسي")&&!correctContext;
 const finalStatus=weakContext?"weak":status;
 const score=found.kind==="neutral"||weakContext||status!=="confirmed"?0:found.baseScore*(volumeConfirmed?1:.65);
 const detail=weakContext?"ضعيف السياق: النموذج الانعكاسي ظهر بعيداً عن "+(found.kind==="bull"?"الدعم / Sweep أسفل الدعم":"المقاومة / Sweep أعلى المقاومة")+".":status==="confirmed"?(volumeConfirmed?"تأكيد بإغلاق الشمعة التالية مع فوليوم ≥ 1.1× المتوسط":"تأكيد بالإغلاق؛ الفوليوم أقل من 1.1× المتوسط"):"بانتظار التأكيد عند "+fmt(confirmation)+" ⏳ · يلزم إغلاق الشمعة التالية "+(found.kind==="bull"?"فوق المستوى":found.kind==="bear"?"تحت المستوى":"خارج نطاق الحيرة");
 return {...found,confirmation,status:finalStatus,score,detail,volumeConfirmed};
}
type Plan={side:Side;confidence:number;longScore:number;shortScore:number;longRaw:number;shortRaw:number;longImpact:number;shortImpact:number;postBreakStatus:string;postBreakDetail:string;postBreakLevel:number|null;postBreakType:BreakType|null;postBreakRemaining:number;longReasons:string[];shortReasons:string[];reason:string;entry:number;sl:number;tp1:number;tp2:number;riskDistance:number;atr:number;rangeWidth:number;rangeSqueeze:boolean;rangeExpansion:boolean;emaDistanceAtr:number;emaExtended:boolean;riskWarning:string;pattern:string;patternAr:string;patternType:string;patternScore:number;patternKind:"bull"|"bear"|"neutral";patternVolumeConfirmed:boolean;confirmation:number;confirmationStatus:string;confirmationDetail:string;volumeText:string;sweepText:string;fundingText:string;oiText:string;rsi:number;ema20:number;ema50:number;support:number|null;resistance:number|null;supportDistance:number|null;resistanceDistance:number|null;priceLocation:string;levelWarning:string;levelDetail:string;overallTrend:string;trend1h:string;counterTrend:boolean;chop:boolean;chopReason:string;lowLiquidity:boolean;postBreakEventType:string;postBreakConfirmation:string;postBreakElapsed:number;postBreakWindow:number;postBreakDistance:number|null;postBreakDistancePct:number|null;postBreakDistanceAtr:number|null;postBreakBand:number;postBreakBandLow:number|null;postBreakBandHigh:number|null;postBreakInvalidation:number|null;postBreakVolumeRatio:number;postBreakVolumeState:string;postBreakWick:string;postBreakSweep:string;postBreakQuality:number;postBreakQualityFactors:string[];postBreakLifecycle:string;postBreakMachineText:string};
const clamp=(v:number,min=0,max=100)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):min;
function analyze(s:Data,frame:Frame,tracker:BreakTracker):Plan{
 const c=s.candles,last=c[c.length-1],closes=c.map(x=>x.close),a=atr(c),e20=ema(closes,20),e50=ema(closes,50),rv=rsi(closes);
 const safePrice=Number.isFinite(s.price)&&s.price>0?s.price:last.close,entry=safePrice;
 const volAvg=avg(c.slice(-21,-1).map(x=>x.volume).filter(Number.isFinite)),volRatio=volAvg>0&&Number.isFinite(last.volume)?last.volume/volAvg:0;
 const levelWindow=c.slice(-80),pivotSupports:number[]=[],pivotResistances:number[]=[];
 for(let i=2;i<levelWindow.length-2;i++){const z=levelWindow[i];if(z.low<=levelWindow[i-1].low&&z.low<=levelWindow[i-2].low&&z.low<=levelWindow[i+1].low&&z.low<=levelWindow[i+2].low)pivotSupports.push(z.low);if(z.high>=levelWindow[i-1].high&&z.high>=levelWindow[i-2].high&&z.high>=levelWindow[i+1].high&&z.high>=levelWindow[i+2].high)pivotResistances.push(z.high);}
 const prevClose=c.length>1?c[c.length-2].close:last.open;
 const supportCandidates=pivotSupports.filter(x=>x<=prevClose),resistanceCandidates=pivotResistances.filter(x=>x>=prevClose);
 const support=supportCandidates.length?Math.max(...supportCandidates):(levelWindow.length?Math.min(...levelWindow.map(x=>x.low)):null);
 const resistance=resistanceCandidates.length?Math.min(...resistanceCandidates):(levelWindow.length?Math.max(...levelWindow.map(x=>x.high)):null);
 const supportDistance=support===null?null:Math.abs(entry-support)/entry*100,resistanceDistance=resistance===null?null:Math.abs(resistance-entry)/entry*100;
 const nearThreshold=Math.max(.15,(a/entry*100)*.5),nearDistance=Math.max(entry*nearThreshold/100,a*.5);
 const nearSupport=support!==null&&entry>=support&&last.close>=support&&supportDistance!==null&&supportDistance<=nearThreshold;
 const nearResistance=resistance!==null&&entry<=resistance&&last.close<=resistance&&resistanceDistance!==null&&resistanceDistance<=nearThreshold;
 const supportBounce=support!==null&&entry>=support&&last.low<=support+nearDistance&&last.close>support&&last.close>last.open;
 const resistanceRejection=resistance!==null&&entry<=resistance&&last.high>=resistance-nearDistance&&last.close<resistance&&last.close<last.open;
 const priceBelowSupport=support!==null&&Number.isFinite(support)&&Number.isFinite(entry)&&entry<support,priceAboveResistance=resistance!==null&&Number.isFinite(resistance)&&Number.isFinite(entry)&&entry>resistance;
 const supportSweep=support!==null&&last.low<support&&last.close>support&&last.close>last.open;
 const resistanceSweep=resistance!==null&&last.high>resistance&&last.close<resistance&&last.close<last.open;
 const supportEvidence=!priceAboveResistance&&((!priceBelowSupport&&(nearSupport||supportBounce))||supportSweep);
 const resistanceEvidence=(!priceAboveResistance&&(nearResistance||resistanceRejection))||resistanceSweep;
 const priorWindow=c.slice(-21,-1),oldLow=priorWindow.length?Math.min(...priorWindow.map(x=>x.low)):last.low,oldHigh=priorWindow.length?Math.max(...priorWindow.map(x=>x.high)):last.high;
 const sweepLow=last.low<oldLow&&last.close>oldLow,sweepHigh=last.high>oldHigh&&last.close<oldHigh;
 const pat=pattern(c,{support,resistance,nearSupport:nearSupport&&!priceBelowSupport,nearResistance:nearResistance&&!priceAboveResistance,sweepLow:sweepLow||supportSweep,sweepHigh:sweepHigh||resistanceSweep,atr:a,volumeRatio:volRatio});
 const atrBuffer=Math.max(a*.2,entry*.0001),breakdownConfirmed=support!==null&&last.close<support-atrBuffer&&last.close<last.open&&volRatio>=1.05,breakoutConfirmed=resistance!==null&&last.close>resistance+atrBuffer&&last.close>last.open&&volRatio>=1.05;
 const supportScoreEvidence=supportEvidence&&!(pat.status==="weak"&&pat.kind==="bull");
 const resistanceScoreEvidence=resistanceEvidence&&!(pat.status==="weak"&&pat.kind==="bear");
 const supportOverrun=support!==null&&priceBelowSupport?support-entry:0;
 const resistanceOverrun=resistance!==null&&priceAboveResistance?entry-resistance:0;
 const supportOverrunPct=support!==null&&support>0?supportOverrun/support*100:0;
 const resistanceOverrunPct=resistance!==null&&resistance>0?resistanceOverrun/resistance*100:0;
 const supportBreakConfirmed=breakdownConfirmed,resistanceBreakConfirmed=breakoutConfirmed;
 // Stateful post-break tracking: closed candles confirm the break; live price only marks an intrabar breach/retest.
 if(tracker.frame!==frame)Object.assign(tracker,{frame,level:null,type:null,status:null,remaining:0,lastCandleTime:0,detail:"",impactLong:0,impactShort:0});
 const previousClosed=c.length>1?c[c.length-2]:last;
 const liveCandle=s.chartCandles.length?s.chartCandles[s.chartCandles.length-1]:last;
 const buffer=Math.max(a*.15,entry*.0001);
 const volumeOk=Number.isFinite(volRatio)&&volRatio>=1.05;
 const closedBelow=(lvl:number)=>last.close<lvl;
 const closedAbove=(lvl:number)=>last.close>lvl;
 const confirmationText=(type:BreakType,lvl:number)=>{
  const outside=type==="BROKEN_SUPPORT"?last.close<lvl-buffer:last.close>lvl+buffer;
  return "إغلاق شمعة مكتملة "+(type==="BROKEN_SUPPORT"?"أسفل الدعم":"أعلى المقاومة")+" · "+(outside?"هامش الأمان ATR تحقق":"الإغلاق خارج المستوى لكن هامش ATR لم يتحقق")+" · "+(volumeOk?"الفوليوم داعم ≥ 1.05× المتوسط":"الفوليوم ضعيف (< 1.05× المتوسط)")+".";
 };
 if(tracker.lastCandleTime!==last.time){
  tracker.lastCandleTime=last.time;
  if(tracker.type&&tracker.level!==null&&tracker.status!=="reclaimed"&&tracker.status!=="expired"){
   tracker.remaining=Math.max(0,tracker.remaining-1);
   const lvl=tracker.level,type=tracker.type;
   const closeBeyond=type==="BROKEN_SUPPORT"?closedBelow(lvl):closedAbove(lvl);
   const reclaimed=type==="BROKEN_SUPPORT"?closedAbove(lvl):closedBelow(lvl);
   const candleTouched=last.low<=lvl+buffer&&last.high>=lvl-buffer;
   if(tracker.status==="instant"){
    if(closeBeyond){
     tracker.status="confirmed";tracker.remaining=Math.max(1,tracker.remaining);
     tracker.detail=(type==="BROKEN_SUPPORT"?"كسر مؤكد بإغلاق شمعة — ":"اختراق مؤكد بإغلاق شمعة — ")+confirmationText(type,lvl);
    }else if(reclaimed){tracker.status="reclaimed";tracker.detail="استعادة المستوى بإغلاق شمعة؛ فشل الكسر اللحظي.";}
    else tracker.detail="كسر لحظي فقط؛ آخر شمعة مغلقة لم تغلق خارج المستوى المرجعي.";
   }else if(tracker.status==="retest-bounce"||tracker.status==="retest-rejection"){
    if(tracker.remaining<=0){tracker.status="expired";tracker.detail="انتهت نافذة متابعة المستوى بعد 12 شمعة مغلقة.";}
   }else if(type==="BROKEN_RESISTANCE"&&last.low<=lvl+buffer&&last.close>lvl&&last.close>last.open){
    tracker.status="retest-bounce";
    tracker.detail="اختبار وارتداد من المقاومة المخترقة: أدنى الشمعة "+fmt(last.low)+" لامس نطاق المستوى "+fmt(lvl)+" (حد القرب "+fmt(buffer)+" USDT)، ثم أغلقت صاعدة أعلى المستوى عند "+fmt(last.close)+". الفوليوم "+fmt(volRatio,2)+"× المتوسط.";
   }else if(type==="BROKEN_SUPPORT"&&last.high>=lvl-buffer&&last.close<lvl&&last.close<last.open){
    tracker.status="retest-rejection";
    tracker.detail="اختبار ورفض من الدعم المكسور: أعلى الشمعة "+fmt(last.high)+" لامس نطاق المستوى "+fmt(lvl)+" (حد القرب "+fmt(buffer)+" USDT)، ثم أغلقت هابطة أدنى المستوى عند "+fmt(last.close)+". الفوليوم "+fmt(volRatio,2)+"× المتوسط.";
   }else if(reclaimed){
    tracker.status="reclaimed";tracker.detail="استعادة المستوى بإغلاق شمعة؛ فشل الكسر / الاختراق.";
   }else if(candleTouched&&tracker.status!=="retest-confirmed"){
    const retestDirection=type==="BROKEN_SUPPORT"?last.close<lvl-buffer&&last.close<last.open:last.close>lvl+buffer&&last.close>last.open;
    if(retestDirection&&volumeOk){
     tracker.status="retest-confirmed";
     tracker.detail=type==="BROKEN_SUPPORT"?"إعادة اختبار مؤكدة في اتجاه الكسر: رُفض الدعم المكسور كمقاومة، والإغلاق والفوليوم يؤيدان الهبوط.":"إعادة اختبار مؤكدة في اتجاه الاختراق: تماسكت المقاومة المخترقة كدعم، والإغلاق والفوليوم يؤيدان الصعود.";
    }else{
     tracker.status="confirmed";
     tracker.detail="لامست الشمعة المغلقة المستوى المكسور، لكن نتيجة الاختبار لم تتأكد بعد — "+(retestDirection?"اتجاه الإغلاق مناسب لكن الفوليوم غير كافٍ.":"لم يظهر إغلاق رفض/تماسك مكتمل.");
    }
   }else if(tracker.remaining<=0){tracker.status="expired";tracker.detail="انتهت نافذة متابعة المستوى بعد 12 شمعة مغلقة.";}
   else if(tracker.status!=="retest-confirmed")tracker.detail="متابعة المستوى المرجعي المكسور · متبقٍ "+tracker.remaining+" شمعة مغلقة.";
  }
  if(!tracker.type||tracker.status==="reclaimed"||tracker.status==="expired"){
   const brokeSupport=support!==null&&previousClosed.close>=support&&closedBelow(support);
   const brokeResistance=resistance!==null&&previousClosed.close<=resistance&&closedAbove(resistance);
   if(brokeSupport||brokeResistance){
    const newType:BreakType=brokeSupport?"BROKEN_SUPPORT":"BROKEN_RESISTANCE";
    const newLevel=brokeSupport?support:resistance;
    if(newLevel!==null){
     tracker.level=newLevel;tracker.type=newType;tracker.status="confirmed";tracker.remaining=12;
     tracker.detail=(brokeSupport?"كسر مؤكد بإغلاق شمعة — ":"اختراق مؤكد بإغلاق شمعة — ")+confirmationText(newType,newLevel);
    }
   }
  }
 }
 // Keep the exact reference fixed while the radar is active; live price cannot silently replace it.
 if((!tracker.type||tracker.status==="reclaimed"||tracker.status==="expired")&&priceBelowSupport&&support!==null&&!(last.close<support)){
  tracker.level=support;tracker.type="BROKEN_SUPPORT";tracker.status="instant";tracker.remaining=12;tracker.detail="كسر لحظي للدعم؛ السعر الحالي أسفل المستوى لكن آخر شمعة مغلقة لم تؤكد الكسر.";
 }else if((!tracker.type||tracker.status==="reclaimed"||tracker.status==="expired")&&priceAboveResistance&&resistance!==null&&!(last.close>resistance)){
  tracker.level=resistance;tracker.type="BROKEN_RESISTANCE";tracker.status="instant";tracker.remaining=12;tracker.detail="اختراق لحظي للمقاومة؛ السعر الحالي أعلى المستوى لكن آخر شمعة مغلقة لم تؤكد الاختراق.";
 }
 const activeBreak=!!tracker.type&&tracker.level!==null&&tracker.status!=="reclaimed"&&tracker.status!=="expired";
 if(activeBreak&&tracker.status!=="instant"&&tracker.status!=="retest-confirmed"){
  const lvl=tracker.level as number;
  const liveTouch=liveCandle.low<=lvl+buffer&&liveCandle.high>=lvl-buffer;
  const currentDistance=Math.abs(entry-lvl);
  const currentNear=Number.isFinite(currentDistance)&&currentDistance<=buffer;
  const approachingFromBreakSide=tracker.type==="BROKEN_SUPPORT"?entry<lvl:entry>lvl;
  if(liveTouch&&currentNear&&approachingFromBreakSide&&tracker.status==="confirmed"){
   tracker.status="retest";tracker.detail=tracker.type==="BROKEN_RESISTANCE"?"اختبار لحظي للمقاومة المخترقة: أدنى الشمعة "+fmt(liveCandle.low)+" وصل إلى نطاق المستوى "+fmt(lvl)+"، والسعر الحالي "+fmt(entry)+" عاد أعلى المستوى ضمن حد القرب "+fmt(buffer)+" USDT؛ ننتظر الإغلاق لتأكيد الارتداد.":"اختبار لحظي للدعم المكسور: أعلى الشمعة "+fmt(liveCandle.high)+" وصل إلى نطاق المستوى "+fmt(lvl)+"، والسعر الحالي "+fmt(entry)+" عاد أسفل المستوى ضمن حد القرب "+fmt(buffer)+" USDT؛ ننتظر الإغلاق لتأكيد الرفض.";
  }else if(tracker.status==="retest"&&(!liveTouch||!currentNear||!approachingFromBreakSide)){
   tracker.status="confirmed";
   tracker.detail="اختراق مؤكد قيد المتابعة — السعر ابتعد عن المستوى المرجعي بمقدار "+fmt(currentDistance)+" USDT، وبانتظار عودة فعلية إلى نطاق القرب ("+fmt(buffer)+" USDT) لاختباره.";
  }else if(tracker.status==="confirmed"){
   tracker.detail="متابعة بعد "+(tracker.type==="BROKEN_SUPPORT"?"كسر الدعم":"اختراق المقاومة")+" — السعر يبعد "+fmt(currentDistance)+" USDT عن المستوى المرجعي؛ بانتظار عودة فعلية إلى نطاق القرب ("+fmt(buffer)+" USDT) لاختباره.";
  }
 }
 const instantBreak=activeBreak&&tracker.status==="instant";
 const breakStatus:BreakStatus|null=activeBreak?tracker.status:null;
 const breakLevel=activeBreak?tracker.level:null;
 const breakDetail=tracker.detail||"لا يوجد كسر أو اختراق مرجعي قيد المتابعة.";
 const retestLong=activeBreak&&tracker.type==="BROKEN_RESISTANCE"&&(tracker.status==="retest-confirmed"||tracker.status==="retest-bounce");
 const retestShort=activeBreak&&tracker.type==="BROKEN_SUPPORT"&&(tracker.status==="retest-confirmed"||tracker.status==="retest-rejection");
 const retestLongPending=activeBreak&&tracker.type==="BROKEN_RESISTANCE"&&tracker.status==="retest";
 const retestShortPending=activeBreak&&tracker.type==="BROKEN_SUPPORT"&&tracker.status==="retest";
 const breakImpactLong=retestLong?20:retestLongPending?4:0,breakImpactShort=retestShort?20:retestShortPending?4:0;
 tracker.impactLong=breakImpactLong;tracker.impactShort=breakImpactShort;

 const postBreakActive=activeBreak&&tracker.level!==null&&tracker.type!==null;
 const postBreakDistance=postBreakActive?Math.abs(entry-tracker.level!):null;
 const postBreakDistancePct=postBreakActive&&tracker.level!>0?postBreakDistance!/tracker.level!*100:null;
 const postBreakDistanceAtr=postBreakActive&&a>0?postBreakDistance!/a:null;
 const proximityBand=Math.max(a*.5,entry*.0015);
 const postBreakBandLow=postBreakActive?tracker.level!-proximityBand:null,postBreakBandHigh=postBreakActive?tracker.level!+proximityBand:null;
 const postBreakInvalidation=postBreakActive?(tracker.type==="BROKEN_RESISTANCE"?tracker.level!-buffer:tracker.level!+buffer):null;
 const liveTouchesReference=postBreakActive&&liveCandle.low<=tracker.level!+proximityBand&&liveCandle.high>=tracker.level!-proximityBand;
 const closedTouchesReference=postBreakActive&&last.low<=tracker.level!+proximityBand&&last.high>=tracker.level!-proximityBand;
 const postBreakElapsed=postBreakActive?Math.max(0,12-tracker.remaining):0,postBreakWindow=12;
 const postBreakVolumeRatio=postBreakActive?volRatio:0;
 const wickRatio=(z:C,side:"upper"|"lower")=>{const range=Math.max(z.high-z.low,1e-12),wick=side==="upper"?z.high-Math.max(z.open,z.close):Math.min(z.open,z.close)-z.low;return wick/range;};
 const rejectionWick=postBreakActive?(tracker.type==="BROKEN_RESISTANCE"?wickRatio(liveCandle,"upper"):wickRatio(liveCandle,"lower")):0;
 const postBreakWick=postBreakActive?(rejectionWick>=.45?"ذيل رفض كبير ≥45% من نطاق الشمعة الحية":closedTouchesReference&&(tracker.type==="BROKEN_RESISTANCE"?wickRatio(last,"upper"):wickRatio(last,"lower"))>=.45?"ذيل رفض كبير ≥45% من نطاق آخر شمعة مغلقة":"لا يوجد ذيل رفض كبير مرصود"):"غير متاح";
 const postBreakSweep=postBreakActive?(tracker.type==="BROKEN_RESISTANCE"?(sweepHigh||resistanceSweep?"سحب سيولة أعلى المنطقة مرصود":"لا يوجد Sweep مؤكد"):(sweepLow||supportSweep?"سحب سيولة أسفل المنطقة مرصود":"لا يوجد Sweep مؤكد")):"غير متاح";
 const postBreakVolumeState=postBreakActive?(volRatio>=1.5?"قوي ≥1.50×":volRatio>=1.05?"داعم ≥1.05×":volRatio>0?"ضعيف <1.05×":"غير متاح"):"غير متاح";
 const postBreakConfirmation=postBreakActive?(tracker.status==="instant"?"لحظي غير مؤكد":tracker.status==="confirmed"||tracker.status==="retest"||tracker.status==="retest-confirmed"||tracker.status==="retest-bounce"||tracker.status==="retest-rejection"?"مؤكد بإغلاق شمعة":"إغلاق عكسي / منتهٍ"):"لا يوجد حدث نشط";
 const postBreakTrend4=postBreakActive&&(tracker.type==="BROKEN_RESISTANCE"?s.trend4h.direction==="صاعد":s.trend4h.direction==="هابط");
 const postBreakTrend1=postBreakActive&&(tracker.type==="BROKEN_RESISTANCE"?s.trend1h.direction==="صاعد":s.trend1h.direction==="هابط");
 const lastThree=c.slice(-3),candleAlignment=postBreakActive?lastThree.filter(z=>tracker.type==="BROKEN_RESISTANCE"?z.close>z.open:z.close<z.open).length:0;
 const closeBeyondReference=postBreakActive&&(tracker.type==="BROKEN_RESISTANCE"?last.close>tracker.level!+buffer:last.close<tracker.level!-buffer);
 const reverseClose=postBreakActive&&(tracker.type==="BROKEN_RESISTANCE"?last.close<tracker.level!-buffer:last.close>tracker.level!+buffer);
 const postBreakQualityFactors:string[]=[];let postBreakQuality=0;
 if(postBreakActive){
  const closePts=closeBeyondReference?25:tracker.status==="instant"?0:15;postBreakQuality+=closePts;postBreakQualityFactors.push("تأكيد الإغلاق: "+closePts+"/25");
  const volPts=volRatio>=1.5?25:volRatio>=1.2?20:volRatio>=1.05?15:volRatio>=.8?8:0;postBreakQuality+=volPts;postBreakQualityFactors.push("الفوليوم النسبي "+fmt(volRatio,2)+"×: "+volPts+"/25");
  const trendPts=(postBreakTrend4?12:0)+(postBreakTrend1?8:0);postBreakQuality+=trendPts;postBreakQualityFactors.push("توافق 4H/1H: "+trendPts+"/20");
  const candlePts=Math.min(30,Math.round(candleAlignment/3*20)+(candleAlignment>=2?10:0));postBreakQuality+=candlePts;postBreakQualityFactors.push("اتساق آخر 3 شمعات مغلقة ("+candleAlignment+"/3): "+candlePts+"/30");
  if(reverseClose){postBreakQuality=Math.min(postBreakQuality,25);postBreakQualityFactors.push("إغلاق عكسي: سقف الجودة 25/100");}
  if(tracker.status==="instant")postBreakQuality=Math.min(postBreakQuality,45);
 }
 postBreakQuality=clamp(Math.round(postBreakQuality));
 const postBreakLifecycle=!postBreakActive?"لا يوجد حدث نشط":reverseClose||tracker.status==="reclaimed"?"فشل الكسر / إغلاق عكسي يُبطل أو يُضعف السيناريو":tracker.status==="retest-confirmed"||tracker.status==="retest-bounce"||tracker.status==="retest-rejection"?"إعادة اختبار مؤكدة بإغلاق شمعة وثبات":liveTouchesReference&&postBreakDistance!==null&&postBreakDistance<=proximityBand?"اختبار لحظي داخل الشمعة الحالية — بانتظار الإغلاق":postBreakDistance!==null&&postBreakDistance<=proximityBand?"ضمن نطاق القرب بانتظار الاختبار":"ابتعاد وتمدد بعيد عن المستوى";
 const postBreakEventType=!postBreakActive?"لا يوجد":tracker.type==="BROKEN_RESISTANCE"?"اختراق مقاومة":"كسر دعم";
 const postBreakMachineText=["POST_BREAK_SCHEMA=1","ACTIVE="+(postBreakActive?"true":"false"),"REFERENCE_LEVEL="+(postBreakActive?fmt(tracker.level!,8):"null"),"EVENT_TYPE="+postBreakEventType,"TIMEFRAME="+frame,"CONFIRMATION="+postBreakConfirmation,"LIFECYCLE="+postBreakLifecycle,"ELAPSED_CANDLES="+postBreakElapsed,"REMAINING_CANDLES="+(postBreakActive?tracker.remaining:0),"WINDOW_CANDLES="+postBreakWindow,"DISTANCE_USDT="+(postBreakDistance===null?"null":fmt(postBreakDistance,8)),"DISTANCE_PERCENT="+(postBreakDistancePct===null?"null":fmt(postBreakDistancePct,6)),"DISTANCE_ATR14="+(postBreakDistanceAtr===null?"null":fmt(postBreakDistanceAtr,4)),"PROXIMITY_BAND_LOW="+(postBreakBandLow===null?"null":fmt(postBreakBandLow,8)),"PROXIMITY_BAND_HIGH="+(postBreakBandHigh===null?"null":fmt(postBreakBandHigh,8)),"INVALIDATION="+(postBreakInvalidation===null?"null":fmt(postBreakInvalidation,8)),"VOLUME_RATIO_20="+fmt(postBreakVolumeRatio,4),"VOLUME_STATE="+postBreakVolumeState,"REJECTION_WICK="+postBreakWick,"LIQUIDITY_SWEEP="+postBreakSweep,"QUALITY_SCORE="+postBreakQuality,"QUALITY_FACTORS="+postBreakQualityFactors.join(" | "),"TREND_4H="+s.trend4h.direction,"TREND_1H="+s.trend1h.direction].join("\n");
 const levelDetail=(priceBelowSupport?"تجاوز الدعم: "+fmt(supportOverrun)+" USDT / "+fmt(supportOverrunPct,3)+"%":priceAboveResistance?"تجاوز المقاومة: "+fmt(resistanceOverrun)+" USDT / "+fmt(resistanceOverrunPct,3)+"%":"لا يوجد تجاوز حالي لمستوى الدعم أو المقاومة.")+" · حالة الرادار: "+(tracker.status==="instant"?"كسر لحظي":tracker.status==="confirmed"?"كسر/اختراق مؤكد":tracker.status==="retest"?"إعادة اختبار":tracker.status==="retest-confirmed"?"إعادة اختبار مؤكدة":tracker.status==="retest-bounce"?"اختبار وارتداد":tracker.status==="retest-rejection"?"اختبار ورفض":tracker.status==="reclaimed"?"استعادة المستوى / فشل الكسر":tracker.status==="expired"?"انتهت المتابعة":"لا يوجد")+(tracker.level!==null?" · المرجع "+fmt(tracker.level):"")+" · "+(tracker.detail||"");
 const trendUp=(t:Trend4H)=>t.direction==="صاعد",trendDown=(t:Trend4H)=>t.direction==="هابط";
 const up=last.close>e20&&e20>e50,down=last.close<e20&&e20<e50;
 const fundBull=s.funding<-.00005,fundBear=s.funding>.00005;
 const emaGapPct=e50>0?Math.abs(e20-e50)/entry*100:Infinity;
 const hasRangeLevels=support!==null&&resistance!==null;
 const rangeWidth=hasRangeLevels?Math.max(0,resistance-support):0;
 const rangeSqueeze=hasRangeLevels&&Number.isFinite(a)&&a>0&&rangeWidth<a*1.15;
 const priorCandleRanges=c.slice(-21,-1).map(x=>Math.max(0,x.high-x.low)).filter(Number.isFinite);
 const avgCandleRange=avg(priorCandleRanges),currentCandleRange=Math.max(0,last.high-last.low);
 const rangeExpansion=hasRangeLevels&&!rangeSqueeze&&a>0&&rangeWidth>=a*1.15&&avgCandleRange>0&&currentCandleRange>=avgCandleRange*1.1&&volRatio>=1.1;
 const emaDistanceAtr=Math.abs(entry-e20)/Math.max(a,1);
 const emaExtended=Number.isFinite(emaDistanceAtr)&&emaDistanceAtr>=1.8;
 const tightRange=rangeSqueeze;
 const chop=tightRange||emaGapPct<=.08,chopReason=tightRange?"انضغاط النطاق: عرضه أقل من 1.15× ATR14":"EMA20 وEMA50 متلاصقتان (≤ 0.08%)";
 const dead=!Number.isFinite(a)||a/entry*100<.08,lowLiquidity=volRatio<.7&&!sweepLow&&!sweepHigh;
 const oiBull=s.oiDelta!==null&&s.oiDelta>0,oiBear=s.oiDelta!==null&&s.oiDelta<0;
 const score=(direction:"LONG"|"SHORT")=>{
  let points=0;const parts:string[]=[];
  const h4=direction==="LONG"?trendUp(s.trend4h):trendDown(s.trend4h),h1=direction==="LONG"?trendUp(s.trend1h):trendDown(s.trend1h);
  const h4Against=direction==="LONG"?trendDown(s.trend4h):trendUp(s.trend4h),h1Against=direction==="LONG"?trendDown(s.trend1h):trendUp(s.trend1h);
  if(h4){points+=20;parts.push("4H موافق +20");}else if(h4Against){points-=12;parts.push("4H معاكس −12");}else parts.push("4H محايد +0");
  if(h1){points+=15;parts.push("1H موافق +15");}else if(h1Against){points-=10;parts.push("1H معاكس −10");}else parts.push("1H محايد +0");
  const bounce=direction==="LONG"?supportScoreEvidence:resistanceScoreEvidence,breakout=direction==="LONG"?breakoutConfirmed:breakdownConfirmed,sweep=direction==="LONG"?supportSweep:resistanceSweep;
  const candleDirection=direction==="LONG"?last.close>last.open:last.close<last.open;
  if(breakout){points+=25;parts.push("كسر/اختراق حقيقي مع هامش ATR +25");}
  else if(sweep){points+=17;parts.push("Liquidity Sweep واضح +17");}
  else if(bounce){points+=16;parts.push(direction==="LONG"?"ارتداد/تماسك دعم +16":"رفض/تماسك مقاومة +16");}
  else {points-=5;parts.push("لا تأكيد من مستوى فني −5");}
  if(rangeSqueeze){points-=12;parts.push("انضغاط النطاق −12");}
  else if(rangeExpansion&&candleDirection){points+=8;parts.push("توسع نطاق مع فوليوم ≥1.1× +8");}
  if(emaExtended&&((entry>e20&&direction==="LONG")||(entry<e20&&direction==="SHORT"))){points-=12;parts.push("تمدد عن EMA20 في اتجاه الصفقة −12");}
  const rsiGood=direction==="LONG"?rv>=52&&rv<=70:rv<=48&&rv>=30,rsiBad=direction==="LONG"?rv>78||rv<38:rv<22||rv>62;
  if(rsiGood){points+=10;parts.push("RSI بزخم ملائم +10");}else if(rsiBad){points-=8;parts.push("RSI متطرف/معاكس −8");}else parts.push("RSI دون تعزيز +0");
  if(volRatio>=1.15&&candleDirection){points+=10;parts.push("حجم واتجاه شمعة مؤيدان +10");}else if(volRatio<.7){points-=10;parts.push("فوليوم ضعيف −10");}else if(volRatio>=1.15){points-=4;parts.push("حجم مرتفع دون اتجاه مؤيد −4");}
  const oiAligned=direction==="LONG"?oiBull:oiBear,oiOpposite=direction==="LONG"?oiBear:oiBull;
  if(oiAligned){points+=10;parts.push("اتجاه Open Interest داعم +10");}else if(oiOpposite){points-=5;parts.push("اتجاه Open Interest تحذيري −5");}else parts.push("اتجاه OI غير حاسم +0");
  const fundingAligned=direction==="LONG"?fundBull:fundBear,fundingOpposite=direction==="LONG"?fundBear:fundBull;
  if(fundingAligned){points+=5;parts.push("Funding داعم +5");}else if(fundingOpposite){points-=4;parts.push("Funding مزدحم/معاكس −4");}else parts.push("Funding محايد +0");
  const patternAligned=(direction==="LONG"&&pat.kind==="bull")||(direction==="SHORT"&&pat.kind==="bear");
  if(patternAligned&&pat.status==="confirmed"&&pat.score>0){const patternPoints=Math.round(pat.score);points+=patternPoints;parts.push("نموذج "+pat.name+" · مؤكد · "+(pat.volumeConfirmed?"فوليوم مؤيد":"فوليوم غير كافٍ")+" +"+patternPoints);}
  else if(patternAligned&&(pat.status==="weak"||pat.status==="pending"))parts.push("نموذج "+pat.name+" · "+(pat.status==="weak"?"ضعيف السياق":"غير مؤكد")+": 0 نقطة");
  else if(pat.type==="حيرة")parts.push("شمعة حيرة: انتظار تأكيد دون نقاط اتجاهية");
  const postBreakImpact=direction==="LONG"?breakImpactLong:breakImpactShort;
  if(postBreakImpact){points+=postBreakImpact;parts.push("رادار ما بعد الكسر "+(postBreakImpact===20?"إعادة اختبار مؤكدة":"إعادة اختبار قيد التأكيد")+" +"+postBreakImpact);}
  const totalPoints=Number.isFinite(points)?points:0;
  const finalScore=Math.round(Math.min(100,Math.max(0,totalPoints)));
  return{value:finalScore,totalPoints,parts,postBreakImpact};
 };
 const ls=score("LONG"),ss=score("SHORT"),longScore=ls.value,shortScore=ss.value;
 const higher=Math.max(longScore,shortScore),gap=Math.abs(longScore-shortScore),candidate:Side=longScore>shortScore?"LONG":"SHORT";
 const blockers:string[]=[];if(higher<70)blockers.push("الدرجة الأعلى أقل من 70%");if(gap<25)blockers.push("الفارق بين LONG وSHORT أقل من 25 نقطة");if(lowLiquidity)blockers.push("ضعف سيولة حاد: الفوليوم أقل من 0.7× دون Sweep");if(chop)blockers.push("تذبذب ضيق محصور داخل هامش ATR");if(dead)blockers.push("ATR ضعيف جداً");if(!Number.isFinite(entry)||entry<=0||!Number.isFinite(a)||a<=0)blockers.push("بيانات السعر/ATR غير صالحة");
 const side:Side=blockers.length?"NO TRADE":candidate;
 const selectedReasons=candidate==="LONG"?ls.parts:ss.parts;
 const decisionAlerts=[rangeSqueeze?"تحذير: انضغاط / نطاق ضيق (Squeeze) — مساحة الأهداف محدودة":rangeExpansion?"بداية توسع نطاق مع ارتفاع الفوليوم (Range Expansion)": "",emaExtended?"تمدد سعري مرتفع عن EMA20 ("+fmt(emaDistanceAtr,2)+" ATR)":""].filter(Boolean).join(" · ");
 const decisionDetails="LONG خام "+ls.totalPoints+" → نهائي "+longScore+"% (أثر الرادار "+ls.postBreakImpact+") ["+ls.parts.join("، ")+"] · SHORT خام "+ss.totalPoints+" → نهائي "+shortScore+"% (أثر الرادار "+ss.postBreakImpact+") ["+ss.parts.join("، ")+"]"+(decisionAlerts?" · "+decisionAlerts:"");
 const reason=side==="NO TRADE"?"NO TRADE — "+blockers[0]+(blockers.length>1?"؛ "+blockers.slice(1).join("؛ "):"")+" · "+decisionDetails:"إشارة "+side+" · "+selectedReasons.join("، ")+" · الدرجة "+higher+"% والفارق "+gap+" نقطة."+(decisionAlerts?" · "+decisionAlerts:"");
 let sl=0,tp1=0,tp2=0,riskDistance=0;
 if(side!=="NO TRADE"){
  const level=side==="LONG"?support:resistance;
  const levelDistance=level!==null?Math.abs(entry-level):0;
  const stopDistance=Math.max(levelDistance+a*.25,1.2*a);
  sl=side==="LONG"?entry-stopDistance:entry+stopDistance;
  riskDistance=Math.abs(entry-sl);tp1=side==="LONG"?entry+1.5*riskDistance:entry-1.5*riskDistance;tp2=side==="LONG"?entry+2.5*riskDistance:entry-2.5*riskDistance;
  if(![entry,sl,tp1,tp2,riskDistance].every(Number.isFinite)||riskDistance<=0){sl=tp1=tp2=riskDistance=0;}
 }
 const finalSide=side!=="NO TRADE"&&sl>0?side:"NO TRADE",confidence=higher;
 const stopDistance=finalSide!=="NO TRADE"?Math.abs(entry-sl):0;
 const riskWarning=finalSide!=="NO TRADE"&&a>0&&stopDistance<a*.6?"تنبيه مخاطري: المسافة إلى الوقف أقل من 0.6× ATR14؛ قد يضربه ضجيج السوق العشوائي.":"";
 const levelWarning=finalSide==="LONG"&&resistanceScoreEvidence?"تنبيه: توجد مقاومة قريبة/اختبار رفض أمام السعر.":finalSide==="SHORT"&&supportScoreEvidence?"تنبيه: يوجد دعم قريب/اختبار ارتداد أمام السعر.":"";
 const priceLocation=priceBelowSupport?"كسر الدعم الأقرب (أسفل الدعم)":priceAboveResistance?"اختراق المقاومة الأقرب (أعلى المقاومة)":supportSweep?"سحب سيولة أسفل الدعم مع إغلاق مرتد فوقه":resistanceSweep?"سحب سيولة أعلى المقاومة مع إغلاق رافض تحتها":supportBounce?"اختبار وارتداد فعلي من الدعم":resistanceRejection?"اختبار ورفض فعلي من المقاومة":nearSupport?"قرب دعم":nearResistance?"قرب مقاومة":"في منتصف النطاق";
 return{side:finalSide,confidence,longScore,shortScore,longRaw:ls.totalPoints,shortRaw:ss.totalPoints,longImpact:ls.postBreakImpact,shortImpact:ss.postBreakImpact,postBreakStatus:breakStatus??"none",postBreakDetail:breakDetail,postBreakLevel:breakLevel,postBreakType:activeBreak?tracker.type:null,postBreakRemaining:activeBreak?tracker.remaining:0,postBreakEventType,postBreakConfirmation,postBreakElapsed,postBreakWindow,postBreakDistance,postBreakDistancePct,postBreakDistanceAtr,postBreakBand:proximityBand,postBreakBandLow,postBreakBandHigh,postBreakInvalidation,postBreakVolumeRatio,postBreakVolumeState,postBreakWick,postBreakSweep,postBreakQuality,postBreakQualityFactors,postBreakLifecycle,postBreakMachineText,longReasons:ls.parts,shortReasons:ss.parts,reason:finalSide==="NO TRADE"&&side!=="NO TRADE"?"NO TRADE — تعذر تكوين خطة رقمية آمنة · "+decisionDetails:reason,entry:finalSide==="NO TRADE"?0:entry,sl:finalSide==="NO TRADE"?0:sl,tp1:finalSide==="NO TRADE"?0:tp1,tp2:finalSide==="NO TRADE"?0:tp2,riskDistance:finalSide==="NO TRADE"?0:riskDistance,atr:a,rangeWidth,rangeSqueeze,rangeExpansion,emaDistanceAtr,emaExtended,riskWarning,overallTrend:s.trend4h.direction,trend1h:s.trend1h.direction,counterTrend:(finalSide==="LONG"&&(trendDown(s.trend4h)||trendDown(s.trend1h)))||(finalSide==="SHORT"&&(trendUp(s.trend4h)||trendUp(s.trend1h))),chop,chopReason,lowLiquidity,pattern:pat.name,patternAr:pat.nameAr,patternType:pat.type,patternScore:pat.score,patternKind:pat.kind,patternVolumeConfirmed:pat.volumeConfirmed,confirmation:pat.confirmation,confirmationStatus:pat.status,confirmationDetail:pat.detail,volumeText:fmt(volRatio,2)+"× متوسط 20 شمعة · "+(volRatio>=1.15?"مرتفع":volRatio<.7?"ضعيف":"عادي"),sweepText:sweepLow?"سحب سيولة أسفل قاع سابق":sweepHigh?"سحب سيولة أعلى قمة سابقة":"لا يوجد Sweep مؤكد",fundingText:(Number.isFinite(s.funding)?(s.funding*100).toFixed(4):"—")+"% · "+(s.funding>0?"موجب":s.funding<0?"سالب":"محايد"),oiText:fmt(s.oi,0)+" BTC",rsi:rv,ema20:e20,ema50:e50,support,resistance,supportDistance,resistanceDistance,priceLocation,levelWarning,levelDetail};
}
export default function InstantBTCPage(){
const[frame,setFrame]=useState<Frame>("15m"),[data,setData]=useState<Data|null>(null),[oiDelta,setOiDelta]=useState<number|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[copied,setCopied]=useState(false),[sessionCapital,setSessionCapital]=useState("10000"),[riskPercent,setRiskPercent]=useState("1"),[signalLog,setSignalLog]=useState<Array<{id:string;time:number;frame:Frame;side:"LONG"|"SHORT";entry:number;sl:number;tp1:number;status:"مفتوحة"|"حقق الهدف TP1 ✅"|"ضرب الوقف SL ❌"}>>([]),oiRef=useRef<number|null>(null),lastLoggedRef=useRef<string>("");
const chartContainerRef=useRef<HTMLDivElement|null>(null),chartRef=useRef<any>(null),candleSeriesRef=useRef<any>(null),supportLineRef=useRef<any>(null),resistanceLineRef=useRef<any>(null),priceLineRef=useRef<any>(null),chartFitRef=useRef(false);const[chartReady,setChartReady]=useState(false);
const[eventReports,setEventReports]=useState<EventReport[]>([]),[reportFilter,setReportFilter]=useState<"all"|"candles"|"levels"|"trades">("all"),[reportCopied,setReportCopied]=useState(false);
const reportDedupeRef=useRef<Set<string>>(new Set()),reportOpenedRef=useRef<Set<string>>(new Set()),reportStatusRef=useRef<Map<string,string>>(new Map()),reportBreakRef=useRef<string>(""),reportStreakGuardRef=useRef(false),reportReadyRef=useRef(false);
const breakTrackerRef=useRef<BreakTracker>({frame:"15m",level:null,type:null,status:null,remaining:0,lastCandleTime:0,detail:"",impactLong:0,impactShort:0});
const plan=useMemo(()=>data?analyze(data,frame,breakTrackerRef.current):null,[data,frame]),tradeable=!!plan&&plan.side!=="NO TRADE";
const candleReadout=useMemo(()=>{
 if(!data||!plan)return null;
 const closed=data.candles.slice(-3);
 if(closed.length<3)return null;
 const averagePriorVolume=(index:number)=>avg(data.candles.slice(Math.max(0,index-20),index).map(x=>x.volume).filter(Number.isFinite));
 const summarize=(candle:C,label:string,index:number,isLive:boolean)=>{
  const range=Math.max(0,candle.high-candle.low),body=Math.abs(candle.close-candle.open);
  const direction=range===0||body/range<=.12?"حيرة":candle.close>candle.open?"صاعدة":candle.close<candle.open?"هابطة":"حيرة";
  const base=isLive?avg(data.candles.slice(-20).map(x=>x.volume).filter(Number.isFinite)):averagePriorVolume(data.candles.findIndex(x=>x.time===candle.time));
  const ratio=base>0&&Number.isFinite(candle.volume)?candle.volume/base:null;
  return {label,candle,direction,range,ratio,isLive};
 };
 const start=data.candles.length-3;
 const items=closed.map((c,i)=>summarize(c,["C-3","C-2","C-1"][i],start+i,false));
 const lastClosed=closed[2];
 const live=data.chartCandles.find(x=>x.time>lastClosed.time)??null;
 if(live)items.push(summarize(live,"الحالية C0",data.candles.length,true));
 else items.push({label:"الحالية C0",candle:null as unknown as C,direction:"غير متاحة",range:0,ratio:null,isLive:true});
 const [a,b,c]=closed;
 const rising=a.close<b.close&&b.close<c.close&&a.high<=b.high&&b.high<=c.high&&a.low<=b.low&&b.low<=c.low;
 const falling=a.close>b.close&&b.close>c.close&&a.high>=b.high&&b.high>=c.high&&a.low>=b.low&&b.low>=c.low;
 const rejectionCount=(level:number|null,side:"resistance"|"support")=>level===null?0:closed.filter(x=>{
  const r=Math.max(x.high-x.low,1e-12),wick=side==="resistance"?x.high-Math.max(x.open,x.close):Math.min(x.open,x.close)-x.low;
  return Math.abs((side==="resistance"?x.high:x.low)-level)<=Math.max(plan.atr*.6,level*.001)&&wick/r>=.3;
 }).length;
 const resistanceRejects=rejectionCount(plan.resistance,"resistance"),supportRejects=rejectionCount(plan.support,"support");
 const avgRecentRatio=items.slice(0,3).map(x=>x.ratio??0);
 const lowVolume=avg(avgRecentRatio)<.7;
 const context=rising?"دفع صاعد متدرج عبر الشموع الثلاث":falling?"دفع هابط متدرج عبر الشموع الثلاث":resistanceRejects>=2?"رفض متكرر قرب المقاومة خلال الشموع المغلقة":supportRejects>=2?"رفض متكرر قرب الدعم خلال الشموع المغلقة":c.close<b.close&&b.high>=a.high&&c.high<b.high?"تراجع بعد قمة محلية":lowVolume?"تذبذب مع سيولة ضعيفة نسبياً":"تذبذب/تداخل؛ لا يوجد تسلسل اتجاهي واضح";
 const livePrice=data.price,near=Math.max(plan.atr*.5,livePrice*.0015);
 let liveState="تتابع الحركة داخل النطاق؛ لا يوجد اختبار قريب واضح";
 if(!live)liveState="بيانات الشمعة الحالية غير متاحة في آخر استجابة";
 else if(plan.postBreakStatus!=="none")liveState=plan.postBreakDetail;
 else if(plan.support!==null&&livePrice<plan.support)liveState="السعر الحالي أسفل الدعم الأقرب؛ الكسر اللحظي لا يصبح مؤكداً إلا بإغلاق الشمعة";
 else if(plan.resistance!==null&&livePrice>plan.resistance)liveState="السعر الحالي أعلى المقاومة الأقرب؛ الاختراق اللحظي لا يصبح مؤكداً إلا بإغلاق الشمعة";
 else if(plan.resistance!==null&&Math.abs(plan.resistance-livePrice)<=near)liveState="الشمعة الحالية تقترب من المقاومة "+fmt(plan.resistance)+"؛ ننتظر الإغلاق";
 else if(plan.support!==null&&Math.abs(livePrice-plan.support)<=near)liveState="الشمعة الحالية تقترب من الدعم "+fmt(plan.support)+"؛ ننتظر الإغلاق";
 else if(plan.postBreakLevel!==null&&Math.abs(livePrice-plan.postBreakLevel)<=near)liveState="السعر يختبر المستوى المرجعي "+fmt(plan.postBreakLevel)+" لحظياً؛ لا تأكيد قبل الإغلاق";
 const capital=Number(sessionCapital),risk=Number(riskPercent),validRisk=Number.isFinite(capital)&&capital>0&&Number.isFinite(risk)&&risk>0&&risk<=100;
 const riskAmount=validRisk?capital*risk/100:null;
 const gap=Math.abs(plan.longScore-plan.shortScore),higher=Math.max(plan.longScore,plan.shortScore);
 const breakLabel=plan.postBreakStatus==="none"?"لا يوجد كسر نشط":plan.postBreakStatus==="instant"?"كسر/اختراق لحظي غير مؤكد":plan.postBreakStatus==="confirmed"?"كسر/اختراق مؤكد بانتظار إعادة الاختبار":plan.postBreakStatus==="retest"?"إعادة اختبار لحظية بانتظار الإغلاق":plan.postBreakStatus==="retest-confirmed"||plan.postBreakStatus==="retest-bounce"||plan.postBreakStatus==="retest-rejection"?"إعادة اختبار مؤكدة":plan.postBreakStatus==="reclaimed"?"استعادة المستوى وفشل الكسر":"انتهت متابعة الكسر";
 const summary="السياق: "+context+"؛ الحالية: "+liveState+". القرار "+plan.side+" — LONG "+plan.longScore+"% / SHORT "+plan.shortScore+"%، الفارق "+gap+" نقطة (المطلوب ≥70% وفارق ≥25). اتجاه 4H: "+plan.overallTrend+" و1H: "+plan.trend1h+"؛ POST-BREAK: "+breakLabel+". مخاطرة "+(validRisk?fmt(risk,2)+"% = "+fmt(riskAmount!)+" USDT":"غير محسوبة بسبب مدخلات رأس المال")+". "+(plan.side==="NO TRADE"?"لا توجد إشارة مستوفية للشروط حالياً.":"الإشارة اجتازت شروط المحرك؛ تبقى إدارة الوقف والمخاطرة ضرورية.");
 return {items,context,liveState,summary};
},[data,plan,sessionCapital,riskPercent]);
useEffect(()=>{try{const raw=localStorage.getItem("btc-radar-event-reports-v1");if(raw){const parsed=JSON.parse(raw);if(Array.isArray(parsed))setEventReports(parsed.slice(0,100));}const keys=localStorage.getItem("btc-radar-event-dedupe-v1");if(keys){const parsed=JSON.parse(keys);if(Array.isArray(parsed))reportDedupeRef.current=new Set(parsed.filter((x):x is string=>typeof x==="string"));}}catch{setEventReports([]);reportDedupeRef.current=new Set();}},[]);
useEffect(()=>{try{const raw=localStorage.getItem("btc-radar-signal-log-v1");if(raw){const parsed=JSON.parse(raw);if(Array.isArray(parsed))setSignalLog(parsed.slice(0,10));}}catch{setSignalLog([]);}},[]);
useEffect(()=>{if(!plan||!data||!tradeable)return;const candle=data.candles[data.candles.length-1],id=frame+":"+candle.time;if(lastLoggedRef.current===id||signalLog.some(x=>x.id===id))return;lastLoggedRef.current=id;setSignalLog(prev=>{if(prev.some(x=>x.id===id))return prev;const next=[{id,time:candle.time,frame,side:plan.side as "LONG"|"SHORT",entry:plan.entry,sl:plan.sl,tp1:plan.tp1,status:"مفتوحة" as const},...prev].slice(0,10);try{localStorage.setItem("btc-radar-signal-log-v1",JSON.stringify(next));}catch{}return next;});},[plan,data,tradeable,frame,signalLog]);
useEffect(()=>{if(!data||!signalLog.length)return;const next=signalLog.map(x=>{if(x.status!=="مفتوحة")return x;const hitTp=x.side==="LONG"?data.price>=x.tp1:data.price<=x.tp1,hitSl=x.side==="LONG"?data.price<=x.sl:data.price>=x.sl;return hitTp?{...x,status:"حقق الهدف TP1 ✅" as const}:hitSl?{...x,status:"ضرب الوقف SL ❌" as const}:x;});if(next.some((x,i)=>x.status!==signalLog[i]?.status)){setSignalLog(next);try{localStorage.setItem("btc-radar-signal-log-v1",JSON.stringify(next));}catch{}}},[data?.price,signalLog]);

useEffect(()=>{
 if(!data||!plan)return;
 const candle=data.candles[data.candles.length-1];if(!candle)return;
 const volumeBase=data.candles.slice(-21,-1).reduce((sum,x)=>sum+(Number.isFinite(x.volume)?x.volume:0),0)/Math.max(1,data.candles.slice(-21,-1).length);
 const volumeRatio=volumeBase>0&&Number.isFinite(candle.volume)?candle.volume/volumeBase:0;
 const dist=(level:number|null)=>level!==null&&Number.isFinite(level)&&data.price>0?Math.abs(data.price-level):null;
 const overrun=(level:number|null)=>level!==null&&Number.isFinite(level)?data.price<level?level-data.price:data.price>level?data.price-level:0:0;
 const events:ReportEvent[]=[];
 const reasons:string[]=[];
 const interpretations:string[]=[];
 const figures:string[]=[];
 const followUps:string[]=[];
 let category:ReportCategory="candles";
 const candleKey="CANDLE_CLOSE:"+frame+":"+candle.time;
 if(!reportDedupeRef.current.has(candleKey)){
  events.push("CANDLE_CLOSE");
  const candleDirection=candle.close>candle.open?"صاعدة":candle.close<candle.open?"هابطة":"دوجي/محايدة";
  const averageRange=data.candles.slice(-21,-1).reduce((sum,x)=>sum+Math.max(0,x.high-x.low),0)/Math.max(1,data.candles.slice(-21,-1).length);
  const candleRange=Math.max(0,candle.high-candle.low);
  const relativeRange=averageRange>0?candleRange/averageRange:0;
  // Attach a compact four-candle snapshot to each candle-close event report.
  const closedThree=data.candles.slice(-3);
  const liveNow=data.chartCandles.find(x=>x.time>candle.time)??null;
  const candleLabel=(x:C)=>x.close>x.open?"صاعدة":x.close<x.open?"هابطة":"حيرة";
  const candleLine=(x:C,label:string)=>{
   const range=Math.max(0,x.high-x.low),baseIndex=data.candles.findIndex(z=>z.time===x.time);
   const base=avg(data.candles.slice(Math.max(0,baseIndex-20),baseIndex).map(z=>z.volume).filter(Number.isFinite));
   const vr=base>0&&Number.isFinite(x.volume)?fmt(x.volume/base,2)+"× متوسط 20 شمعة":"غير متاح";
   return label+" "+candleLabel(x)+" | O "+fmt(x.open)+" · H "+fmt(x.high)+" · L "+fmt(x.low)+" · C "+fmt(x.close)+" · المدى "+fmt(range)+" USDT · الفوليوم "+vr;
  };
  const fourCandleReport=[...closedThree.map((x,i)=>candleLine(x,["C-3","C-2","C-1"][i])),liveNow?"C0 الحالية (حية/غير مغلقة) | O "+fmt(liveNow.open)+" · H "+fmt(liveNow.high)+" · L "+fmt(liveNow.low)+" · السعر الحالي "+fmt(data.price)+" · المدى حتى الآن "+fmt(Math.max(0,liveNow.high-liveNow.low))+" USDT · الفوليوم الجزئي "+(Number.isFinite(liveNow.volume)?fmt(liveNow.volume,3):"غير متاح")+" (لا يُقارن كحجم نهائي)":"C0 الحالية: غير متاحة في بيانات الشموع الحالية"].join(" || ");
  const contextThree=closedThree.length===3&&closedThree[0].close<closedThree[1].close&&closedThree[1].close<closedThree[2].close?"السياق المغلق: دفع صاعد متدرج":closedThree.length===3&&closedThree[0].close>closedThree[1].close&&closedThree[1].close>closedThree[2].close?"السياق المغلق: دفع هابط متدرج":"السياق المغلق: تداخل/تذبذب أو حركة غير متسلسلة";
  const patternState=plan.patternType==="حيرة"?"النموذج السابق "+plan.patternAr+" حيرة/تردد، ولا يمنح اتجاهاً مستقلاً":plan.confirmationStatus==="confirmed"?"النموذج السابق "+plan.patternAr+" مؤكد وفق شمعة التأكيد الأخيرة":plan.confirmationStatus==="weak"?"النموذج السابق "+plan.patternAr+" ضعيف السياق ولا يُعد إشارة اتجاهية":plan.confirmationStatus==="failed"?"النموذج السابق "+plan.patternAr+" فشل":plan.pattern?"النموذج السابق "+plan.patternAr+" بانتظار التأكيد":"لا يوجد نموذج سابق مكتمل";
  reasons.push("لقطة الشموع الأربع: "+fourCandleReport+". "+contextThree+". C0 متابعة حية فقط وليست إغلاقاً مؤكداً. ");
  reasons.push("أُغلقت شمعة مكتملة جديدة على "+frame+". الشمعة الأخيرة "+candleDirection+" (فتح "+fmt(candle.open)+"، إغلاق "+fmt(candle.close)+"). اتجاه 4H: "+plan.overallTrend+" و1H: "+plan.trend1h+". موقع السعر: "+plan.priceLocation+". الفوليوم "+fmt(volumeRatio,2)+"× متوسط 20 شمعة. "+(plan.rangeSqueeze?"النطاق منضغط (Squeeze).":plan.rangeExpansion?"النطاق يتوسع مع نشاط ملحوظ.":"لا يوجد انضغاط/توسع استثنائي.")+" مسافة EMA20: "+fmt(plan.emaDistanceAtr,2)+" ATR.");
  interpretations.push("تسلسل الشموع المغلقة الثلاث: "+contextThree+". الشمعة الحالية C0 تُعرض بقيمها اللحظية، ولا يُستنتج منها كسر/اختراق مؤكد قبل إغلاقها.");
  interpretations.push("حجم مدى الشمعة "+fmt(relativeRange,2)+"× متوسط مدى 20 شمعة. "+patternState+". ملاحظة: اتجاه الشمعة المغلقة يوصف مستقلاً عن نموذج الشمعة؛ إذا كان النموذج السابق حيرة فلا يعني ذلك أن الشمعة الجديدة نفسها حيرة أو أنها تؤيد النموذج السابق. "+(volumeRatio>=1.15?"الفوليوم أعلى من المتوسط ويدعم الحركة نسبياً.":volumeRatio<.7?"الفوليوم ضعيف؛ الحركة أقل موثوقية.":"الفوليوم قريب من المتوسط؛ لا يعطي تأكيداً قوياً بمفرده."));
  figures.push("الإغلاق: "+fmt(candle.close)+" USDT · اتجاه الشمعة: "+candleDirection+" · مدى الشمعة: "+fmt(relativeRange,2)+"× متوسط المدى · النموذج: "+(plan.patternAr||"لا يوجد")+" ("+plan.confirmationStatus+") · الفوليوم النسبي: "+fmt(volumeRatio,2)+"× · الدعم: "+(dist(plan.support)===null?"—":fmt(dist(plan.support)!))+" USDT · المقاومة: "+(dist(plan.resistance)===null?"—":fmt(dist(plan.resistance)!))+" USDT · حالة الإشارة: "+plan.side+" — "+plan.reason);
  followUps.push("راقب إغلاق الشمعة التالية بالنسبة للمستويات؛ لا تعتمد على حركة داخل الشمعة وحدها. "+(plan.confirmationStatus==="pending"?plan.confirmationDetail:""));
  reportDedupeRef.current.add(candleKey);
 }
 const tracker=breakTrackerRef.current;
 const breakKey=tracker.type&&tracker.level!==null?tracker.type+":"+tracker.status+":"+tracker.level+":"+frame:"";
 if(breakKey&&breakKey!==reportBreakRef.current){
  const prior=reportBreakRef.current;reportBreakRef.current=breakKey;
  if(tracker.type==="BROKEN_SUPPORT"){
   events.push("SUPPORT_BREAK");category="levels";
   reasons.push("رُصد كسر دعم مرجعي عند "+fmt(tracker.level!)+" USDT. "+tracker.detail);
   interpretations.push(tracker.status==="instant"?"تجاوز لحظي لم يؤكده إغلاق شمعة مكتملة؛ قد يكون اختراقاً كاذباً.":tracker.status==="reclaimed"?"استعادة المستوى تعني أن الكسر فقد صلاحيته.":"الإغلاق أسفل الدعم يدعم سيناريو الهبوط، وتزداد موثوقيته مع هامش ATR وفوليوم مناسب.");
   figures.push("المستوى المرجعي: "+fmt(tracker.level!)+" · التجاوز: "+fmt(overrun(tracker.level))+" USDT ("+fmt(overrun(tracker.level)/Math.max(tracker.level!,1)*100,3)+"%) · الحالة: "+(tracker.status==="instant"?"لحظي":tracker.status==="confirmed"?"مؤكد بإغلاق شمعة":tracker.status==="retest"?"إعادة اختبار":tracker.status==="retest-confirmed"?"إعادة اختبار مؤكدة":tracker.status==="reclaimed"?"استعادة المستوى":"منتهية"));
   followUps.push(tracker.status==="instant"?"السيناريو التالي: انتظار إغلاق أسفل الدعم أو استعادة المستوى.":"السيناريو التالي: متابعة إعادة الاختبار من أسفل أو استعادة الدعم بإغلاق.");
  }else{
   events.push("RESISTANCE_BREAK");category="levels";
   reasons.push("رُصد اختراق مقاومة مرجعية عند "+fmt(tracker.level!)+" USDT. "+tracker.detail);
   interpretations.push(tracker.status==="instant"?"تجاوز لحظي أعلى المقاومة ولم يؤكده إغلاق مكتمل؛ احتمال الاختراق الكاذب قائم.":tracker.status==="reclaimed"?"عودة السعر أسفل المستوى بإغلاق تعني فشل الاختراق.":"الإغلاق أعلى المقاومة يدعم سيناريو الصعود، مع أهمية إعادة الاختبار والفوليوم.");
   figures.push("المستوى المرجعي: "+fmt(tracker.level!)+" · التجاوز: "+fmt(overrun(tracker.level))+" USDT ("+fmt(overrun(tracker.level)/Math.max(tracker.level!,1)*100,3)+"%) · الحالة: "+(tracker.status==="instant"?"لحظي":tracker.status==="confirmed"?"مؤكد بإغلاق شمعة":tracker.status==="retest"?"إعادة اختبار":tracker.status==="retest-confirmed"?"إعادة اختبار مؤكدة":tracker.status==="reclaimed"?"استعادة المستوى":"منتهية"));
   followUps.push(tracker.status==="instant"?"السيناريو التالي: انتظار إغلاق أعلى المقاومة أو عودة السعر أسفلها.":"السيناريو التالي: متابعة إعادة الاختبار من أعلى أو فشل الاختراق بإغلاق أسفل المقاومة.");
  }
  if(tracker.status==="retest"||tracker.status==="retest-confirmed"||tracker.status==="retest-bounce"||tracker.status==="retest-rejection"||tracker.status==="reclaimed"){
   const retestEventKey="RETEST_OR_RECLAIM:"+frame+":"+tracker.type+":"+fmt(tracker.level??0,8)+":"+candle.time;
   if(!reportDedupeRef.current.has(retestEventKey)){
    reportDedupeRef.current.add(retestEventKey);
    events.push("RETEST_OR_RECLAIM");
    reasons.push("حدث اختبار المستوى المرجعي: "+tracker.detail);
    interpretations.push(tracker.status==="retest-bounce"?"ارتداد صاعد موثق: قاع الشمعة اختبر نطاق المقاومة المخترقة ثم أُغلق السعر فوقها؛ يدعم بقاء الاختراق ما لم يُستعد المستوى هبوطاً.":tracker.status==="retest-rejection"?"رفض هابط موثق: قمة الشمعة اختبرت نطاق الدعم المكسور ثم أُغلق السعر دونه؛ يدعم استمرار الكسر ما لم يستعد السعر المستوى.":tracker.status==="retest-confirmed"?"إعادة الاختبار دعمت اتجاه الكسر وفق شروط الإغلاق والفوليوم.":tracker.status==="reclaimed"?"استعادة المستوى تبطل فرضية استمرار الكسر الحالي.":"السعر عاد إلى نطاق المستوى؛ النتيجة لم تُحسم بعد.");
    figures.push("المستوى المرجعي: "+fmt(tracker.level??0)+" USDT · High: "+fmt(candle.high)+" · Low: "+fmt(candle.low)+" · Close: "+fmt(candle.close)+" · الفوليوم: "+fmt(volumeRatio,2)+"× المتوسط · السعر الحالي: "+fmt(data.price)+" USDT.");
    followUps.push(tracker.status==="retest-bounce"?"السيناريو التالي: استمرار الثبات أعلى المقاومة المخترقة يترك مجالاً لمواصلة الصعود؛ إغلاق لاحق أسفل المستوى يلغي فرضية الارتداد.":tracker.status==="retest-rejection"?"السيناريو التالي: استمرار الإغلاق أسفل الدعم المكسور يدعم متابعة الهبوط؛ إغلاق لاحق أعلى المستوى يلغي فرضية الرفض.":"انتظر إغلاق الشمعة لتحديد رفض المستوى أو استعادته، ولا تعتبر مجرد الملامسة تأكيداً.");
   }
  }
 }
 const currentOpen=new Set(signalLog.filter(x=>x.status==="مفتوحة").map(x=>x.id));
 for(const trade of signalLog){
  if(trade.status==="مفتوحة"&&!reportOpenedRef.current.has(trade.id)){
   reportOpenedRef.current.add(trade.id);events.push("OPEN_TRADE");category="trades";
   reasons.push("صدرت إشارة "+trade.side+" صالحة وسُجلت على "+trade.frame+". القرار مبني على اتجاه 4H/1H وموقع السعر والعوامل الفنية الموضحة في لوحة التحليل.");
   interpretations.push("هذه خطة رقمية مولدة من شروط الرادار وليست أمراً بتنفيذ صفقة؛ يجب مراجعة صلاحية الإشارة والمخاطرة قبل أي قرار.");
   figures.push("ENTRY "+fmt(trade.entry)+" · STOP LOSS "+fmt(trade.sl)+" · TP1 "+fmt(trade.tp1)+" · حجم الصفقة والمخاطرة يُحسبان في حاسبة POSITION SIZER حسب رأس المال ونسبة المخاطرة الحالية.");
   followUps.push("تابع الهدف والوقف؛ لا توسع الوقف عند تحرك السعر عكس السيناريو.");
  }
  const previous=reportStatusRef.current.get(trade.id);
  if(previous==="مفتوحة"&&trade.status!=="مفتوحة"){
   events.push("TRADE_CLOSED_OR_EXPIRED");category="trades";
   reasons.push("تغيرت نتيجة الإشارة المسجلة من مفتوحة إلى "+trade.status+".");
   interpretations.push(trade.status==="ضرب الوقف SL ❌"?"تحقق سيناريو الإبطال ووصل السعر إلى وقف الخسارة.":"تحقق الهدف الأول المسجل؛ لا يعني ذلك ضمان استمرار الحركة إلى أهداف أبعد.");
   figures.push("النتيجة: "+trade.status+" · الدخول: "+fmt(trade.entry)+" · الوقف: "+fmt(trade.sl)+" · TP1: "+fmt(trade.tp1));
   followUps.push("توقف عن التعامل مع الإشارة كصفقة مفتوحة، وراجع سبب النتيجة قبل الإشارة التالية.");
  }
  reportStatusRef.current.set(trade.id,trade.status);
 }
 if(!reportReadyRef.current){reportReadyRef.current=true;for(const trade of signalLog)reportStatusRef.current.set(trade.id,trade.status);}
 const ordered=signalLog;
 let losses=0;
 for(const trade of ordered){if(trade.status==="مفتوحة")continue;if(trade.status==="ضرب الوقف SL ❌")losses++;else break;}
 if(losses>=3&&!reportStreakGuardRef.current){
  reportStreakGuardRef.current=true;events.push("STREAK_GUARD");category="trades";
  reasons.push("تم بلوغ ثلاث خسائر متتالية في سجل الإشارات.");
  interpretations.push("حارس الخسائر يوقف التعامل مع الإشارات الجديدة مؤقتاً حتى تتم مراجعة الأداء؛ لا ينبغي مطاردة التعويض.");
  figures.push("الخسائر المتتالية: "+losses+" · عتبة التفعيل: 3 خسائر.");
  followUps.push("أعد تقييم الإعدادات وحجم المخاطرة، ولا تعد إلى التداول لمجرد الرغبة في التعويض.");
 }else if(losses<3&&reportStreakGuardRef.current){
  reportStreakGuardRef.current=false;events.push("STREAK_GUARD");category="trades";
  reasons.push("أُعيد تعيين حارس الخسائر لأن سلسلة الخسائر الحالية أصبحت أقل من العتبة.");
  interpretations.push("الحارس عاد إلى وضع الاستعداد؛ إعادة التعيين لا تعني أن السوق أصبح آمناً.");
  figures.push("الخسائر المتتالية الحالية: "+losses+" · عتبة التفعيل: 3.");
  followUps.push("استمر بتقييم كل إشارة على حدة وبنفس حد المخاطرة.");
 }
 if(!events.length)return;
 const eventNames:Record<ReportEvent,string>={CANDLE_CLOSE:"إغلاق شمعة",OPEN_TRADE:"فتح إشارة",SUPPORT_BREAK:"كسر دعم",RESISTANCE_BREAK:"اختراق مقاومة",RETEST_OR_RECLAIM:"إعادة اختبار / استعادة",TRADE_CLOSED_OR_EXPIRED:"نتيجة إشارة",STREAK_GUARD:"حارس الخسائر"};
 const title=events.map(x=>eventNames[x]).join(" + ");
 const timestamp=Date.now();
 const price=Number.isFinite(data.price)?data.price:candle.close;
 // Build the same point-in-time snapshot for every event, including break/retest-only reports.
 const reportClosed=data.candles.slice(-3);
 const reportLive=data.chartCandles.find(x=>x.time>candle.time)??null;
 const reportCandleText=reportClosed.map((x,i)=>{
  const index=data.candles.findIndex(z=>z.time===x.time);
  const base=avg(data.candles.slice(Math.max(0,index-20),index).map(z=>z.volume).filter(Number.isFinite));
  return ["C-3","C-2","C-1"][Math.max(0,3-reportClosed.length)+i]+" "+(x.close>x.open?"صاعدة":x.close<x.open?"هابطة":"محايدة")+" · O "+fmt(x.open)+" · H "+fmt(x.high)+" · L "+fmt(x.low)+" · C "+fmt(x.close)+" · Volume "+fmt(x.volume,3)+" · Volume/20 "+(base>0?fmt(x.volume/base,2)+"×":"—");
 }).join("\n");
 const reportLiveText=reportLive?"C0 حية وغير مغلقة · O "+fmt(reportLive.open)+" · H "+fmt(reportLive.high)+" · L "+fmt(reportLive.low)+" · السعر "+fmt(price)+" · Volume جزئي "+fmt(reportLive.volume,3):"C0 الحية: غير متاحة";
 const marketSnapshot=[
  "السعر الفوري: "+fmt(price)+" USDT · Mark Price: "+fmt(data.mark)+" USDT · الفريم: "+frame,
  "الاتجاه الأعلى: 4H "+plan.overallTrend+" (EMA20 "+fmt(data.trend4h.ema20)+" / EMA50 "+fmt(data.trend4h.ema50)+") · 1H "+plan.trend1h+" (EMA20 "+fmt(data.trend1h.ema20)+" / EMA50 "+fmt(data.trend1h.ema50)+")",
  "المستويات: الدعم الأقرب "+(plan.support===null?"—":fmt(plan.support)+" USDT · مسافة "+fmt(plan.supportDistance??NaN,3)+"%")+" · المقاومة الأقرب "+(plan.resistance===null?"—":fmt(plan.resistance)+" USDT · مسافة "+fmt(plan.resistanceDistance??NaN,3)+"%")+" · موقع السعر: "+plan.priceLocation+" · "+plan.levelDetail,
  "المؤشرات: RSI14 "+fmt(plan.rsi,2)+" · EMA20 "+fmt(plan.ema20)+" · EMA50 "+fmt(plan.ema50)+" · ATR14 "+fmt(plan.atr,4)+" · بُعد EMA20 "+fmt(plan.emaDistanceAtr,2)+" ATR",
  "الحركة والسيولة: "+plan.volumeText+" · "+plan.sweepText+" · "+(plan.rangeSqueeze?"انضغاط نطاق":plan.rangeExpansion?"اتساع نطاق":"لا انضغاط/اتساع استثنائي")+" · "+(plan.lowLiquidity?"سيولة منخفضة":"لا يوجد تحذير سيولة منخفضة"),
  "المشتقات: Funding "+fmt(data.funding*100,5)+"% · "+plan.fundingText+" · Open Interest "+fmt(data.oi,3)+" BTC · تغير OI "+(data.oiDelta===null?"غير متاح":fmt(data.oiDelta,3)+" BTC")+" · "+plan.oiText,
  "النموذج: "+plan.patternAr+" · النوع "+plan.patternType+" · الحالة "+plan.confirmationStatus+" · مستوى التأكيد "+fmt(plan.confirmation)+" · "+plan.confirmationDetail,
  "القرار: "+plan.side+" · LONG "+fmt(plan.longScore,0)+"% (RAW "+fmt(plan.longRaw,0)+") · SHORT "+fmt(plan.shortScore,0)+"% (RAW "+fmt(plan.shortRaw,0)+") · الفارق "+fmt(Math.abs(plan.longScore-plan.shortScore),0)+" نقطة · "+plan.reason,
  "حالة السوق: "+(plan.chop?"عرضي: "+plan.chopReason:"ليس عرضياً حسب مرشح النطاق")+(plan.counterTrend?" · الإشارة عكس اتجاه 4H":" · لا تعارض مع اتجاه 4H")+(plan.riskWarning?" · تحذير المخاطر: "+plan.riskWarning:""),
  "خطة الصفقة: ENTRY "+fmt(plan.entry)+" · SL "+fmt(plan.sl)+" · TP1 "+fmt(plan.tp1)+" · TP2 "+fmt(plan.tp2)+" · مسافة المخاطرة "+fmt(plan.riskDistance,4)+" USDT",
  "نسبة Long/Short للحسابات: غير متاحة في مصدر البيانات الحالي؛ لا يتم اختلاقها أو استنتاجها من Funding أو Open Interest",
  "POST-BREAK: "+(plan.postBreakType??"لا يوجد نوع نشط")+" · "+plan.postBreakStatus+" · المستوى "+(plan.postBreakLevel===null?"—":fmt(plan.postBreakLevel))+" · المتبقي "+plan.postBreakRemaining+" شمعة · "+plan.postBreakDetail
 ];
 const scoreReasons="عوامل LONG: "+(plan.longReasons.length?plan.longReasons.join("؛ "):"لا توجد عوامل مسجلة")+"\nعوامل SHORT: "+(plan.shortReasons.length?plan.shortReasons.join("؛ "):"لا توجد عوامل مسجلة");
 const candleSnapshot="الشموع المغلقة الأخيرة:\n"+(reportCandleText||"غير متاحة")+"\n"+reportLiveText;
 const trackerNow=breakTrackerRef.current;
 const breakSnapshot="لقطة متعقب الكسر: "+(trackerNow.type??"لا يوجد")+" · الحالة "+(trackerNow.status??"—")+" · المستوى "+(trackerNow.level===null?"—":fmt(trackerNow.level))+" · "+(trackerNow.detail||"لا توجد متابعة نشطة");
 interpretations.push("لقطة موحدة لحالة السوق وقت الحدث: "+marketSnapshot.join(" | "));
 interpretations.push(scoreReasons);
 figures.push(candleSnapshot);
 figures.push(breakSnapshot);
 const fullText="BTC RADAR · التقرير التحليلي الشامل\nالحدث: "+title+" ["+events.join(", ")+"]\nالوقت: "+new Date(timestamp).toLocaleString("ar")+" · الفريم: "+frame+" · السعر: "+fmt(price)+" USDT\n\n1) لقطة بيانات السوق والمؤشرات وقت الحدث:\n"+marketSnapshot.join("\n")+"\n\n2) الشموع الأخيرة:\n"+candleSnapshot+"\n\n3) أسباب نقاط LONG / SHORT:\n"+scoreReasons+"\n\n4) التعليل والسبب:\n"+reasons.join("\n")+"\n\n5) التفسير والأثر:\n"+interpretations.join("\n")+"\n\n6) الأرقام وتفاصيل الحدث:\n"+figures.join("\n")+"\n\n7) خطة المتابعة:\n"+followUps.join("\n");
 const id=frame+":"+candle.time+":"+events.join("|")+":"+timestamp;
 const report:EventReport={id,time:timestamp,frame,price,category,events,title,reason:reasons.join(" · "),interpretation:interpretations.join(" · "),figures:figures.join(" · "),followUp:followUps.join(" · "),fullText}; 
 const next=[report,...eventReports].slice(0,100);
 setEventReports(next);
 try{localStorage.setItem("btc-radar-event-reports-v1",JSON.stringify(next));localStorage.setItem("btc-radar-event-dedupe-v1",JSON.stringify(Array.from(reportDedupeRef.current).slice(-250)));}catch{}
},[data,plan,frame,signalLog]);

const load=useCallback(async()=>{try{const[t,k,p,o,h,h1Raw]=await Promise.all([api<{price:string}>("/fapi/v1/ticker/price?symbol=BTCUSDT"),api<unknown[][]>("/fapi/v1/klines?symbol=BTCUSDT&interval="+frame+"&limit=120"),api<{markPrice:string;lastFundingRate:string}>("/fapi/v1/premiumIndex?symbol=BTCUSDT"),api<{openInterest:string}>("/fapi/v1/openInterest?symbol=BTCUSDT"),api<unknown[][]>("/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=120"),api<unknown[][]>("/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=120")]);const now=Date.now(),allCandles=k.map(r=>({time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6])})),candles=allCandles.filter(x=>x.closeTime<now),h4=h.map(r=>({time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6])})).filter(x=>x.closeTime<now),h4Closes=h4.map(x=>x.close),h4E20=ema(h4Closes,20),h4E50=ema(h4Closes,50),trend4h:Trend4H={ema20:h4E20,ema50:h4E50,direction:h4E20>h4E50?"صاعد":h4E20<h4E50?"هابط":"محايد"},h1Candles=h1Raw.map(r=>({time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6])})).filter(x=>x.closeTime<now),h1Closes=h1Candles.map(x=>x.close),h1E20=ema(h1Closes,20),h1E50=ema(h1Closes,50),trend1h:Trend4H={ema20:h1E20,ema50:h1E50,direction:h1E20>h1E50?"صاعد":h1E20<h1E50?"هابط":"محايد"},fetchedOi=Number(o.openInterest),validOi=Number.isFinite(fetchedOi)&&fetchedOi>0,oi=validOi?fetchedOi:(oiRef.current??0),delta=validOi&&oiRef.current!==null?fetchedOi-oiRef.current:null;if(validOi){if(oiRef.current!==null)setOiDelta(delta);oiRef.current=fetchedOi;}if(candles.length<60||h4.length<50||h1Candles.length<50)throw new Error("شموع غير كافية لحساب الاتجاه متعدد الفريمات");setData({price:Number(t.price),mark:Number(p.markPrice),funding:Number(p.lastFundingRate),oi,oiDelta:validOi?delta:null,candles,chartCandles:allCandles,trend1h,trend4h,updated:now});setError("");}catch(e){setError(e instanceof Error?e.message:"تعذر جلب بيانات Binance");}finally{setLoading(false);}},[frame]);
useEffect(()=>{setLoading(true);oiRef.current=null;setOiDelta(null);chartFitRef.current=false;breakTrackerRef.current={frame,level:null,type:null,status:null,remaining:0,lastCandleTime:0,detail:"",impactLong:0,impactShort:0};void load();const id=setInterval(()=>void load(),12000);return()=>clearInterval(id);},[load]);
useEffect(()=>{
 const el=chartContainerRef.current;if(!el)return;let cancelled=false;let observer:ResizeObserver|undefined;let chart:any;let series:any;
 const init=()=>{if(cancelled||!chartContainerRef.current)return;const lib=(window as any).LightweightCharts;if(!lib||chartRef.current)return;chart=lib.createChart(chartContainerRef.current,{width:chartContainerRef.current.clientWidth,height:350,layout:{background:{type:lib.ColorType?.Solid??0,color:"#0b1423"},textColor:"#aab8cb"},grid:{vertLines:{color:"#1b2940"},horzLines:{color:"#1b2940"}},rightPriceScale:{borderColor:"#33445d",scaleMargins:{top:.12,bottom:.12}},timeScale:{borderColor:"#33445d",timeVisible:true,secondsVisible:false},crosshair:{mode:lib.CrosshairMode?.Normal??0}});series=chart.addCandlestickSeries({upColor:"#22c55e",downColor:"#ef4444",borderUpColor:"#22c55e",borderDownColor:"#ef4444",wickUpColor:"#22c55e",wickDownColor:"#ef4444",lastValueVisible:true,priceLineVisible:false});chartRef.current=chart;candleSeriesRef.current=series;setChartReady(true);observer=new ResizeObserver(entries=>{const width=Math.floor(entries[0]?.contentRect.width??0);if(width>0)chart.applyOptions({width,height:Math.max(320,Math.min(380,Math.round(window.innerHeight*.43)))});});observer.observe(chartContainerRef.current);};
 const existing=(window as any).LightweightCharts;if(existing)init();else{let script=document.querySelector<HTMLScriptElement>('script[data-btc-lightweight-charts="1"]');if(!script){script=document.createElement("script");script.src="https://unpkg.com/lightweight-charts@4.2.2/dist/lightweight-charts.standalone.production.js";script.async=true;script.dataset.btcLightweightCharts="1";document.head.appendChild(script);}script.addEventListener("load",init);}
 return()=>{cancelled=true;observer?.disconnect();if(chartRef.current){chartRef.current.remove();chartRef.current=null;candleSeriesRef.current=null;supportLineRef.current=null;resistanceLineRef.current=null;priceLineRef.current=null;}};
},[]);
useEffect(()=>{const series=candleSeriesRef.current,chart=chartRef.current;if(!series||!chart||!data?.chartCandles?.length)return;series.setData(data.chartCandles.map(x=>({time:Math.floor(x.time/1000),open:x.open,high:x.high,low:x.low,close:x.close})));if(!chartFitRef.current){chart.timeScale().fitContent();chartFitRef.current=true;}if(supportLineRef.current)series.removePriceLine(supportLineRef.current);if(resistanceLineRef.current)series.removePriceLine(resistanceLineRef.current);if(priceLineRef.current)series.removePriceLine(priceLineRef.current);supportLineRef.current=plan?.support!==null&&plan?.support!==undefined?series.createPriceLine({price:plan.support,color:"#22c55e",lineWidth:2,lineStyle:2,axisLabelVisible:true,title:"الدعم"}):null;resistanceLineRef.current=plan?.resistance!==null&&plan?.resistance!==undefined?series.createPriceLine({price:plan.resistance,color:"#ef4444",lineWidth:2,lineStyle:2,axisLabelVisible:true,title:"المقاومة"}):null;priceLineRef.current=series.createPriceLine({price:data.price,color:"#60a5fa",lineWidth:1,lineStyle:0,axisLabelVisible:true,title:"السعر"});},[data,plan,chartReady]);
const clearSignalLog=()=>{if(!window.confirm("هل تريد مسح سجل الإشارات المحفوظ على هذا الجهاز؟"))return;try{localStorage.removeItem("btc-radar-signal-log-v1");}catch{}lastLoggedRef.current="";setSignalLog([]);};
const clearEventReports=()=>{if(!window.confirm("هل تريد مسح سجل التقارير فقط؟ لن يتأثر سجل الإشارات."))return;try{localStorage.removeItem("btc-radar-event-reports-v1");localStorage.removeItem("btc-radar-event-dedupe-v1");}catch{}reportDedupeRef.current.clear();reportOpenedRef.current.clear();reportStatusRef.current.clear();reportBreakRef.current="";reportStreakGuardRef.current=false;reportReadyRef.current=false;setEventReports([]);};
const copyLatestReport=async()=>{if(!eventReports.length)return;try{await navigator.clipboard.writeText(eventReports[0].fullText);setReportCopied(true);window.setTimeout(()=>setReportCopied(false),1600);}catch{setReportCopied(false);}};
const visibleReports=eventReports.filter(r=>reportFilter==="all"||r.category===reportFilter).slice(0,10);
const copy=async()=>{if(!plan||!tradeable)return;try{await navigator.clipboard.writeText("BTC/USDT "+plan.side+"\nEntry: "+fmt(plan.entry)+"\nSL: "+fmt(plan.sl)+"\nTP1: "+fmt(plan.tp1)+"\nTP2: "+fmt(plan.tp2)+"\nATR14: "+fmt(plan.atr));setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{setCopied(false);}};
const css=".instant-root{min-height:100vh;background:#080d18;color:#e8edf7;padding:20px 14px 40px;font-family:Arial,Tahoma,sans-serif}.instant-wrap{max-width:760px;margin:auto}.instant-top,.instant-market,.instant-signal{display:flex;justify-content:space-between;align-items:center;gap:12px}.instant-brand,.instant-sub,.instant-label,.instant-price-label{font-size:11px;color:#93a4bd}.instant-title{font-size:23px;font-weight:900;margin:6px 0}.instant-pill{border:1px solid #29405a;border-radius:99px;padding:8px 11px;color:#72e0b2;font-size:11px}.instant-card{background:linear-gradient(145deg,#111b2d,#0d1524);border:1px solid #24334b;border-radius:17px;padding:16px;margin-top:12px;box-shadow:0 12px 30px #0002}.instant-price{font-size:27px;font-weight:900;direction:ltr;text-align:right;margin-top:6px}.instant-frame{display:flex;gap:5px}.instant-frame button{background:#17243a;border:1px solid #293a56;color:#aebbd0;border-radius:8px;padding:8px 10px;font-weight:700}.instant-frame button.active{background:#d7e7ff;color:#091322}.instant-side{font-size:31px;font-weight:950;letter-spacing:1px}.instant-side.long{color:#38d99b}.instant-side.short{color:#ff647c}.instant-side.none{color:#aab5c7}.instant-confidence{font-size:26px;font-weight:900;text-align:left}.instant-confidence small{display:block;color:#91a0b8;font-size:10px;font-weight:500}.instant-reason{margin:12px 0 0;padding-top:11px;border-top:1px solid #27344a;color:#c7d2e3;font-size:12px;line-height:1.7}.instant-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}.instant-number{background:#0b1423;border:1px solid #25344b;border-radius:12px;padding:12px}.instant-number span{display:block;color:#93a2b8;font-size:10px}.instant-number b{display:block;font-size:18px;direction:ltr;text-align:right;margin-top:6px;font-variant-numeric:tabular-nums}.instant-number.stop b{color:#ff7186}.instant-number.tp b{color:#42d9a0}.instant-copy{width:100%;margin-top:11px;background:#e1eafa;color:#091322;border:0;border-radius:11px;padding:13px;font-size:13px;font-weight:900}.instant-copy:disabled{opacity:.35}.instant-points{display:grid}.instant-point{display:flex;gap:10px;padding:13px 0;border-bottom:1px solid #26334a}.instant-point:last-child{border:0}.instant-index{width:25px;height:25px;flex:0 0 25px;border-radius:8px;background:#243650;color:#c9ddfa;display:grid;place-items:center;font-size:12px;font-weight:900}.instant-point strong{display:block;font-size:12px;margin-bottom:5px}.instant-point p,.instant-muted{margin:0;color:#aab8cb;font-size:12px;line-height:1.6}.instant-error{color:#ff8494;font-size:12px}.instant-meta{display:flex;justify-content:space-between;gap:8px;color:#71819a;font-size:10px;margin-top:12px;flex-wrap:wrap}.instant-empty{text-align:center;padding:22px 10px;color:#9aa9be;font-size:13px} .instant-input{width:100%;background:#0b1423;border:1px solid #30415b;border-radius:9px;color:#e8edf7;padding:10px;margin-top:6px;font-size:14px}.instant-warning{margin-top:10px;padding:10px;border-radius:10px;background:#3a2b18;color:#ffd18a;font-size:12px;line-height:1.6}.instant-log-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:11px 0;border-bottom:1px solid #26334a;font-size:11px}.instant-log-row:last-child{border:0}.instant-clear-log{background:transparent;border:1px solid #52627a;color:#cbd5e1;border-radius:7px;padding:5px 9px;font-size:10px;font-weight:700;cursor:pointer}.instant-clear-log:disabled{opacity:.35;cursor:not-allowed}.instant-foot{color:#66768e;font-size:10px;text-align:center;margin-top:15px;line-height:1.8}.instant-report-title{font-size:13px;font-weight:900}.instant-report-body{font-size:12px;line-height:1.8;color:#cbd6e6;margin-top:10px}.instant-report-body p{margin:7px 0}.instant-report-tag{display:inline-block;border:1px solid #334762;border-radius:7px;padding:4px 7px;margin:3px;font-size:10px;color:#c7d8ee}.instant-report-controls{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.instant-report-controls button{background:#17243a;border:1px solid #334762;color:#cbd6e6;border-radius:8px;padding:7px 9px;font-size:10px}.instant-report-controls button.active{background:#d7e7ff;color:#091322}.instant-report-controls button:disabled{opacity:.4}.instant-report-item{padding:10px 0;border-bottom:1px solid #26334a}.instant-report-item:last-child{border:0}.instant-report-item strong{font-size:11px}.instant-report-item p{margin:4px 0;color:#aab8cb;font-size:11px;line-height:1.6}.instant-report-copy{width:100%;margin-top:10px;background:#d7e7ff;color:#091322;border:0;border-radius:9px;padding:11px;font-weight:900;font-size:12px}.candle-readout-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.candle-readout-item{background:#0b1423;border:1px solid #25344b;border-radius:11px;padding:10px;min-width:0}.candle-readout-item.candle-live{border-color:#4b83a8;background:#102033}.candle-readout-head{display:flex;justify-content:space-between;align-items:center;gap:5px;flex-wrap:wrap}.candle-readout-head strong{font-size:11px}.candle-live-tag{font-size:9px;color:#8ed8ff;border:1px solid #37617d;border-radius:6px;padding:3px 5px}.candle-readout-direction{font-size:15px;font-weight:900;margin:8px 0;color:#cbd6e6}.candle-readout-direction.candle-up{color:#38d99b}.candle-readout-direction.candle-down{color:#ff7186}.candle-readout-item p{margin:4px 0;color:#aab8cb;font-size:10px;line-height:1.5;overflow-wrap:anywhere}.candle-context{margin-top:12px;padding:11px;background:#0b1423;border:1px solid #25344b;border-radius:10px;color:#cbd6e6;font-size:12px;line-height:1.7}.candle-context p{margin:6px 0 0;color:#aab8cb}.candle-decision{margin:10px 0 0;padding:11px;border-right:3px solid #6ba5d8;background:#132238;border-radius:8px;color:#e2eaf5;font-size:12px;line-height:1.8}@media(min-width:600px){.instant-root{padding:30px 20px}.instant-card{padding:19px}.instant-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:370px){.instant-price{font-size:21px}.instant-side{font-size:25px}.instant-number b{font-size:15px}}";
return <main className="instant-root" dir="rtl"><style>{css}</style><div className="instant-wrap">
<header className="instant-top"><div><div className="instant-brand">BTC RADAR · QUANT TERMINAL</div><h1 className="instant-title">تحليل BTC/USDT الفوري</h1><div className="instant-sub">Binance USDⓈ-M Futures · بيانات مباشرة</div></div><span className="instant-pill">● LIVE API</span></header>
<section className="instant-card"><div className="instant-market"><div><div className="instant-price-label">CURRENT PRICE · BTC/USDT</div><div className="instant-price">{data?fmt(data.price):"—"} <span style={{fontSize:11,color:"#8292aa"}}>USDT</span></div></div><div className="instant-frame">{(["5m","15m","1h","4h"] as Frame[]).map(f=><button key={f} className={frame===f?"active":""} onClick={()=>{if(frame!==f){breakTrackerRef.current={frame:f,level:null,type:null,status:null,remaining:0,lastCandleTime:0,detail:"",impactLong:0,impactShort:0};setData(null);setFrame(f);}}}>{f}</button>)}</div></div></section>
<section className="instant-card"><div className="instant-market"><strong style={{fontSize:14}}>الرسم البياني الحي · BTC/USDT</strong><span className="instant-label">{frame} · تحديث 12 ثانية</span></div><div ref={chartContainerRef} style={{width:"100%",height:"clamp(320px, 43vh, 380px)",minHeight:320}} aria-label="مخطط شموع BTC/USDT حي" /><div className="instant-meta" style={{marginTop:8}}><span style={{color:"#22c55e"}}>┄ الدعم</span><span style={{color:"#ef4444"}}>┄ المقاومة</span><span style={{color:"#60a5fa"}}>— السعر الحالي</span></div><p className="instant-muted" style={{marginTop:8}}>الشموع تتحدث مع بيانات Binance، وخطا الدعم والمقاومة محسوبان من آخر 80 شمعة مغلقة للفريم المختار.</p></section>
<section className="instant-card"><div className="instant-market"><strong style={{fontSize:14}}>اتجاه الفريمات العليا · 1H / 4H</strong><span style={{color:plan?.overallTrend==="صاعد"?"#38d99b":plan?.overallTrend==="هابط"?"#ff7186":"#aab5c7",fontWeight:900}}>4H: {data?plan?.overallTrend:"—"} · 1H: {data?plan?.trend1h:"—"}</span></div><p className="instant-muted" style={{marginTop:7}}>4H EMA20: {data?fmt(data.trend4h.ema20):"—"} · EMA50: {data?fmt(data.trend4h.ema50):"—"} · 1H EMA20: {data?fmt(data.trend1h.ema20):"—"} · EMA50: {data?fmt(data.trend1h.ema50):"—"}</p></section>
<section className="instant-card"><div className="instant-signal"><div><div className="instant-label">FINAL SIGNAL · {frame}</div><div className={"instant-side "+(plan?.side==="LONG"?"long":plan?.side==="SHORT"?"short":"none")}>{loading&&!plan?"LOADING":plan?.side??"—"}</div></div><div className="instant-confidence">{plan?plan.confidence+"%":"—"}<small>LONG {plan?.longScore??"—"}% · SHORT {plan?.shortScore??"—"}%</small><small>درجة توافق حسابية وليست احتمال ربح مثبت</small></div></div>{plan&&<p className="instant-reason">{plan.reason}</p>}{plan?.counterTrend&&<div className="instant-warning">⚠️ تنبيه: الإشارة الحالية عكس اتجاه 4H العام ({plan.overallTrend}). تعامل معها بحذر.</div>}{plan?.chop&&<div className="instant-warning">سوق عرضي ضيق — NO TRADE · تم إيقاف إشارات الدخول حتى يتسع النطاق أو تنفصل المتوسطات.</div>}{plan?.riskWarning&&<div className="instant-warning">{plan.riskWarning}</div>}{loading&&!plan&&<div className="instant-empty">جارٍ تحميل بيانات السوق...</div>}{error&&<p className="instant-error">{error}</p>}</section>
<section className="instant-card"><div className="instant-market"><strong style={{fontSize:14}}>أرقام الصفقة · TRADE PLAN</strong><span className="instant-label">ATR 14: {plan?fmt(plan.atr,4):"—"}</span></div><div className="instant-grid"><div className="instant-number"><span>ENTRY</span><b>{tradeable?fmt(plan.entry):"—"}</b></div><div className="instant-number stop"><span>STOP LOSS</span><b>{tradeable?fmt(plan.sl):"—"}</b></div><div className="instant-number tp"><span>TP1 · 1.5R</span><b>{tradeable?fmt(plan.tp1):"—"}</b></div><div className="instant-number tp"><span>TP2 · 2.5R</span><b>{tradeable?fmt(plan.tp2):"—"}</b></div></div>{tradeable&&<p className="instant-muted" style={{marginTop:9}}>الحساب: R = |ENTRY − STOP LOSS| = {fmt(plan.riskDistance,4)} USDT · TP1 = 1.5R · TP2 = 2.5R. الوقف خلف المستوى الفني بمسافة max(المسافة للمستوى + 0.25×ATR14، 1.2×ATR14).</p>}<button className="instant-copy" onClick={copy} disabled={!tradeable}>{copied?"تم نسخ الأرقام ✓":"نسخ أرقام الصفقة"}</button>{!tradeable&&<p className="instant-muted" style={{marginTop:10}}>لا توجد صفقة في هذه القراءة؛ سبب NO TRADE ظاهر في سطر القرار.</p>}</section>
<section className="instant-card"><strong style={{fontSize:14}}>حاسبة حجم الصفقة · POSITION SIZER</strong><div className="instant-grid"><label className="instant-number"><span>رأس مال الجلسة بالدولار (USDT)</span><input className="instant-input" type="number" min="0" step="any" value={sessionCapital} onChange={e=>setSessionCapital(e.target.value)} /></label><label className="instant-number"><span>نسبة المخاطرة (%)</span><input className="instant-input" type="number" min="0.01" max="100" step="0.1" value={riskPercent} onChange={e=>setRiskPercent(e.target.value)} /></label></div>{(()=>{const capital=Number(sessionCapital),risk=Number(riskPercent),validInputs=Number.isFinite(capital)&&capital>0&&Number.isFinite(risk)&&risk>0&&risk<=100, riskAmountUSDT=validInputs?capital*(risk/100):0,entry=tradeable&&Number.isFinite(plan.entry)?plan.entry:0,stopLoss=tradeable&&Number.isFinite(plan.sl)?plan.sl:0,stopDistance=tradeable?Math.abs(entry-stopLoss):0,positionSizeBTC=tradeable&&stopDistance>0&&validInputs?riskAmountUSDT/stopDistance:0,notionalValueUSDT=positionSizeBTC*entry,validCalc=tradeable&&validInputs&&stopDistance>0&&[riskAmountUSDT,positionSizeBTC,notionalValueUSDT,stopDistance].every(Number.isFinite);return <div className="instant-grid"><div className="instant-number"><span>المخاطرة القصوى بالدولار</span><b>{validInputs?fmt(riskAmountUSDT):"—"} USDT</b></div><div className="instant-number"><span>حجم الصفقة BTC</span><b>{validCalc?fmt(positionSizeBTC,6):"—"}</b></div><div className="instant-number"><span>القيمة الاسمية للصفقة</span><b>{validCalc?fmt(notionalValueUSDT):"—"} USDT</b></div><div className="instant-number"><span>المسافة إلى الوقف</span><b>{validCalc?fmt(stopDistance):"—"} USDT</b></div></div>})()}<p className="instant-muted" style={{marginTop:9}}>عند وجود إشارة صالحة: riskAmountUSDT = رأس المال × نسبة المخاطرة، وحجم BTC = مبلغ المخاطرة ÷ |ENTRY − STOP LOSS|، والقيمة الاسمية = حجم BTC × ENTRY. في NO TRADE تظهر نتائج الحجم والقيمة الاسمية والمسافة إلى الوقف كشرطة (—). لا يشمل الحساب الرسوم أو الانزلاق أو الرافعة.</p></section>
<section className="instant-card"><div className="instant-market"><strong style={{fontSize:14}}>رادار ما بعد الكسر وإعادة الاختبار · POST-BREAK</strong><span className="instant-label">QUALITY · {plan?.postBreakQuality??0}/100</span></div>
<div className="instant-reason"><strong>{plan?.postBreakLifecycle??"بانتظار البيانات"}</strong><p className="instant-muted">{plan?.postBreakDetail??"لا يوجد حدث نشط."}</p></div>
<div className="instant-grid">
<div className="instant-number"><span>الحدث / الفريم</span><b>{plan?.postBreakEventType??"—"}</b><p className="instant-muted">{frame}</p></div>
<div className="instant-number"><span>حالة التأكيد</span><b>{plan?.postBreakConfirmation??"—"}</b><p className="instant-muted">اللحظي لا يعد إغلاقاً مؤكداً</p></div>
<div className="instant-number"><span>المستوى المرجعي</span><b>{plan?.postBreakLevel!==null&&plan?.postBreakLevel!==undefined?fmt(plan.postBreakLevel):"—"}</b><p className="instant-muted">مرجع ثابت خلال دورة الحدث</p></div>
<div className="instant-number"><span>نافذة المتابعة</span><b>{plan?.postBreakElapsed??0} / {plan?.postBreakWindow??12}</b><p className="instant-muted">منقضٍ / إجمالي · متبقٍ {plan?.postBreakRemaining??0}</p></div>
<div className="instant-number"><span>المسافة عن المرجع</span><b>{plan?.postBreakDistance!==null&&plan?.postBreakDistance!==undefined?fmt(plan.postBreakDistance,4)+" USDT":"—"}</b><p className="instant-muted">{plan?.postBreakDistancePct!==null&&plan?.postBreakDistancePct!==undefined?fmt(plan.postBreakDistancePct,4)+"%":"—"} · {plan?.postBreakDistanceAtr!==null&&plan?.postBreakDistanceAtr!==undefined?fmt(plan.postBreakDistanceAtr,3)+" ATR14":"—"}</p></div>
<div className="instant-number"><span>نطاق القرب · PROXIMITY BAND</span><b>{plan?.postBreakBandLow!==null&&plan?.postBreakBandLow!==undefined?fmt(plan.postBreakBandLow):"—"} – {plan?.postBreakBandHigh!==null&&plan?.postBreakBandHigh!==undefined?fmt(plan.postBreakBandHigh):"—"}</b><p className="instant-muted">± {plan?fmt(plan.postBreakBand):"—"} USDT</p></div>
<div className="instant-number stop"><span>إبطال السيناريو · INVALIDATION</span><b>{plan?.postBreakInvalidation!==null&&plan?.postBreakInvalidation!==undefined?fmt(plan.postBreakInvalidation):"—"}</b><p className="instant-muted">إغلاق عكسي خارج هامش ATR</p></div>
<div className="instant-number"><span>فوليوم الحدث / متوسط 20</span><b>{plan?fmt(plan.postBreakVolumeRatio,2)+"×":"—"}</b><p className="instant-muted">{plan?.postBreakVolumeState??"—"}</p></div>
</div>
<div className="candle-context"><strong>جودة الحدث · 0–100</strong><p>{plan?.postBreakQualityFactors?.join(" · ")??"لا يوجد تقييم لعدم وجود حدث نشط."}</p><p><strong>ذيل الرفض:</strong> {plan?.postBreakWick??"—"} · <strong>سحب السيولة:</strong> {plan?.postBreakSweep??"—"}</p><p>يرتفع خطر التراجع عند غياب تأكيد الإغلاق، أو ضعف الفوليوم، أو تعارض 4H/1H، أو ظهور شموع مغلقة عكس اتجاه الحدث. الجودة ليست احتمال نجاح.</p></div>
<div className="candle-context"><strong>مخرجات منظمة للخوارزميات · MACHINE READABLE</strong><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:10,lineHeight:1.65,color:"#cbd6e6",margin:"8px 0 0"}}>{plan?.postBreakMachineText??"POST_BREAK_SCHEMA=1\nACTIVE=false"}</pre><button className="instant-report-copy" onClick={()=>{if(plan)navigator.clipboard?.writeText(plan.postBreakMachineText).then(()=>setReportCopied(true)).catch(()=>setReportCopied(false));}}>نسخ بيانات POST-BREAK المنظمة</button></div>
<p className="instant-muted">تحليل وصفي فقط؛ لا ينشئ صفقات تلقائية ولا يغيّر معادلة النقاط أو عتبة الإشارة أو شروط NO TRADE.</p></section>
<section className="instant-card">
<div className="instant-market"><strong style={{fontSize:14}}>التقارير والتعاليل الشاملة · EVENT REPORTS</strong><span className="instant-label">آخر 10 تقارير · محفوظة محلياً</span></div>
{eventReports.length>0?<><div className="instant-report-title">أحدث تقرير · {eventReports[0].title}</div><div className="instant-meta"><span>{new Date(eventReports[0].time).toLocaleString("ar")}</span><span>{eventReports[0].frame}</span><span>{fmt(eventReports[0].price)} USDT</span></div><div className="instant-report-body"><p><strong>الحدث:</strong> {eventReports[0].events.join(" · ")}</p><p><strong>لماذا حدث؟</strong> {eventReports[0].reason}</p><p><strong>ماذا يعني؟</strong> {eventReports[0].interpretation}</p><p><strong>الأرقام:</strong> {eventReports[0].figures}</p><p><strong>المتابعة:</strong> {eventReports[0].followUp}</p></div><button className="instant-report-copy" onClick={copyLatestReport}>{reportCopied?"تم نسخ التقرير ✓":"نسخ التقرير الأحدث"}</button></>:<div className="instant-empty">سيظهر التقرير تلقائياً عند إغلاق شمعة أو حدوث حدث مهم.</div>}
<div className="instant-report-controls"><button className={reportFilter==="all"?"active":""} onClick={()=>setReportFilter("all")}>الكل</button><button className={reportFilter==="candles"?"active":""} onClick={()=>setReportFilter("candles")}>الشموع</button><button className={reportFilter==="levels"?"active":""} onClick={()=>setReportFilter("levels")}>المستويات والاختراقات</button><button className={reportFilter==="trades"?"active":""} onClick={()=>setReportFilter("trades")}>الصفقات والحارس</button><button onClick={clearEventReports} disabled={!eventReports.length}>مسح سجل التقارير</button></div>
{visibleReports.length?visibleReports.map(r=><div className="instant-report-item" key={r.id}><strong>{r.title} · {r.frame}</strong><p>{new Date(r.time).toLocaleString("ar")} · السعر {fmt(r.price)} USDT</p><p>{r.reason}</p></div>):<div className="instant-empty">لا توجد تقارير ضمن هذا التصنيف.</div>}
<p className="instant-muted" style={{marginTop:8}}>السجل مستقل عن سجل أداء الإشارات. تُدمج أحداث الشمعة المتزامنة في تقرير واحد وتُمنع إعادة كتابة تقرير الإغلاق عند تحديث البيانات كل 12 ثانية.</p>
</section>
<section className="instant-card"><strong style={{fontSize:14}}>مستويات الدعم والمقاومة · آخر 80 شمعة مغلقة</strong>{plan&&<div className="instant-grid"><div className="instant-number"><span>الدعم الأقرب · LOWEST LOW</span><b>{plan.support!==null?fmt(plan.support):"—"}</b><p className="instant-muted">المسافة: {plan.supportDistance!==null?fmt(plan.supportDistance,3)+"%":"—"}</p></div><div className="instant-number"><span>المقاومة الأقرب · HIGHEST HIGH</span><b>{plan.resistance!==null?fmt(plan.resistance):"—"}</b><p className="instant-muted">المسافة: {plan.resistanceDistance!==null?fmt(plan.resistanceDistance,3)+"%":"—"}</p></div></div>}<p className="instant-reason">موقع السعر: <strong>{plan?.priceLocation??"—"}</strong> · تُعد المنطقة قريبة إذا كانت المسافة ≤ الأكبر من 0.15% أو نصف ATR من السعر.</p>{plan&&<p className="instant-muted">{plan.levelDetail}</p>}{plan?.levelWarning&&<p className="instant-error">{plan.levelWarning}</p>}</section>
<section className="instant-card"><strong style={{fontSize:14}}>شفافية النقاط · LONG / SHORT</strong>{plan&&<div className="instant-grid"><div className="instant-number"><span>LONG · RAW SCORE</span><b>{fmt(plan.longRaw,0)}</b><p className="instant-muted">FINAL: {fmt(plan.longScore,0)}% · أثر الرادار {plan.longImpact>=0?"+":""}{fmt(plan.longImpact,0)}</p></div><div className="instant-number"><span>SHORT · RAW SCORE</span><b>{fmt(plan.shortRaw,0)}</b><p className="instant-muted">FINAL: {fmt(plan.shortScore,0)}% · أثر الرادار {plan.shortImpact>=0?"+":""}{fmt(plan.shortImpact,0)}</p></div></div>}<p className="instant-muted">الخام هو مجموع العوامل قبل حد الصفر؛ النهائي بعد التصفير والحد الأعلى 100. أثر إعادة الاختبار يظهر مستقلاً داخل الخام.</p></section>
<section className="instant-card">
<div className="instant-market"><strong style={{fontSize:14}}>ترابط آخر 3 شمعات مغلقة + الحالية · C-3 / C-2 / C-1 / C0</strong><span className="instant-label">{frame} · قراءة حية</span></div>
{candleReadout?<><div className="candle-readout-grid">{candleReadout.items.map((item,i)=><div className={"candle-readout-item "+(item.isLive?"candle-live":"")} key={item.label}><div className="candle-readout-head"><strong>{item.label}</strong>{item.isLive&&<span className="candle-live-tag">حية · غير مغلقة</span>}</div><div className={"candle-readout-direction "+(item.direction==="صاعدة"?"candle-up":item.direction==="هابطة"?"candle-down":"")}>{item.direction}</div>{item.candle&&<><p>فتح {fmt(item.candle.open)} · إغلاق {fmt(item.candle.close)}</p><p>أعلى {fmt(item.candle.high)} · أدنى {fmt(item.candle.low)}</p><p>النطاق {fmt(item.range)} USDT</p><p>الفوليوم النسبي {item.ratio===null?"غير متاح":fmt(item.ratio,2)+"×"} {item.isLive?"(جزئي حتى الآن)":"من متوسط 20 شمعة سابقة"}</p></>}</div>)}</div><div className="candle-context"><strong>سياق الشموع المغلقة:</strong> {candleReadout.context}<p><strong>متابعة الحالية فقط:</strong> {candleReadout.liveState}. هذه الشمعة لم تغلق بعد ولا تدخل في تأكيد الكسر أو الاختراق.</p></div><p className="candle-decision">{candleReadout.summary}</p></>:<div className="instant-empty">بانتظار اكتمال بيانات الشموع للفريم المختار.</div>}
<p className="instant-muted" style={{marginTop:9}}>الترتيب الزمني من الأقدم C-3 إلى الأحدث C-1؛ الشمعة C0 حية. هذه القراءة تفسيرية ولا تضيف أو تخصم نقاطاً من معادلة LONG / SHORT.</p>
</section>
<section className="instant-card"><div className="instant-market"><strong style={{fontSize:14}}>سجل أداء الإشارات · آخر 10</strong><div style={{display:"flex",alignItems:"center",gap:8}}><span className="instant-label">محفوظ محلياً على هذا الجهاز</span><button type="button" className="instant-clear-log" onClick={clearSignalLog} disabled={!signalLog.length}>مسح السجل</button></div></div>{signalLog.length?signalLog.map(x=><div className="instant-log-row" key={x.id}><div><strong>{x.side} · {x.frame}</strong><div className="instant-muted">دخول {fmt(x.entry)} · SL {fmt(x.sl)} · TP1 {fmt(x.tp1)}</div><div className="instant-muted">{new Date(x.time).toLocaleString("ar")}</div></div><strong style={{color:x.status==="حقق الهدف TP1 ✅"?"#38d99b":x.status==="ضرب الوقف SL ❌"?"#ff7186":"#f4c879"}}>{x.status}</strong></div>):<div className="instant-empty">لا توجد إشارات مسجلة بعد.</div>}<p className="instant-muted" style={{marginTop:9}}>تُسجّل الإشارة مرة واحدة لكل شمعة مغلقة وفريم، وتُراقب الأسعار الحية. عند وصول الهدف أو الوقف تُثبّت النتيجة.</p></section>
<div className="instant-meta"><span>آخر تحديث: {data?new Date(data.updated).toLocaleTimeString("ar"):"—"}</span><span>Mark Price: {data?fmt(data.mark):"—"}</span><span>تحديث كل 12 ثانية</span></div>
<footer className="instant-foot">Binance Public API · لا يتم إرسال أوامر تداول ولا استخدام مفاتيح حسابك. درجة التوافق ليست نسبة نجاح تاريخية.</footer>
</div></main>;
}
