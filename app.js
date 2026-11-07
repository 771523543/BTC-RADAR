(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const state = { market:'spot', interval:'15m', candles:[], ticker:null, ws:null, reconnect:null, lastPrice:0, busy:false };
const fmt = (n, digits=2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
const compact = n => { n=Number(n); if(!Number.isFinite(n)) return '—'; if(Math.abs(n)>=1e9)return (n/1e9).toFixed(2)+'B';if(Math.abs(n)>=1e6)return (n/1e6).toFixed(2)+'M';if(Math.abs(n)>=1e3)return (n/1e3).toFixed(2)+'K';return fmt(n,2); };
const api = (path, futures=state.market==='futures') => (futures?'https://fapi.binance.com':'https://api.binance.com')+path;
async function getJSON(url){
  const parsed=new URL(url),path=parsed.pathname+parsed.search;
  const hosts=parsed.hostname==='api.binance.com'
    ? ['data-api.binance.vision','api1.binance.com','api2.binance.com','api3.binance.com','api4.binance.com']
    : parsed.hostname==='fapi.binance.com'
      ? ['fapi.binance.com','fapi1.binance.com','fapi2.binance.com','fapi3.binance.com']
      : [parsed.hostname];
  let lastError;
  for(const host of hosts){
    try{
      const response=await fetch(parsed.protocol+'//'+host+path,{cache:'no-store',mode:'cors'});
      if(!response.ok)throw new Error(host+' HTTP '+response.status);
      return await response.json();
    }catch(error){lastError=error;console.warn('Binance endpoint failed:',host,error);}
  }
  throw lastError||new Error('تعذر الوصول إلى واجهات Binance');
}
function setConnection(status,msg){$('connectionDot').parentElement.className='connection '+status;$('connectionText').textContent=msg;}
function setText(id,v){$(id).textContent=v;}
function ema(values,period){const k=2/(period+1);let prev=values.slice(0,period).reduce((a,b)=>a+b,0)/period;const out=Array(period-1).fill(null);out.push(prev);for(let i=period;i<values.length;i++){prev=values[i]*k+prev*(1-k);out.push(prev);}return out;}
function rsi(values,period=14){if(values.length<=period)return null;let gains=0,losses=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];if(d>0)gains+=d;else losses-=d;}let ag=gains/period,al=losses/period;for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(period-1)+Math.max(d,0))/period;al=(al*(period-1)+Math.max(-d,0))/period;}return al===0?100:100-100/(1+ag/al);}
function fmtPrice(v){return fmt(v, v<1?5:2);}
async function loadTicker(){try{const t=await getJSON(api('/'+(state.market==='futures'?'fapi/v1':'api/v3')+'/ticker/24hr?symbol=BTCUSDT'));state.ticker=t;state.lastPrice=Number(t.lastPrice);renderTicker(t);setConnection('connected','متصل ببيانات السوق');$('lastUpdate').textContent='آخر تحديث: '+new Date().toLocaleTimeString('ar');}catch(e){const reason=e?.message||String(e);setConnection('error','فشل اتصال Binance');$('lastUpdate').textContent='سبب تعذر السعر: '+reason;console.warn('Ticker load failed:',e);}}
function renderTicker(t){const p=Number(t.lastPrice),change=Number(t.priceChangePercent);setText('lastPrice',fmt(p,2));setText('priceChange',(change>=0?'+':'')+fmt(change,2)+'%');$('priceChange').classList.toggle('negative',change<0);setText('high24',fmt(Number(t.highPrice),2));setText('low24',fmt(Number(t.lowPrice),2));setText('volume24',compact(t.volume)+' BTC');setText('change24',(change>=0?'+':'')+fmt(change,2)+'%');setText('levelPrice',fmt(p,2));updateRisk();}
async function loadCandles(){ $('chartLoading').style.display='grid';try{const arr=await getJSON(api('/'+(state.market==='futures'?'fapi/v1':'api/v3')+'/klines?symbol=BTCUSDT&interval='+state.interval+'&limit=240'));state.candles=arr.map(x=>({time:x[0],closeTime:x[6],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5]}));$('chartLoading').style.display='none';analyze();drawChart();setText('candleInfo','آخر شمعة: '+new Date(state.candles.at(-1).time).toLocaleString('ar'));}catch(e){$('chartLoading').textContent='فشل تحميل الشموع: '+(e?.message||String(e));$('chartLoading').style.display='grid';console.warn('Candles load failed:',e);}}
function analyze(){const c=state.candles.filter(x=>Number(x.closeTime)<Date.now());if(c.length<200)return;const closes=c.map(x=>x.close),e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200),r=rsi(closes);const candlePrice=closes.at(-1),price=state.lastPrice>0?state.lastPrice:candlePrice,a=e20.at(-1),b=e50.at(-1),d=e200.at(-1);const bullish=candlePrice>a&&a>b&&(e200.at(-1)==null||b>d),bearish=candlePrice<a&&a<b&&(e200.at(-1)==null||b<d);const bullScore=(candlePrice>a?25:0)+(a>b?25:0)+(b>d?25:0)+(r>50?25:0),bearScore=(candlePrice<a?25:0)+(a<b?25:0)+(b<d?25:0)+(r<50?25:0),score=Math.max(bullScore,bearScore);const trend=bullish?'صاعد':bearish?'هابط':'عرضي / غير محسوم';$('trendTag').textContent=trend;$('trendTag').className='tag '+(bullish?'positive':bearish?'negative':'neutral');setText('scoreValue',score);$('scoreRing').style.borderColor=bullish?'var(--green)':bearish?'var(--red)':'#68758b';setText('trendTitle',trend);setText('trendDescription',bullish?'السعر أعلى من EMA20 وEMA50، والمتوسطات تميل للإيجابية.':bearish?'السعر أسفل EMA20 وEMA50، والمتوسطات تميل للسلبية.':'المتوسطات لا تقدم اصطفافًا واضحًا؛ تجنب افتراض اتجاه قوي.');setText('ema20Value',fmtPrice(a));setText('ema50Value',fmtPrice(b));setText('ema200Value',d?fmtPrice(d):'بيانات غير كافية');setText('ema20State',candlePrice>a?'إغلاق الشمعة فوقه':'إغلاق الشمعة تحته');setText('ema50State',candlePrice>b?'إغلاق الشمعة فوقه':'إغلاق الشمعة تحته');setText('ema200State',d?(candlePrice>d?'إغلاق الشمعة فوقه':'إغلاق الشمعة تحته'):'—');setText('rsiValue',r===null?'—':fmt(r,1));setText('rsiState',r>70?'تشبع شراء':r<30?'تشبع بيع':'منطقة وسطية');const sig=$('signalBox');if(bullish){setText('signalTitle','ميل إيجابي — لا دخول تلقائي');setText('signalText','راقب إغلاقًا فوق المقاومة الأقرب ثم إعادة اختبارها. لا تعتمد على الاتجاه وحده.');}else if(bearish){setText('signalTitle','ميل سلبي — لا دخول تلقائي');setText('signalText','راقب إغلاقًا تحت الدعم الأقرب ثم إعادة اختبار فاشلة. تجنب مطاردة الهبوط.');}else{setText('signalTitle','انتظار — لا توجد أفضلية واضحة');setText('signalText','انتظر خروج السعر من النطاق وإغلاق شمعة واضحًا ثم تحقق إعادة الاختبار.');}
const recent=c.slice(-241,-1);
const trs=c.slice(-15).map((x,i,a)=>{const prev=i?a[i-1].close:x.open;return Math.max(x.high-x.low,Math.abs(x.high-prev),Math.abs(x.low-prev));});
const atr=trs.slice(1).reduce((a,b)=>a+b,0)/Math.max(1,trs.length-1);
const levelTolerance=Math.max(atr*.35,price*.0012);
const pivotHigh=localExtremes(recent.map(x=>x.high),true).map(v=>({price:v}));
const pivotLow=localExtremes(recent.map(x=>x.low),false).map(v=>({price:v}));
const cluster=(items)=>{const sorted=items.sort((a,b)=>a.price-b.price),groups=[];for(const item of sorted){let g=groups.at(-1);if(!g||item.price-g.mean>levelTolerance){groups.push({values:[item.price],mean:item.price});}else{g.values.push(item.price);g.mean=g.values.reduce((a,b)=>a+b,0)/g.values.length;}}return groups.map(g=>({price:g.mean,touches:g.values.length})).filter(g=>g.touches>=1);};
const resistanceGroups=cluster(pivotHigh).filter(g=>g.price>price).sort((a,b)=>a.price-b.price);
const supportGroups=cluster(pivotLow).filter(g=>g.price<price).sort((a,b)=>b.price-a.price);
const pick=(groups)=>{const out=[];for(const g of groups){if(out.every(x=>Math.abs(x.price-g.price)>levelTolerance*1.25))out.push(g);if(out.length===2)break;}return out;};
const rLevels=pick(resistanceGroups),sLevels=pick(supportGroups),rs=rLevels.map(x=>x.price),ss=sLevels.map(x=>x.price);
const resistance=rs[0],support=ss[0];
setText('resistance1',fmtPrice(rs[0]));setText('resistance2',fmtPrice(rs[1]));
setText('support1',fmtPrice(ss[0]));setText('support2',fmtPrice(ss[1]));
const describe=(g)=>g?g.touches>=3?'قوي نسبيًا':g.touches===2?'متوسط':'مراقبة':'غير متاح';
const dist=(v)=>Number.isFinite(v)?(Math.abs(v-price)/price*100).toFixed(2)+'%':'—';
const note='مرجع المستويات هو السعر المباشر '+fmtPrice(price)+'؛ R1 '+describe(rLevels[0])+' ('+dist(rs[0])+')، S1 '+describe(sLevels[0])+' ('+dist(ss[0])+').';
if($('levelsNote'))setText('levelsNote',note);
const last=c.at(-1),priorVolumes=c.slice(-21,-1).map(x=>x.volume),avgVolume=priorVolumes.reduce((a,b)=>a+b,0)/Math.max(1,priorVolumes.length),volumeRatio=avgVolume?last.volume/avgVolume:0;
const buffer=Math.max(atr*.10,price*.0005),retestBand=Math.max(atr*.25,price*.001);
setText('bullTrigger',Number.isFinite(resistance)?fmtPrice(resistance):'لا يوجد مستوى قريب');
setText('bearTrigger',Number.isFinite(support)?fmtPrice(support):'لا يوجد مستوى قريب');
setText('closedCandleValue',fmtPrice(last.close));
setText('volumeRatioValue',fmt(volumeRatio,2)+'x');
setText('atrValue',fmtPrice(atr));
const tf=state.interval;
let bullState='انتظار الاختراق',bearState='انتظار الكسر';
let bullText=Number.isFinite(resistance)?'انتظر إغلاق شمعة '+tf+' فوق '+fmtPrice(resistance+buffer)+'، مع حجم تداول لا يقل عن 1.2x المتوسط. بعد ذلك انتظر إعادة اختبار المستوى والثبات فوقه.':'لا تتوفر مقاومة صالحة لبناء سيناريو إيجابي.';
let bearText=Number.isFinite(support)?'انتظر إغلاق شمعة '+tf+' تحت '+fmtPrice(support-buffer)+'، مع حجم تداول لا يقل عن 1.2x المتوسط. بعد ذلك انتظر إعادة اختبار المستوى والفشل في استعادته.':'لا يتوفر دعم صالح لبناء سيناريو سلبي.';
let bullTarget='الهدف الأول: '+(Number.isFinite(rs[1])?fmtPrice(rs[1]):fmtPrice((resistance||price)+atr*1.5));
let bearTarget='الهدف الأول: '+(Number.isFinite(ss[1])?fmtPrice(ss[1]):fmtPrice((support||price)-atr*1.5));
let bullInvalid='إبطال السيناريو: إغلاق '+tf+' دون '+(Number.isFinite(resistance)?fmtPrice(resistance-buffer):'المستوى')+'.';
let bearInvalid='إبطال السيناريو: إغلاق '+tf+' فوق '+(Number.isFinite(support)?fmtPrice(support+buffer):'المستوى')+'.';
let confirmation='لا يوجد اختراق مؤكد؛ الانتظار هو الوضع الحالي.';
let bullBreak=-1,bearBreak=-1;
if(Number.isFinite(resistance)){
 for(let k=Math.max(1,c.length-7);k<c.length;k++){
  const baseVol=c.slice(Math.max(0,k-20),k).reduce((sum,x)=>sum+x.volume,0)/Math.max(1,Math.min(20,k));
  if(c[k-1].close<=resistance+buffer&&c[k].close>resistance+buffer&&baseVol>0&&c[k].volume/baseVol>=1.2)bullBreak=k;
 }
}
if(Number.isFinite(support)){
 for(let k=Math.max(1,c.length-7);k<c.length;k++){
  const baseVol=c.slice(Math.max(0,k-20),k).reduce((sum,x)=>sum+x.volume,0)/Math.max(1,Math.min(20,k));
  if(c[k-1].close>=support-buffer&&c[k].close<support-buffer&&baseVol>0&&c[k].volume/baseVol>=1.2)bearBreak=k;
 }
}
if(bullBreak>=0){
 const retest=c.slice(bullBreak+1).some(x=>x.low<=resistance+retestBand&&x.close>=resistance-buffer);
 bullState=retest?'اختراق وإعادة اختبار ناجح':'اختراق مبدئي — انتظر إعادة الاختبار';
 bullText=retest?'أغلق السعر فوق المقاومة بحجم داعم، ثم اختبر المنطقة وحافظ على الإغلاق فوقها. لا تطارد السعر إذا ابتعد عن المستوى.':'حدث إغلاق اختراق بحجم داعم، لكن لا توجد إعادة اختبار مكتملة بعد؛ لا تستعجل الدخول.';
 confirmation=retest?'اختراق صاعد مع إعادة اختبار ناجحة':'اختراق صاعد أولي؛ إعادة الاختبار لم تتأكد';
}
if(bearBreak>=0){
 const retest=c.slice(bearBreak+1).some(x=>x.high>=support-retestBand&&x.close<=support+buffer);
 bearState=retest?'كسر وإعادة اختبار ناجح':'كسر مبدئي — انتظر إعادة الاختبار';
 bearText=retest?'أغلق السعر أسفل الدعم بحجم داعم، ثم عاد لاختبار المنطقة وفشل في استعادتها. تجنب مطاردة الهبوط.':'حدث إغلاق كسر بحجم داعم، لكن إعادة الاختبار لم تكتمل بعد؛ انتظر.';
 confirmation=retest?'كسر هابط مع إعادة اختبار ناجحة':'كسر هابط أولي؛ إعادة الاختبار لم تتأكد';
}
if(bullBreak>=0&&bearBreak>=0)confirmation='إشارات متعارضة؛ لا أفضلية واضحة، انتظر';
setText('bullText',bullText);
setText('bearText',bearText);
setText('bullTarget',bullTarget);
setText('bearTarget',bearTarget);
setText('bullInvalidation',bullInvalid);
setText('bearInvalidation',bearInvalid);
setText('bullState',bullState);
setText('bearState',bearState);
setText('confirmationStatus',confirmation);}
function localExtremes(vals,isHigh){const out=[];for(let i=2;i<vals.length-2;i++){const v=vals[i],slice=vals.slice(i-2,i+3),ties=slice.filter(x=>x===v).length;if((isHigh?v===Math.max(...slice):v===Math.min(...slice))&&ties===1)out.push(v);}return out;}
async function loadOrderBook(){try{const d=await getJSON(api('/'+(state.market==='futures'?'fapi/v1':'api/v3')+'/depth?symbol=BTCUSDT&limit=10'));const asks=d.asks.slice(0,5).reverse(),bids=d.bids.slice(0,5);const max=Math.max(...[...asks,...bids].map(x=>+x[1]));$('asks').innerHTML=asks.map(x=>bookRow(x,max,'ask')).join('');$('bids').innerHTML=bids.map(x=>bookRow(x,max,'bid')).join('');setText('spread',fmt(+d.asks[0][0]-+d.bids[0][0],2)+' USDT');}catch(e){$('asks').innerHTML='<div class="muted small">بيانات دفتر الأوامر غير متاحة</div>';$('bids').innerHTML='';}}
function bookRow(x,max,type){const depth=Math.max(5,(+x[1]/max)*100);return '<div class="book-row" style="--depth:'+depth+'%"><span>'+fmt(+x[0],1)+'</span><span>'+fmt(+x[1],4)+'</span></div>';}
async function loadFutures(){
  if(state.market!=='futures'){
    ['fundingRate','openInterest','longShort','markPrice'].forEach(id=>setText(id,'—'));
    setText('futuresStatus','اختر Futures');
    setText('futuresNote','اختر سوق العقود الآجلة لعرض التمويل والعقود المفتوحة ونسبة Long/Short.');
    return;
  }
  setText('futuresStatus','جارٍ التحميل');
  setText('futuresNote','جارٍ جلب كل مقياس بصورة مستقلة من Binance Futures...');
  const requests=await Promise.allSettled([
    getJSON('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
    getJSON('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'),
    getJSON('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=15m&limit=1')
  ]);
  const [premiumResult,oiResult,lsResult]=requests;
  const errors=[];
  if(premiumResult.status==='fulfilled'){
    const premium=premiumResult.value;
    setText('fundingRate',Number.isFinite(+premium.lastFundingRate)?(+premium.lastFundingRate*100).toFixed(4)+'%':'غير متاح');
    setText('markPrice',Number.isFinite(+premium.markPrice)?fmt(+premium.markPrice,2):'غير متاح');
  }else{
    setText('fundingRate','تعذر التحميل');setText('markPrice','تعذر التحميل');
    errors.push('Funding/Mark: '+(premiumResult.reason?.message||'فشل الاتصال'));
  }
  if(oiResult.status==='fulfilled'){
    setText('openInterest',compact(oiResult.value.openInterest));
  }else{
    setText('openInterest','تعذر التحميل');
    errors.push('Open Interest: '+(oiResult.reason?.message||'فشل الاتصال'));
  }
  if(lsResult.status==='fulfilled'&&Array.isArray(lsResult.value)&&lsResult.value.length){
    setText('longShort',fmt(+lsResult.value[0].longShortRatio,3)+' : 1');
  }else{
    setText('longShort','غير متاح');
    if(lsResult.status==='rejected')errors.push('Long/Short: '+(lsResult.reason?.message||'غير متاح'));
  }
  const coreOk=premiumResult.status==='fulfilled'||oiResult.status==='fulfilled';
  setText('futuresStatus',coreOk?'متصل':'فشل الاتصال');
  setText('futuresNote',errors.length?'تعذر تحميل بعض المقاييس: '+errors.join(' | '):'تم تحديث بيانات العقود الآجلة من Binance Futures.');
  if(errors.length)console.warn('Futures metrics:',errors);
}
function drawChart(){const canvas=$('priceChart'),ctx=canvas.getContext('2d'),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;if(!rect.width||!state.candles.length)return;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);const W=rect.width,H=rect.height,c=state.candles.slice(-100),pad={l:8,r:62,t:12,b:22},cw=W-pad.l-pad.r,ch=H-pad.t-pad.b;const min=Math.min(...c.map(x=>x.low)),max=Math.max(...c.map(x=>x.high)),range=max-min||1;const y=v=>pad.t+(max-v)/range*ch,x=i=>pad.l+(i+.5)*cw/c.length;ctx.clearRect(0,0,W,H);ctx.font='10px IBM Plex Sans Arabic';ctx.textAlign='left';ctx.fillStyle='#8090aa';for(let i=0;i<=4;i++){const val=max-range*i/4,yy=y(val);ctx.strokeStyle='#25334a';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillText(fmt(val,0),W-pad.r+6,yy+3);}const step=cw/c.length,body=Math.max(2,step*.62);c.forEach((v,i)=>{const up=v.close>=v.open,col=up?'#27d6a0':'#ff657a',xx=x(i);ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,y(v.high));ctx.lineTo(xx,y(v.low));ctx.stroke();const top=y(Math.max(v.open,v.close)),height=Math.max(1,Math.abs(y(v.open)-y(v.close)));ctx.fillRect(xx-body/2,top,body,height);});const full=state.candles.map(v=>v.close);[[20,'#e8b75a'],[50,'#6e9cff'],[200,'#d77be8']].forEach(([period,color])=>{if(full.length<period)return;const vals=ema(full,period).slice(-100);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();let started=false;vals.forEach((v,i)=>{if(v==null)return;const xx=x(i),yy=y(v);if(!started){ctx.moveTo(xx,yy);started=true;}else ctx.lineTo(xx,yy);});ctx.stroke();});}
function connectWS(){if(state.ws){state.ws.onclose=null;state.ws.close();}const stream=state.market==='futures'?'wss://fstream.binance.com/ws/btcusdt@ticker':'wss://stream.binance.com:9443/ws/btcusdt@ticker';try{const ws=new WebSocket(stream);state.ws=ws;ws.onopen=()=>setConnection('connected','البث المباشر يعمل');ws.onmessage=e=>{const t=JSON.parse(e.data);state.lastPrice=+t.c;setText('lastPrice',fmt(+t.c,2));const pct=+t.P;setText('priceChange',(pct>=0?'+':'')+fmt(pct,2)+'%');$('priceChange').classList.toggle('negative',pct<0);setText('lastUpdate','تحديث مباشر: '+new Date().toLocaleTimeString('ar'));setText('levelPrice',fmt(+t.c,2));updateRisk();if(state.candles.length)analyze();};ws.onerror=()=>setConnection('error','مشكلة في البث المباشر');ws.onclose=()=>{setConnection('error','إعادة الاتصال بالبث...');clearTimeout(state.reconnect);state.reconnect=setTimeout(connectWS,4000);};}catch(e){setConnection('error','البث غير متاح');}}
async function refreshAll(){if(state.busy)return;state.busy=true;try{await Promise.all([loadTicker(),loadCandles(),loadOrderBook(),loadFutures()]);}finally{state.busy=false;}}
function updateRisk(){
  const capital=Math.max(0,+$('capitalInput').value||0);
  const risk=Math.max(0,+$('riskInput').value||0);
  const stop=Math.max(.0001,+$('stopInput').value||0);
  const amount=capital*risk/100;
  const rawSize=amount/(stop/100);
  const size=Math.min(capital,rawSize);
  const qty=state.lastPrice>0?size/state.lastPrice:0;
  setText('riskAmount','$'+fmt(amount,2));
  setText('positionSize','$'+fmt(size,2));
  setText('riskQuantity',fmt(qty,6)+' BTC تقريبًا');
  setText('riskCapNote',rawSize>capital?'تم تحديد حجم المركز بسقف رأس المال المدخل.':'الحجم ضمن رأس المال المدخل.');
}
document.querySelectorAll('[data-market]').forEach(btn=>btn.addEventListener('click',()=>{if(state.market===btn.dataset.market)return;state.market=btn.dataset.market;document.querySelectorAll('[data-market]').forEach(b=>b.classList.toggle('active',b===btn));setText('marketLabel',state.market.toUpperCase());connectWS();refreshAll();}));
document.querySelectorAll('[data-interval]').forEach(btn=>btn.addEventListener('click',()=>{state.interval=btn.dataset.interval;document.querySelectorAll('[data-interval]').forEach(b=>b.classList.toggle('active',b===btn));loadCandles();}));
$('refreshBtn').addEventListener('click',refreshAll);
['capitalInput','riskInput','stopInput'].forEach(id=>$(id).addEventListener('input',updateRisk));
window.addEventListener('resize',()=>drawChart());
setText('footerTime',new Date().toLocaleDateString('ar'));
updateRisk();connectWS();refreshAll();
setInterval(()=>{loadTicker();loadOrderBook();loadFutures();},15000);
setInterval(()=>{if(!state.busy)loadCandles();},60000);
})();