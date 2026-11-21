"use client";
import { useEffect, useRef, useState } from "react";
import { binance } from "@/lib/market";
import Link from "next/link";
import { RotateCcw, ShoppingCart, TrendingDown } from "lucide-react";
import SmartChart from "../chart/page";
import BreakoutMonitorPage from "../breakout/page";

type Trade = { id:number; side:"buy"|"sell"; price:number; qty:number; total:number; fee:number; time:string; pnl?:number };
type Account = { cash:number; btc:number; averageEntry:number; realized:number; trades:Trade[] };
const START=10000, FEE=.001;
const money=(n:number,d=2)=>Number.isFinite(n)?n.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const blank=():Account=>({cash:START,btc:0,averageEntry:0,realized:0,trades:[]});

export default function PaperTradingPage(){
 const [price,setPrice]=useState(0),[change,setChange]=useState(0),[connected,setConnected]=useState(false);
 const [tab,setTab]=useState<"trading"|"analysis"|"breakout">("trading");
 const [account,setAccount]=useState<Account>(blank),[ready,setReady]=useState(false),[mode,setMode]=useState<"buy"|"sell">("buy"),[amount,setAmount]=useState("100"),[notice,setNotice]=useState("");
 const orderLock=useRef(false);
 useEffect(()=>{try{const saved=localStorage.getItem("btc-radar-paper-account-v1");if(saved){const p=JSON.parse(saved) as Account;if(Number.isFinite(p.cash)&&p.cash>=0&&Number.isFinite(p.btc)&&p.btc>=0&&Number.isFinite(p.averageEntry)&&p.averageEntry>=0&&Number.isFinite(p.realized)&&Array.isArray(p.trades))setAccount({...blank(),...p,trades:p.trades.filter((t:Trade)=>t&&Number.isFinite(t.price)&&Number.isFinite(t.qty)&&Number.isFinite(t.total)).slice(0,100)});}}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem("btc-radar-paper-account-v1",JSON.stringify(account));}catch{}},[account,ready]);
 useEffect(()=>{
  let stopped=false,socket:WebSocket|undefined,retry:ReturnType<typeof setTimeout>|undefined;
  const load=async()=>{try{const d=await binance<{lastPrice:string;priceChangePercent:string}>("spot","/api/v3/ticker/24hr?symbol=BTCUSDT");if(!stopped){setPrice(Number(d.lastPrice));setChange(Number(d.priceChangePercent));setConnected(true);}}catch{if(!stopped&&!socket)setConnected(false);}};
  void load();const timer=setInterval(load,15000);
  const connect=()=>{if(stopped)return;try{socket=new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@ticker");socket.onopen=()=>{if(!stopped)setConnected(true);};socket.onmessage=e=>{try{const d=JSON.parse(e.data);if(!stopped){setPrice(Number(d.c));setChange(Number(d.P));setConnected(true);}}catch{}};socket.onclose=()=>{if(!stopped){setConnected(false);retry=setTimeout(connect,4000);}};socket.onerror=()=>{if(!stopped)setConnected(false);};}catch{if(!stopped)setConnected(false);}};
  connect();return()=>{stopped=true;clearInterval(timer);if(retry)clearTimeout(retry);socket?.close();};
 },[]);
 const equity=account.cash+account.btc*price,positionValue=account.btc*price;
 const unrealized=account.btc>0&&price>0?(price-account.averageEntry)*account.btc:0,totalPnl=account.realized+unrealized;
 const execute=()=>{
  if(orderLock.current)return;orderLock.current=true;
  setNotice("");const value=Number(amount);
  if(!price||!Number.isFinite(value)||value<=0){setNotice("أدخل كمية صحيحة وانتظر تحميل السعر المباشر.");orderLock.current=false;return;}
  if(mode==="buy"){
   const fee=value*FEE;if(value+fee>account.cash){setNotice("رصيدك التجريبي لا يكفي لهذه العملية مع الرسوم.");orderLock.current=false;return;}
   const qty=value/price,nextQty=account.btc+qty,nextAverage=(account.btc*account.averageEntry+value+fee)/nextQty;
   const trade:Trade={id:Date.now(),side:"buy",price,qty,total:value,fee,time:new Date().toLocaleString("ar")};
   setAccount(old=>({...old,cash:old.cash-value-fee,btc:nextQty,averageEntry:nextAverage,trades:[trade,...old.trades].slice(0,100)}));
   setNotice("تم الشراء التجريبي. لم يتم إرسال أي أمر إلى Binance.");orderLock.current=false;
  }else{
   const qty=value;if(qty>account.btc+1e-12){setNotice("لا تملك هذه الكمية من BTC في محفظتك التجريبية.");orderLock.current=false;return;}
   const total=qty*price,fee=total*FEE,proceeds=total-fee,pnl=proceeds-qty*account.averageEntry,remaining=Math.max(0,account.btc-qty);
   const trade:Trade={id:Date.now(),side:"sell",price,qty,total,fee,pnl,time:new Date().toLocaleString("ar")};
   setAccount(old=>({...old,cash:old.cash+proceeds,btc:remaining,averageEntry:remaining<1e-12?0:old.averageEntry,realized:old.realized+pnl,trades:[trade,...old.trades].slice(0,100)}));
   setNotice("تم البيع التجريبي. نتيجة هذه العملية: "+money(pnl)+" USDT.");orderLock.current=false;
  }
 };
 const reset=()=>{if(window.confirm("هل تريد تصفير الحساب التجريبي وإلغاء سجل العمليات؟")){setAccount(blank());setAmount("100");setNotice("تمت إعادة الحساب إلى 10,000 USDT افتراضية.");}};
 return <main className="shell paper-shell">
  <header className="topbar"><Link className="brand" href="/"><span className="brand-icon">₿</span><span><b>BTC RADAR</b><small>منصة التداول والتدريب</small></span></Link><div className={"connection "+(connected?"online":"offline")}><i/>{connected?"السعر مباشر":"بانتظار السعر"}</div></header>
  <nav className="paper-main-tabs" aria-label="أقسام BTC RADAR">
   <button className={tab==="trading"?"active":""} onClick={()=>setTab("trading")}>التداول التجريبي</button>
   <button className={tab==="analysis"?"active":""} onClick={()=>setTab("analysis")}>تحليل السوق</button>
   <button className={tab==="breakout"?"active":""} onClick={()=>setTab("breakout")}>رادار الكسر</button>
  </nav>
  {tab==="analysis"?<div className="paper-embedded"><SmartChart/></div>:tab==="breakout"?<div className="paper-embedded"><BreakoutMonitorPage/></div>:<>
  <section className="hero"><div><div className="eyebrow">محاكاة تعليمية · بدون أموال حقيقية</div><h1>التداول التجريبي <span>BTCUSDT</span></h1><p>تدرّب على الشراء والبيع، وتابع كيف يتغير رصيدك وقيمة محفظتك مع حركة سعر البيتكوين.</p></div></section>
  <section className="panel paper-price"><div><span className="muted">سعر BTC الحالي · USDT</span><strong>{price?money(price):"جاري تحميل السعر..."}</strong><small className={change>=0?"positive":"negative"}>{price?(change>=0?"+":"")+money(change)+"% خلال 24 ساعة":"—"}</small></div><div className="paper-price-side"><span className="muted">السعر يتحدث تلقائيًا</span><b className={change>=0?"positive":"negative"}>{change>=0?"▲":"▼"} {money(Math.abs(change))}%</b></div></section>
  <section className="paper-account-grid">
   <article className="panel paper-balance"><span className="muted">قيمة الحساب التجريبي</span><strong>{money(equity)} <small>USDT</small></strong><span className={"paper-pnl "+(totalPnl>=0?"positive":"negative")}>{totalPnl>=0?"+":""}{money(totalPnl)} USDT إجمالي الربح/الخسارة</span><div className="paper-balance-foot"><span>الرصيد النقدي<b>{money(account.cash)}</b></span><span>قيمة BTC<b>{money(positionValue)}</b></span></div></article>
   <article className="panel paper-stat"><span className="muted">البيتكوين الذي تملكه</span><strong>{money(account.btc,8)} <small>BTC</small></strong><span className="muted">متوسط الشراء: {account.averageEntry?money(account.averageEntry):"—"}</span></article>
   <article className="panel paper-stat"><span className="muted">الربح/الخسارة غير المحققة</span><strong className={unrealized>=0?"positive":"negative"}>{unrealized>=0?"+":""}{money(unrealized)}</strong><span className="muted">تتغير مع السعر حتى تبيع</span></article>
   <article className="panel paper-stat"><span className="muted">الربح/الخسارة المحققة</span><strong className={account.realized>=0?"positive":"negative"}>{account.realized>=0?"+":""}{money(account.realized)}</strong><span className="muted">نتيجة عمليات البيع السابقة</span></article>
  </section>
  <section className="panel paper-trade-panel"><div className="section-head"><div><h2>نفّذ صفقة تدريبية</h2><p className="muted">رسوم افتراضية 0.10% لكل عملية</p></div><span className="paper-demo-tag">تجريبي فقط</span></div>
   <div className="paper-tabs"><button className={mode==="buy"?"buy-active":""} onClick={()=>{setMode("buy");setNotice("");}}><ShoppingCart size={16}/> شراء BTC</button><button className={mode==="sell"?"sell-active":""} onClick={()=>{setMode("sell");setNotice("");}}><TrendingDown size={16}/> بيع BTC</button></div>
   <label className="paper-label">{mode==="buy"?"المبلغ الذي تريد الشراء به (USDT)":"كمية BTC التي تريد بيعها"}</label>
   <div className="paper-input-row"><input type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={mode==="buy"?"مثال: 100":"مثال: 0.001"}/><span>{mode==="buy"?"USDT":"BTC"}</span></div>
   {mode==="buy"?<div className="paper-quick"><button onClick={()=>setAmount("100")}>100 USDT</button><button onClick={()=>setAmount("500")}>500 USDT</button><button onClick={()=>setAmount("1000")}>1,000 USDT</button><button onClick={()=>setAmount(String(Math.max(0,account.cash/(1+FEE)).toFixed(2)))}>استخدم المتاح</button></div>:<div className="paper-quick"><button onClick={()=>setAmount((account.btc*.25).toFixed(8))}>25%</button><button onClick={()=>setAmount((account.btc*.5).toFixed(8))}>50%</button><button onClick={()=>setAmount(account.btc.toFixed(8))}>بيع الكل</button></div>}
   <div className="paper-estimate"><span>السعر الحالي<b>{price?money(price):"—"} USDT</b></span><span>{mode==="buy"?"الكمية التقديرية":"قيمة البيع التقديرية"}<b>{price&&Number(amount)>0?(mode==="buy"?money(Number(amount)/price,8)+" BTC":money(Number(amount)*price)+" USDT"):"—"}</b></span><span>الرسوم التقديرية<b>{price&&Number(amount)>0?money((mode==="buy"?Number(amount):Number(amount)*price)*FEE)+" USDT":"—"}</b></span></div>
   <button className={"paper-submit "+mode} onClick={execute} disabled={!ready||!price}>{mode==="buy"?"شراء تجريبي الآن":"بيع تجريبي الآن"}</button>{notice&&<p className="paper-notice">{notice}</p>}
   <p className="paper-disclaimer">لا يوجد اتصال بحساب Binance ولا تُرسل أوامر حقيقية. المحاكاة تستخدم السعر المتاح وقت الضغط؛ وقد يختلف التنفيذ الحقيقي بسبب الانزلاق السعري والرسوم.</p>
  </section>
  <section className="panel paper-history"><div className="section-head"><div><h2>سجل صفقاتك</h2><p className="muted">آخر 100 عملية شراء وبيع تجريبية</p></div><button className="clear-btn" onClick={reset}><RotateCcw size={14}/> إعادة ضبط الحساب</button></div>
   {account.trades.length?<div className="paper-table-wrap"><table className="paper-table"><thead><tr><th>العملية</th><th>السعر</th><th>الكمية BTC</th><th>الإجمالي</th><th>الرسوم</th><th>النتيجة</th><th>الوقت</th></tr></thead><tbody>{account.trades.map(t=><tr key={t.id}><td><b className={t.side==="buy"?"positive":"negative"}>{t.side==="buy"?"شراء":"بيع"}</b></td><td>{money(t.price)}</td><td>{money(t.qty,8)}</td><td>{money(t.total)}</td><td>{money(t.fee)}</td><td className={t.pnl===undefined?"":t.pnl>=0?"positive":"negative"}>{t.pnl===undefined?"—":(t.pnl>=0?"+":"")+money(t.pnl)}</td><td>{t.time}</td></tr>)}</tbody></table></div>:<div className="paper-empty">لم تنفذ أي صفقة بعد. ابدأ بشراء كمية صغيرة للتعلم، ثم تابع كيف تتغير قيمة محفظتك مع السعر.</div>}
  </section>
  <footer><span>BTC RADAR · التداول التجريبي</span><span>الرصيد الابتدائي {money(START)} USDT</span><span>لا توجد أموال حقيقية</span></footer>
 </>}
 </main>;
}
