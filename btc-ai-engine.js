(() => {
'use strict';

const clamp=(v,min=0,max=1)=>Math.min(max,Math.max(min,v));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const sigmoid=x=>1/(1+Math.exp(-clamp(x,-20,20)));
const valid=n=>Number.isFinite(n);
let REAL_WEIGHTS = null;
const WEIGHTS_READY = fetch('./btc-weights.json', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  })
  .then(data => {
    if (!data || data.symbol !== 'BTCUSDT' || data.timeframe !== '15m' ||
        !data.weights || typeof data.weights !== 'object') {
      throw new Error('ملف الأوزان لا يطابق BTCUSDT / 15m');
    }
    REAL_WEIGHTS = data;
    console.info('BTC AI: تم تحميل أوزان BTCUSDT المدربة من btc-weights.json');
    return REAL_WEIGHTS;
  })
  .catch(error => {
    REAL_WEIGHTS = null;
    console.warn('BTC AI: تعذر تحميل الأوزان المدربة؛ سيتم استخدام القواعد التقديرية مؤقتاً.', error);
    return null;
  });

const closesOf=c=>c.map(x=>Number(x.close));
function ema(values,period){
  if(values.length<period)return null;
  const k=2/(period+1);let v=mean(values.slice(0,period));
  for(let i=period;i<values.length;i++)v=values[i]*k+v*(1-k);
  return v;
}
function rsi(values,period=14){
  if(values.length<=period)return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  let ag=gain/period,al=loss/period;
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(period-1)+Math.max(d,0))/period;al=(al*(period-1)+Math.max(-d,0))/period;}
  return al===0?100:100-100/(1+ag/al);
}
function atr(candles,period=14){
  if(candles.length<period+1)return null;
  const tr=[];
  for(let i=1;i<candles.length;i++){const x=candles[i],p=candles[i-1].close;tr.push(Math.max(x.high-x.low,Math.abs(x.high-p),Math.abs(x.low-p)));}
  return mean(tr.slice(-period));
}
function buildFeatures(candles){
  if(!Array.isArray(candles)||candles.length<205)throw new Error('يلزم توفر 205 شموع 15m على الأقل لحساب EMA 200 بصورة مستقرة.');
  const c=candles.filter(x=>[x.time,x.open,x.high,x.low,x.close,x.volume].every(v=>valid(Number(v)))).map(x=>({...x,time:Number(x.time),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume)}));
  if(c.length<205)throw new Error('عدد الشموع الصالحة غير كافٍ.');
  const closes=closesOf(c),last=c[c.length-1],prev=c[c.length-2];
  const e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200);
  const fast=ema(closes,12),slow=ema(closes,26),macd=fast-slow;
  const signalSeries=[];
  for(let i=25;i<closes.length;i++)signalSeries.push(ema(closes.slice(0,i+1),12)-ema(closes.slice(0,i+1),26));
  const macdSignal=ema(signalSeries,9),macdHist=macdSignal===null?null:macd-macdSignal;
  const window=closes.slice(-20),bbMid=mean(window),bbStd=Math.sqrt(mean(window.map(v=>(v-bbMid)**2)));
  const avgVol=mean(c.slice(-21,-1).map(x=>x.volume));
  const now=new Date(last.time),hour=now.getUTCHours();
  const session=hour>=0&&hour<7?'آسيا':hour>=7&&hour<13?'لندن':hour>=13&&hour<21?'نيويورك':'انتقالية';
  const ret=n=>closes.length>n?last.close/closes[closes.length-1-n]-1:null;
  return {
    price:last.close,rsi14:rsi(closes,14),macd,macdSignal,macdHistogram:macdHist,
    ema20:e20,ema50:e50,ema200:e200,
    bollinger:{upper:bbMid+2*bbStd,middle:bbMid,lower:bbMid-2*bbStd,width:bbMid?(4*bbStd/bbMid):null},
    atr14:atr(c,14),volumeRatio:avgVol?last.volume/avgVol:null,
    returns:{ret5:ret(5),ret10:ret(10),ret20:ret(20)},
    session,candleTime:last.time, candleCount:c.length,
    trend:{aboveEma20:last.close>e20,aboveEma50:last.close>e50,aboveEma200:last.close>e200},
    candle:{body:last.close-last.open,range:last.high-last.low,previousClose:prev.close}
  };
}

