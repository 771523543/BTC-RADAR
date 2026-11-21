"use client";
import { useEffect, useRef, useState } from "react";
import { binance } from "@/lib/market";
import { RotateCcw, ShoppingCart, TrendingDown } from "lucide-react";

type Trade={id:number;side:"buy"|"sell";price:number;qty:number;total:number;fee:number;time:string;pnl?:number};
type Account={cash:number;btc:number;averageEntry:number;realized:number;trades:Trade[]};
const START=10000,FEE=.001;
const money=(n:number,d=2)=>Number.isFinite(n)?n.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const blank=():Account=>({cash:START,btc:0,averageEntry:0,realized:0,trades:[]});

export default function PaperTradingPage(){
 const [price,setPrice]=useState(0),[connected,setConnected]=useState(false);
 const [account,setAccount]=useState<Account>(blank),[ready,setReady]=useState(false);
 const [mode,setMode]=useState<"buy"|"sell">("buy"),[amount,setAmount]=useState("100"),[notice,setNotice]=useState("");
 const orderLock=useRef(false);
 useEffect(()=>{try{const saved=localStorage.getItem("btc-radar-paper-account-v1");if(saved){const p=JSON.parse(saved) as Account;if(Number.isFinite(p.cash)&&p.cash>=0&&Number.isFinite(p.btc)&&p.btc>=0&&Number.isFinite(p.averageEntry)&&p.averageEntry>=0&&Number.isFinite(p.realized)&&Array.isArray(p.trades))setAccount({...blank(),...p,trades:p.trades.filter((t:Trade)=>t&&Number.isFinite(t.price)&&Number.isFinite(t.qty)&&Number.isFinite(t.total)).slice(0,100)});}}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem("btc-radar-paper-account-v1",JSON.stringify(account));}catch{}},[account,ready]);
 useEffect(()=>{let stopped=false,socket:WebSocket|undefined,retry:ReturnType<typeof setTimeout>|undefined;const load=async()=>{try{const d=await binance<{lastPrice:string}>( "spot","/api/v3/ticker/price?symbol=BTCUSDT");if(!stopped){setPrice(Number(d.lastPrice));setConnected(true);}}catch{if(!stopped&&!socket)setConnected(false);}};void load();const timer=setInterval(load,15000);const connect=()=>{if(stopped)return;try{socket=new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@ticker");socket.onopen=()=>{if(!stopped)setConnected(true);};socket.onmessage=e=>{try{const d=JSON.parse(e.data);if(!stopped){setPrice(Number(d.c));setConnected(true);}}catch{}};socket.onclose=()=>{if(!stopped){setConnected(false);retry=setTimeout(connect,4000);}};socket.onerror=()=>{if(!stopped)setConnected(false);};}catch{if(!stopped)setConnected(false);}};connect();return()=>{stopped=true;clearInterval(timer);if(retry)clearTimeout(retry);socket?.close();};},[]);
 const equity=account.cash+account.btc*price,positionValue=account.btc*price;
 const unrealized=account.btc>0&&price>0?(price-account.averageEntry)*account.btc:0,totalPnl=account.realized+unrealized;
 const execute=()=>{if(orderLock.current)return;orderLock.current=true;setNotice("");const value=Number(amount);if(!price||!Number.isFinite(value)||value<=0){setNotice("أدخل كمية صحيحة وانتظر السعر المباشر.");orderLock.current=false;return;}if(mode==="buy"){const fee=value*FEE;if(value+fee>account.cash){setNotice("الرصيد التجريبي لا يكفي مع الرسوم.");orderLock.current=false;return;}const qty=value/price,nextQty=account.btc+qty,nextAverage=(account.btc*account.averageEntry+value+fee)/nextQty;const trade:Trade={id:Date.now(),side:"buy",price,qty,total:value,fee,time:new Date().toLocaleString("ar")};setAccount(old=>({...old,cash:old.cash-value-fee,btc:nextQty,averageEntry:nextAverage,trades:[trade,...old.trades].slice(0,100)}));setNotice("تم الشراء التجريبي فقط؛ لم يُرسل أي أمر إلى Binance.");}else{const qty=value;if(qty>account.btc+1e-12){setNotice("كمية البيع أكبر من رصيد BTC الذي تملكه.");orderLock.current=false;return;}const total=qty*price,fee=total*FEE,proceeds=total-fee,pnl=proceeds-qty*account.averageEntry,remaining=Math.max(0,account.btc-qty);const trade:Trade={id:Date.now(),side:"sell",price,qty,total,fee,pnl,time:new Date().toLocaleString("ar")};setAccount(old=>({...old,cash:old.cash+proceeds,btc:remaining,averageEntry:remaining<1e-12?0:old.averageEntry,realized:old.realized+pnl,trades:[trade,...old.trades].slice(0,100)}));setNotice("تم البيع التجريبي. نتيجة العملية: "+money(pnl)+" USDT.");}orderLock.current=false;};
 const reset=()=>{if(window.confirm("هل تريد تصفير الحساب التجريبي وحذف سجل الصفقات؟")){setAccount(blank());setAmount("100");setNotice("عاد الحساب إلى 10,000 USDT افتراضية.");}};
 return <main className="shell paper-only">
  <section className="paper-section-head"><div><div className="eyebrow">محاكاة تعليمية · لا أموال حقيقية</div><h2>التداول التجريبي</h2><p>طبّق ما تعلمته من التحليل على شراء وبيع افتراضيين، وتابع أثر حركة السعر على رصيدك.</p></div><span className={"paper-live "+(connected?"online":"")}>{connected?"السعر متصل":"بانتظار السعر"}</span></section>
  <section className="paper-live-price panel"><div><span>سعر البيتكوين المباشر · BTC/USDT</span><strong>{price?money(price)+" USDT":"جارٍ تحميل السعر..."}</strong></div><span className={"paper-live "+(connected?"online":"")}>{connected?"● متصل الآن":"○ غير متصل"}</span></section>
  <section className="paper-account-grid">
   <article className="panel paper-balance"><span className="muted">إجمالي قيمة الحساب</span><strong>{money(equity)} <small>USDT</small></strong><span className={"paper-pnl "+(totalPnl>=0?"positive":"negative")}>{totalPnl>=0?"+":""}{money(totalPnl)} USDT · الربح/الخسارة الكلي</span></article>
   <article className="panel paper-stat"><span className="muted">الرصيد النقدي</span><strong>{money(account.cash)} <small>USDT</small></strong></article>
   <article className="panel paper-stat"><span className="muted">قيمة BTC</span><strong>{money(positionValue)} <small>USDT</small></strong><span className="muted">{money(account.btc,8)} BTC</span></article>
   <article className="panel paper-stat"><span className="muted">غير المحقق</span><strong className={unrealized>=0?"positive":"negative"}>{unrealized>=0?"+":""}{money(unrealized)}</strong><span className="muted">يتغير مع السعر</span></article>
   <article className="panel paper-stat"><span className="muted">المحقق من البيع</span><strong className={account.realized>=0?"positive":"negative"}>{account.realized>=0?"+":""}{money(account.realized)}</strong></article>
  </section>
  <section className="panel paper-trade-panel"><div className="section-head"><div><h3>تنفيذ صفقة تدريبية</h3><p className="muted">السعر الحالي: {price?money(price)+" USDT":"جارٍ التحميل"} · رسوم المحاكاة 0.10%</p></div><span className="paper-demo-tag">تجريبي فقط</span></div>
   <div className="paper-tabs"><button className={mode==="buy"?"buy-active":""} onClick={()=>{setMode("buy");setNotice("");}}><ShoppingCart size={16}/> شراء BTC</button><button className={mode==="sell"?"sell-active":""} onClick={()=>{setMode("sell");setNotice("");}}><TrendingDown size={16}/> بيع BTC</button></div>
   <label className="paper-label">{mode==="buy"?"المبلغ بالـ USDT":"كمية BTC المراد بيعها"}</label><div className="paper-input-row"><input type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/><span>{mode==="buy"?"USDT":"BTC"}</span></div>
   <div className="paper-quick">{mode==="buy"?<><button onClick={()=>setAmount("100")}>100</button><button onClick={()=>setAmount("500")}>500</button><button onClick={()=>setAmount("1000")}>1,000</button><button onClick={()=>setAmount(String(Math.max(0,account.cash/(1+FEE)).toFixed(2)))}>استخدم المتاح</button></>:<><button onClick={()=>setAmount((account.btc*.25).toFixed(8))}>25%</button><button onClick={()=>setAmount((account.btc*.5).toFixed(8))}>50%</button><button onClick={()=>setAmount(account.btc.toFixed(8))}>بيع الكل</button></>}</div>
   <div className="paper-estimate"><span>الكمية/القيمة التقديرية<b>{price&&Number(amount)>0?(mode==="buy"?money(Number(amount)/price,8)+" BTC":money(Number(amount)*price)+" USDT"):"—"}</b></span><span>الرسوم التقديرية<b>{price&&Number(amount)>0?money((mode==="buy"?Number(amount):Number(amount)*price)*FEE)+" USDT":"—"}</b></span><span>متوسط الشراء<b>{account.averageEntry?money(account.averageEntry)+" USDT":"—"}</b></span></div>
   <button className={"paper-submit "+mode} onClick={execute} disabled={!ready||!price}>{mode==="buy"?"شراء تجريبي":"بيع تجريبي"}</button>{notice&&<p className="paper-notice">{notice}</p>}<p className="paper-disclaimer">المحاكاة لا تتصل بحساب Binance ولا تنفذ صفقات حقيقية. قد يختلف سعر التنفيذ الفعلي عن السعر المعروض.</p>
  </section>
  <section className="panel paper-history"><div className="section-head"><div><h3>آخر الصفقات</h3><p className="muted">يحفظ الحساب على هذا الجهاز والمتصفح</p></div><button className="clear-btn" onClick={reset}><RotateCcw size={14}/> إعادة ضبط الحساب</button></div>
   {account.trades.length?<div className="paper-table-wrap"><table className="paper-table"><thead><tr><th>العملية</th><th>السعر</th><th>الكمية BTC</th><th>الإجمالي</th><th>الرسوم</th><th>النتيجة</th></tr></thead><tbody>{account.trades.map(t=><tr key={t.id}><td><b className={t.side==="buy"?"positive":"negative"}>{t.side==="buy"?"شراء":"بيع"}</b></td><td>{money(t.price)}</td><td>{money(t.qty,8)}</td><td>{money(t.total)}</td><td>{money(t.fee)}</td><td className={t.pnl===undefined?"":t.pnl>=0?"positive":"negative"}>{t.pnl===undefined?"—":(t.pnl>=0?"+":"")+money(t.pnl)}</td></tr>)}</tbody></table></div>:<div className="paper-empty">لم تنفذ أي صفقة بعد. ابدأ بكمية صغيرة للتدرب.</div>}
  <section className="panel candle-learning" aria-labelledby="candle-learning-title">
   <div className="candle-learning-head"><div><span className="eyebrow">دليل تعليمي للمبتدئ</span><h3 id="candle-learning-title">تعلم قراءة الشموع اليابانية</h3><p className="muted">اقرأ سلوك السعر خلال الفترة: من افتتح، وإلى أين وصل، ومن أغلق أقوى؛ المشترون أم البائعون.</p></div><span className="candle-learning-tag">تعلم خطوة بخطوة</span></div>
   <div className="candle-lesson">
    <h4>1) افهم أجزاء الشمعة</h4>
    <div className="candle-parts">
     <div className="candle-part-visual"><span className="wick"></span><span className="body"></span><span className="wick lower"></span></div>
     <ul><li><b>الجسم:</b> المسافة بين سعر الافتتاح والإغلاق.</li><li><b>الفتيل العلوي:</b> أعلى سعر وصل إليه السعر خلال الفترة.</li><li><b>الفتيل السفلي:</b> أدنى سعر وصل إليه السعر خلال الفترة.</li><li><b>شمعة صاعدة:</b> الإغلاق أعلى من الافتتاح.</li><li><b>شمعة هابطة:</b> الإغلاق أقل من الافتتاح.</li></ul>
    </div>
    <div className="candle-example"><b>مثال افتراضي:</b> إذا افتتح BTC عند 100 ثم أغلق عند 105، فهذا جسم صاعد بمقدار 5. وإذا وصل خلال الفترة إلى 108 ثم هبط إلى 98، فالفتائل تكشف أن السعر رُفض قرب 108 وأن المشترين دافعوا قرب 98.</div>
   </div>
   <div className="candle-lesson"><h4>2) اقرأ المعنى، وليس اللون فقط</h4>
    <div className="candle-meaning-grid">
     <div><b>جسم كبير صاعد</b><span>ضغط شراء قوي خلال تلك الفترة.</span></div><div><b>جسم كبير هابط</b><span>ضغط بيع قوي.</span></div>
     <div><b>فتيل علوي طويل</b><span>السعر حاول الصعود ثم واجه بيعًا أو جني أرباح.</span></div><div><b>فتيل سفلي طويل</b><span>السعر هبط ثم ظهر طلب ودفعه للأعلى.</span></div>
     <div><b>جسم صغير</b><span>تردد؛ لا يعني انعكاسًا وحده.</span></div>
    </div>
   </div>
   <div className="candle-lesson"><h4>3) نماذج مهمة للمبتدئ</h4>
    <div className="candle-pattern-list">
     <div><b>الدوجي</b><span>جسم صغير جدًا؛ توازن مؤقت بين المشترين والبائعين.</span></div>
     <div><b>المطرقة</b><span>جسم صغير وفتيل سفلي طويل بعد هبوط؛ قد يشير إلى رفض الأسعار المنخفضة، ويحتاج تأكيدًا.</span></div>
     <div><b>الشهاب</b><span>جسم صغير وفتيل علوي طويل بعد صعود؛ قد يشير إلى رفض الأسعار المرتفعة، ويحتاج تأكيدًا.</span></div>
     <div><b>الابتلاع الصاعد/الهابط</b><span>شمعة كبيرة تغطي جسم الشمعة السابقة؛ تكون دلالتها أقوى قرب دعم أو مقاومة ومع حجم تداول ملحوظ.</span></div>
    </div>
   </div>
   <div className="candle-lesson"><h4>4) ترتيب عملي لقراءة الشارت</h4>
    <ol className="candle-steps">
     <li>ابدأ بإطار زمني أكبر مثل 4 ساعات أو يومي لمعرفة الاتجاه العام.</li>
     <li>حدد مناطق الدعم: مناطق ظهر فيها طلب سابقًا.</li>
     <li>حدد مناطق المقاومة: مناطق ظهر فيها عرض أو بيع سابقًا.</li>
     <li>انتقل لإطار أصغر لرؤية الشموع عند هذه المناطق.</li>
     <li>انتظر إغلاق الشمعة والتأكيد بدل اتخاذ قرار أثناء تكوّنها.</li>
     <li>راقب حجم التداول: الحركة المدعومة بحجم أعلى تكون عادةً أكثر أهمية من حركة ضعيفة الحجم.</li>
    </ol>
   </div>
   <p className="candle-learning-note">ملاحظة: نماذج الشموع احتمالات وليست ضمانًا لاتجاه السعر. اربط قراءتها بالاتجاه ومناطق الدعم والمقاومة وحجم التداول، وانتظر إغلاق الشمعة للتأكيد.</p>
  </section>
  </section><footer><span>BTC RADAR · لوحة واحدة</span><span>بيانات السوق من Binance</span><span>التداول التجريبي فقط</span></footer>
 </main>;
}
