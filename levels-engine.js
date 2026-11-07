(function(){
'use strict';
function atrOf(c){const a=c.slice(-15);if(!a.length)return 0;return a.reduce((s,x,i)=>{const p=i?a[i-1].close:x.open;return s+Math.max(x.high-x.low,Math.abs(x.high-p),Math.abs(x.low-p));},0)/a.length;}
function levelsFor(candles,price,tf,baseAtr){
 const c=(candles||[]).filter(x=>Number(x.closeTime)<Date.now()).slice(-240);
 if(c.length<25)return [];
 const atr=atrOf(c),tol=Math.max((baseAtr||atr)*.3,price*.0007);
 const pivots=[];
 for(let i=2;i<c.length-2;i++){
  for(const [key,high] of [['high',true],['low',false]]){
   const v=+c[i][key],w=c.slice(i-2,i+3).map(x=>+x[key]);
   if(v===(high?Math.max(...w):Math.min(...w))&&w.filter(x=>x===v).length===1)pivots.push({price:v,side:high?'resistance':'support',time:c[i].time,tf});
  }
 }
 const groups=[];
 pivots.sort((a,b)=>a.price-b.price).forEach(p=>{
  let g=groups.find(x=>x.side===p.side&&Math.abs(x.price-p.price)<=tol);
  if(!g){g={price:p.price,side:p.side,points:[],timeframes:[]};groups.push(g);}
  g.points.push(p);g.price=g.points.reduce((s,x)=>s+x.price,0)/g.points.length;
  if(!g.timeframes.includes(tf))g.timeframes.push(tf);
 });
 for(const g of groups){
  const hits=c.filter(x=>x.high>=g.price-tol*.55&&x.low<=g.price+tol*.55);
  g.touches=Math.max(g.points.length,new Set(hits.map(x=>Math.floor(x.time/(tf==='4h'?14400000:tf==='1h'?3600000:1)))).size);
  g.lower=g.price-tol*.45;g.upper=g.price+tol*.45;
  g.score=g.touches*(tf==='4h'?3:tf==='1h'?2:1);
  g.atr=atr;
 }
 return groups;
}
window.BTCRadarLevels={
 calculate:function(candles,price){const a=levelsFor(candles,price,'15m');return this.pack(a,price,atrOf((candles||[]).filter(x=>x.closeTime<Date.now()).slice(-240)));},
 calculateMulti:function(frames,price){
  const current=levelsFor(frames.current||[],price,'15m');
  const h1=levelsFor(frames.h1||[],price,'1h',atrOf(frames.current||[]));
  const h4=levelsFor(frames.h4||[],price,'4h',atrOf(frames.current||[]));
  const all=[...current,...h1,...h4],base=atrOf((frames.current||[]).filter(x=>x.closeTime<Date.now()).slice(-240));
  const tol=Math.max(base*.35,price*.0008),merged=[];
  all.sort((a,b)=>a.price-b.price).forEach(x=>{
   let g=merged.find(v=>v.side===x.side&&Math.abs(v.price-x.price)<=tol);
   if(!g){g={...x,timeframes:[...x.timeframes],sources:1};merged.push(g);}
   else{g.price=(g.price*g.sources+x.price)/(g.sources+1);g.sources++;g.touches=Math.max(g.touches,x.touches);g.score+=x.score;g.lower=Math.min(g.lower,x.lower);g.upper=Math.max(g.upper,x.upper);x.timeframes.forEach(t=>{if(!g.timeframes.includes(t))g.timeframes.push(t);});}
  });
  merged.forEach(g=>{g.lower=Math.min(g.lower,g.price-tol*.35);g.upper=Math.max(g.upper,g.price+tol*.35);g.strength=g.score>=9?'قوي':g.score>=4?'متوسط':'مراقبة';});
  return this.pack(merged,price,base);
 },
 pack:function(all,price,atr){
  const resistance=all.filter(x=>x.side==='resistance'&&x.price>price).sort((a,b)=>a.price-b.price).slice(0,4);
  const support=all.filter(x=>x.side==='support'&&x.price<price).sort((a,b)=>b.price-a.price).slice(0,4);
  return{resistance,support,all,atr,tolerance:Math.max(atr*.35,price*.0008),referencePrice:price};
 }
};
})();