// Lightweight interpretable proxies; these are NOT trained LightGBM/CatBoost/LSTM models.
function model_LGBM(f){
  let s=0;
  if(f.price>f.ema20)s+=.16;if(f.ema20>f.ema50)s+=.18;if(f.ema50>f.ema200)s+=.14;
  if(f.rsi14>55)s+=.12;else if(f.rsi14<45)s-=.12;
  if(f.macdHistogram>0)s+=.12;else if(f.macdHistogram<0)s-=.10;
  if(f.returns.ret5>0)s+=.08;if(f.returns.ret20>0)s+=.10;
  if(f.volumeRatio>1.2&&f.candle.body>0)s+=.08;
  return clamp(.5+s*.9);
}
function model_CatBoost(f){
  const trend=(f.price>f.ema20?1:-1)+(f.ema20>f.ema50?1:-1)+(f.ema50>f.ema200?1:-1);
  const momentum=(f.rsi14-50)/50;
  const macd=f.macdHistogram/(f.atr14||1);
  const volume=clamp((f.volumeRatio||1)/2,0,1)-.5;
  const ret=(f.returns.ret5*100||0)*.025+(f.returns.ret20*100||0)*.012;
  return clamp(sigmoid(trend*.42+momentum*.8+macd*.7+volume*.18+ret));
}
function model_LSTM(f){
  // Small recurrent momentum state (a transparent proxy, not a trained neural network).
  const seq=[f.returns.ret5,f.returns.ret10,f.returns.ret20].map(v=>clamp((v||0)*35,-1,1));
  let h=0;for(const x of seq)h=Math.tanh(.62*h+.58*x);
  const trend=(f.price>f.ema20?1:-1)*.22+(f.ema20>f.ema50?1:-1)*.18;
  const rsi=(f.rsi14-50)/50*.24;
  return clamp(sigmoid(h*.9+trend+rsi+(f.macdHistogram>0?.12:-.12)));
}
function randomNormal(){const u=Math.max(Math.random(),1e-12),v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function monteCarlo(price,atrValue){
  if(!(price>0)||!(atrValue>0))return{upProbability:0.5,downProbability:0.5,median:price,simulations:0,horizon:12};
  const n=1000,horizon=12,terminal=[];
  for(let i=0;i<n;i++){let p=price;for(let j=0;j<horizon;j++)p*=Math.exp((-0.5*Math.pow(atrValue/price,2))+randomNormal()*(atrValue/price));terminal.push(p);}
  terminal.sort((a,b)=>a-b);
  const up=terminal.filter(v=>v>price).length;
  return{upProbability:up/n,downProbability:1-up/n,median:terminal[Math.floor(n/2)],p10:terminal[Math.floor(n*.1)],p90:terminal[Math.floor(n*.9)],simulations:n,horizon};
}
function kelly(winRate){
  const p=clamp(Number(winRate)||0),b=1;
  const full=Math.max(0,(b*p-(1-p))/b);
  return Math.min(.02,full*.5);
}
function weightedRealEnsemble(f){
  if(!REAL_WEIGHTS?.weights)return null;
  const raw={
    rsi_14:(f.rsi14-50)/50,
    macd:f.macd/(f.price||1),
    macd_hist:f.macdHistogram/(f.price||1),
    dist_ema_20:f.price/f.ema20-1,
    dist_ema_50:f.price/f.ema50-1,
    dist_ema_200:f.price/f.ema200-1,
    bb_pos:(f.price-f.bollinger.lower)/Math.max(1e-12,f.bollinger.upper-f.bollinger.lower),
    atr_pct:f.atr14/(f.price||1),
    ret_1:f.returns.ret1||0,
    ret_5:f.returns.ret5||0,
    ret_10:f.returns.ret10||0,
    ret_20:f.returns.ret20||0,
    vol_ratio:f.volumeRatio||1,
    is_london:f.session==='لندن'?1:0,
    is_ny:f.session==='نيويورك'?1:0,
    is_asia:f.session==='آسيا'?1:0
  };
  const stats=REAL_WEIGHTS.feature_stats||{};
  let total=0,used=0;
  for(const [name,weightValue] of Object.entries(REAL_WEIGHTS.weights)){
    const weight=Number(weightValue),value=Number(raw[name]);
    if(!Number.isFinite(weight)||!Number.isFinite(value))continue;
    let directional=value;
    if(name==='bb_pos')directional=value-.5;
    else if(name==='vol_ratio')directional=(value-1)*(f.candle.body>=0?1:-1);
    else if(name==='atr_pct'||name.startsWith('is_'))directional=0;
    const stat=stats[name];
    const z=stat&&Number(stat.std)>0?(directional-Number(stat.mean||0))/Number(stat.std):directional;
    total+=weight*Math.tanh(clamp(z,-5,5)/2);
    used+=weight;
  }
  if(!used)return null;
  return clamp(sigmoid(2.2*(total/used-.0)));
}
function analyze(candles,capital=10000){
  const f=buildFeatures(candles);
  const lgbm=model_LGBM(f),cat=model_CatBoost(f),lstm=model_LSTM(f);
  const realEnsemble=weightedRealEnsemble(f);\n  const ensemble=realEnsemble===null?lgbm*.35+cat*.35+lstm*.30:realEnsemble;
  const mc=monteCarlo(f.price,f.atr14||f.price*.001);
  const winRate=clamp(.5+(ensemble-.5)*.75);
  const kellyFraction=kelly(winRate);
  const decision=ensemble>.70&&mc.upProbability>.60?'BUY':'WAIT';
  return{decision,ensemble,models:{LGBM:lgbm,CatBoost:cat,LSTM:lstm},monteCarlo:mc,kelly:{winRate,fraction:kellyFraction,percent:kellyFraction*100,capitalRisk:Math.max(0,Number(capital)||0)*kellyFraction},features:f,capital:Number(capital)||0,modelType:realEnsemble===null?'heuristic-proxy':'trained-feature-weights',weightsSource:realEnsemble===null?'تقديرية':'مدربة حقيقية',timestamp:Date.now()};
}
function renderCard(result,targetId){
  const el=document.getElementById(targetId);if(!el||!result)return;
  if(!document.getElementById('btc-ai-engine-style')){
    const style=document.createElement('style');style.id='btc-ai-engine-style';style.textContent=`
      #ai-engine-card{direction:rtl;text-align:right;margin:0 0 18px;font-family:inherit}
      #ai-engine-card .ai-card{background:#fff;border:1px solid #dce3ed;border-radius:18px;padding:18px;box-shadow:0 8px 26px #2538580b;color:#172033}
      #ai-engine-card .ai-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}
      #ai-engine-card .ai-head h2{font-size:16px;margin:0}#ai-engine-card .ai-tag{font-size:10px;color:#526783;background:#edf2f8;border-radius:7px;padding:5px 8px}
      #ai-engine-card .ai-decision{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px;border-radius:12px;background:#f3f6fb;margin-bottom:12px}
      #ai-engine-card .ai-decision strong{font-size:22px;letter-spacing:.4px}#ai-engine-card .ai-decision small{display:block;color:#68758a;font-size:10px;margin-top:4px}
      #ai-engine-card .ai-buy{color:#07845f}#ai-engine-card .ai-wait{color:#946316}
      #ai-engine-card .ai-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
      #ai-engine-card .ai-metric{background:#f5f7fb;border:1px solid #e6ebf2;border-radius:10px;padding:10px;min-width:0}
      #ai-engine-card .ai-metric span{display:block;color:#68758a;font-size:10px;margin-bottom:6px}#ai-engine-card .ai-metric b{font-size:14px;direction:ltr;display:block;overflow-wrap:anywhere}
      #ai-engine-card .ai-foot{font-size:10px;color:#68758a;line-height:1.8;margin:12px 0 0}
      @media(max-width:560px){#ai-engine-card .ai-card{padding:14px}#ai-engine-card .ai-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#ai-engine-card .ai-decision strong{font-size:19px}}
    `;document.head.appendChild(style);
  }
  const f=result.features,pc=n=>(n*100).toFixed(1)+'%',money=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});
  const buy=result.decision==='BUY';
  el.innerHTML=`<article class="ai-card">
    <div class="ai-head"><h2>محرك التحليل الكمي · AI ENGINE</h2><span class="ai-tag">BTCUSDT · 15m</span></div>
    <div class="ai-decision"><div><strong class="${buy?'ai-buy':'ai-wait'}">${buy?'BUY · شراء':'WAIT · انتظار'}</strong><small>قرار احتمالي — لا ينفذ أوامر تداول</small></div><div><b>${pc(result.ensemble)}</b><small>درجة توافق النماذج</small></div></div>
    <div class="ai-grid">
      <div class="ai-metric"><span>Monte Carlo · احتمال الصعود</span><b>${pc(result.monteCarlo.upProbability)}</b></div>
      <div class="ai-metric"><span>Kelly · نصف Kelly</span><b>${result.kelly.percent.toFixed(2)}%</b></div>
      <div class="ai-metric"><span>RSI 14</span><b>${f.rsi14.toFixed(1)}</b></div>
      <div class="ai-metric"><span>MACD Histogram</span><b>${f.macdHistogram.toFixed(2)}</b></div>
      <div class="ai-metric"><span>Volume Ratio</span><b>${f.volumeRatio===null?'—':f.volumeRatio.toFixed(2)+'x'}</b></div>
      <div class="ai-metric"><span>ATR 14</span><b>${money(f.atr14)}</b></div>
      <div class="ai-metric"><span>EMA 20 / 50 / 200</span><b>${money(f.ema20)} / ${money(f.ema50)} / ${money(f.ema200)}</b></div>
      <div class="ai-metric"><span>الجلسة الحالية</span><b>${f.session}</b></div>
      <div class="ai-metric"><span>قيمة المخاطرة النظرية</span><b>${money(result.kelly.capitalRisk)} USDT</b></div>
    </div>
    <p class="ai-foot">الأوزان: ${result.weightsSource||'تقديرية'}. محاكاة Monte Carlo: ${result.monteCarlo.simulations} مسارًا × ${result.monteCarlo.horizon} خطوة. أوزان الميزات مستخرجة من تدريب LightGBM وCatBoost؛ لا تتضمن حزمة المتصفح ملفات النموذج الأصلية. للتعليم فقط، ليست توصية استثمارية.</p>
  </article>`;
}
window.BTC_AI={buildFeatures,model_LGBM,model_CatBoost,model_LSTM,monteCarlo,kelly,analyze,renderCard,ready:WEIGHTS_READY,get weights(){return REAL_WEIGHTS;}};
})();