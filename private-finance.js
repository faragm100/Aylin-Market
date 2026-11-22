/* Aylin private finance: public code, private data stays in owner-only Firestore REST documents.
   No persistent cache, localStorage, analytics, AI calls or exports for this ledger. */
(function (root) {
  'use strict';
  const OWNER_UID = 'PQzokv2oTVgcN7afESwk1b7qFKI3';
  const CCY = {SAR:'ريال', EGP:'جنيه', USD:'دولار'};
  const CCY_FULL = {SAR:'ريال سعودي', EGP:'جنيه مصري', USD:'دولار أمريكي'};
  const CCY_DEF = {SAR:'الريال السعودي', EGP:'الجنيه المصري', USD:'الدولار الأمريكي'};
  const CCY_ORDER = ['SAR','EGP','USD'];
  // Only purchase countries with a fixed known currency auto-count. GL mode uses a
  // free-text custom symbol with no currency on the record, so GL and AE never auto-count.
  const PURCHASE_CCY = {SA:'SAR', EG:'EGP'};
  const TYPES = {income:'فلوس داخلة', expense:'فلوس خارجة', transfer:'تحويل بين أرصدتي'};
  const cents = n => { const v=Number(n); if(!Number.isFinite(v)||Math.abs(v)>1e10) throw Error('مبلغ غير صالح'); return Math.round((v+Number.EPSILON)*100); };
  const iso = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
  const monthEnd = m => { const [y,n]=m.split('-').map(Number); return new Date(Date.UTC(y,n,0)).toISOString().slice(0,10); };
  const empty = () => ({v:2, accounts:{SAR:null,EGP:null,USD:null}, entries:[], snapshots:{}});
  function migrate(old) {
    if(!old || typeof old!=='object') throw Error('صيغة السجل غير مدعومة');
    if(old.v===2) return validate(old);
    if(old.v!==1) throw Error('صيغة السجل غير مدعومة');
    const d=empty();
    if(old.settings) {
      const c=old.settings.currency;
      if(!Object.hasOwn(CCY,c)) throw Error('عملة السجل القديم غير مدعومة');
      d.accounts[c]={start:old.settings.start, opening:old.settings.opening};
      for(const e of (old.entries||[])) d.entries.push({...e, account:c});
      for(const [m,s] of Object.entries(old.snapshots||{})) d.snapshots[c+':'+m]=s;
    }
    return validate(d);
  }
  function validate(data) {
    if(!data || data.v!==2 || !data.accounts || typeof data.accounts!=='object' || !Array.isArray(data.entries) || !data.snapshots || typeof data.snapshots!=='object') throw Error('صيغة السجل غير مدعومة');
    for(const k of Object.keys(data.accounts)) {
      if(!Object.hasOwn(CCY,k)) throw Error('عملة غير مدعومة');
      const a=data.accounts[k];
      if(a===null) continue;
      if(!a || !iso(a.start) || !Number.isSafeInteger(a.opening)) throw Error('إعدادات الرصيد غير صالحة');
    }
    for(const k of Object.keys(data.snapshots)) {
      if(!/^(SAR|EGP|USD):\d{4}-\d{2}$/.test(k)) throw Error('مفتاح لقطة غير صالح');
    }
    const ids=new Set();
    for(const e of data.entries) {
      if(!e || typeof e.id!=='string' || ids.has(e.id) || !Object.hasOwn(TYPES,e.type) || !iso(e.date) || !Number.isSafeInteger(e.amount) || e.amount<=0) throw Error('بند غير صالح');
      if(typeof e.note!=='string' || e.note.length>250) throw Error('بند غير صالح');
      if(!Object.hasOwn(CCY,e.account) || !data.accounts[e.account]) throw Error('بند بعملة بلا حساب');
      if(e.date<data.accounts[e.account].start) throw Error('بند قبل تاريخ بداية الحساب');
      if(e.type==='transfer') {
        if(!Object.hasOwn(CCY,e.toAccount) || e.toAccount===e.account || !data.accounts[e.toAccount]) throw Error('حساب التحويل غير صالح');
        if(!Number.isSafeInteger(e.toAmount) || e.toAmount<=0) throw Error('مبلغ التحويل غير صالح');
        if(e.date<data.accounts[e.toAccount].start) throw Error('بند قبل تاريخ بداية الحساب');
      }
      ids.add(e.id);
    }
    if(data.entries.length>5000) throw Error('وصل السجل للحد الأقصى الآمن');
    return data;
  }
  function summary(data, purchases, ccy, month) {
    validate(data);
    const acc=data.accounts[ccy];
    if(!acc) return null;
    const end=monthEnd(month), begin=month+'-01';
    let income=0,extra=0,shopping=0,trOut=0,trIn=0,prior=0,count=0,untracked=0;
    for(const e of data.entries) {
      let delta=0, current=false;
      if(e.account===ccy) {
        if(e.type==='income') delta=e.amount;
        else if(e.type==='expense') delta=-e.amount;
        else delta=-e.amount;
        current=true;
      } else if(e.type==='transfer' && e.toAccount===ccy) { delta=e.toAmount; current=true; }
      if(!current || e.date<acc.start || e.date>end) continue;
      if(e.date<begin) { prior+=delta; continue; }
      if(e.account===ccy) {
        if(e.type==='income') income+=e.amount;
        else if(e.type==='expense') extra+=e.amount;
        else trOut+=e.amount;
      } else trIn+=e.toAmount;
    }
    const seen=new Set();
    for(const p of purchases) {
      if(!p || p.deleted || !iso(p.date||'') || p.date<acc.start || p.date>end) continue;
      if(p.id && seen.has(p.id)) continue; if(p.id) seen.add(p.id);
      const pc=PURCHASE_CCY[p.country||'SA'];
      if(!pc) { if(p.date>=begin) untracked++; continue; }
      if(pc!==ccy) continue;
      const value=cents(p.price);
      if(p.date<begin) prior-=value; else { shopping+=value; count++; }
    }
    return {month,ccy,income,extra,shopping,trOut,trIn,count,untracked,
      net:income-extra-shopping-trOut+trIn,
      balance:acc.opening+prior+income-extra-shopping-trOut+trIn};
  }
  const api={summary,validate,empty,migrate,cents,iso,monthEnd,CCY,CCY_ORDER,PURCHASE_CCY,OWNER_UID};
  if(typeof module!=='undefined'&&module.exports) {module.exports=api;return;}
  if(!root.document) return;
  const el = id=>document.getElementById(id);
  const escF = value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nowDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let financePurchases=[],serverReady=false;
  let data=empty(), updateTime=null, generation=0, opened=false, loaded=false, busy=false, selectedMonth=nowDate().slice(0,7), editing=null, formType='income', openingEdit=null;
  const allowed=()=>auth.currentUser && auth.currentUser.uid===OWNER_UID;
  const endpoint='https://firestore.googleapis.com/v1/projects/aylin-market/databases/(default)/documents/privateFinance/'+OWNER_UID;
  const money=(n,ccy)=>new Intl.NumberFormat('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100)+' '+CCY[ccy];
  const setAccounts=()=>CCY_ORDER.filter(c=>data.accounts[c]);
  const style=document.createElement('style');
  style.textContent=`#privateFinance[hidden]{display:none!important}#privateFinance{position:fixed;inset:0;z-index:65;background:#f3f5f7;color:#172434;overflow:auto;direction:rtl;font-family:inherit}#privateFinance *{box-sizing:border-box}#privateFinance .finance-wrap{max-width:780px;margin:auto;padding:18px 16px 60px}#privateFinance header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}#privateFinance h1{font-size:23px;margin:0 0 5px}#privateFinance h2{font-size:18px;margin:0 0 10px}#privateFinance p{line-height:1.8;margin:6px 0}#privateFinance .f-muted{font-size:13px;color:#586879}#privateFinance .f-card{background:white;padding:16px;border:1px solid #dce3e9;border-radius:18px;margin:12px 0}#privateFinance .f-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}#privateFinance label{display:block;font-size:13px;font-weight:700;line-height:1.7}#privateFinance input,#privateFinance select,#privateFinance button{font:inherit;min-height:44px;border-radius:10px;border:1px solid #cbd5df;padding:10px 12px}#privateFinance input,#privateFinance select{width:100%;background:white;color:#172434;margin:4px 0 12px}#privateFinance button{cursor:pointer;background:#124d62;color:white;font-weight:700}#privateFinance button.f-light{background:#fff;color:#124d62}#privateFinance button:disabled{opacity:.5;cursor:wait}#privateFinance .f-actions{display:flex;gap:8px;flex-wrap:wrap}#privateFinance .f-kpi{padding:12px;border-radius:12px;background:#f1f6f8;min-width:0}#privateFinance .f-kpi strong{display:block;font-size:19px;margin-top:5px;overflow-wrap:anywhere}#privateFinance .f-kpi.f-total{background:#e2f3ec;color:#134e36}#privateFinance .f-alert{background:#fff5dd;border:1px solid #ead79e;border-radius:12px;padding:12px;font-size:13px;line-height:1.8}#privateFinance .f-status{min-height:22px;color:#9a3412;line-height:1.7;font-size:14px}#privateFinance .f-table{overflow:auto}#privateFinance table{border-collapse:collapse;width:100%;font-size:13px;white-space:nowrap}#privateFinance td,#privateFinance th{padding:12px 8px;text-align:right;border-bottom:1px solid #e2e8ef}#privateFinance details summary{cursor:pointer;font-weight:bold;padding:8px 0}#privateFinance .f-entry{border-top:1px solid #e2e8ef;padding:13px 0;line-height:1.8;overflow-wrap:anywhere}#privateFinance .f-entry button{min-height:36px;padding:5px 12px;font-size:12px}#privateFinance .f-badge{font-size:11px;background:#e5eef4;padding:4px 7px;border-radius:6px}#privateFinance .f-full{grid-column:1/-1}@media(max-width:420px){#privateFinance .f-grid.f-form{display:block}#privateFinance .f-kpi strong{font-size:16px}#privateFinance .finance-wrap{padding:14px 12px 45px}#privateFinance h1{font-size:21px}#privateFinance .f-card{padding:14px}}`;
  document.head.appendChild(style);
  const shell=document.createElement('section');shell.id='privateFinance';shell.hidden=true;shell.setAttribute('aria-label','حسابي الخاص');document.body.appendChild(shell);
  const menuButton=document.createElement('button');menuButton.type='button';menuButton.className='btn g';menuButton.id='muPrivateFinance';menuButton.hidden=true;menuButton.textContent='🔒 حسابي الخاص';
  el('muOut').before(menuButton);
  function status(text){const node=el('fStatus');if(node)node.textContent=text;}
  function close(){generation++;opened=false;loaded=false;data=empty();financePurchases=[];serverReady=false;updateTime=null;editing=null;busy=false;formType='income';openingEdit=null;shell.replaceChildren();shell.hidden=true;document.body.style.overflow='';}
  function header(){return `<div class="finance-wrap"><header><div><h1>حسابي الخاص</h1><span class="f-muted">دخلك ومصاريفك وفلوسك، كل عملة لوحدها · للمالك فقط</span></div><button type="button" class="f-light" data-f="close">إغلاق</button></header><div id="fStatus" role="status" aria-live="polite" class="f-status"></div>`;}
  function purchases(){return financePurchases;}
  function setupCard(ccy){
    return `<div class="f-card"><h2>رصيدك ب${CCY_DEF[ccy]}</h2><p class="f-muted">لو عندك فلوس بال${CCY[ccy]}، اكتب المبلغ اللي معاك فعلًا في أول يوم هتسجل منه، قبل أي دخل أو مصروف في اليوم ده. لو هتبدأ من الصفر اكتب 0. وتقدر تعدّل الرقم ده في أي وقت.</p><form class="f-setup" data-ccy="${ccy}"><div class="f-grid f-form"><label>الفلوس اللي معاك بال${CCY[ccy]}<input type="number" name="opening" step="0.01" required inputmode="decimal" placeholder="مثال: 0 أو 10000"></label><label>أول يوم في الحساب<input type="date" name="start" required max="${nowDate()}" value="${nowDate()}"></label></div><button type="submit">ابدأ حساب ال${CCY[ccy]}</button></form></div>`;
  }
  function accountCard(ccy){
    const acc=data.accounts[ccy], s=summary(data,purchases(),ccy,selectedMonth), snap=data.snapshots[ccy+':'+selectedMonth];
    let html=`<div class="f-card"><h2>${CCY_DEF[ccy]}</h2>`;
    if(openingEdit===ccy){
      html+=`<form class="f-opening" data-ccy="${ccy}"><div class="f-grid f-form"><label>رصيد البداية بال${CCY[ccy]}<input type="number" name="opening" step="0.01" required inputmode="decimal" value="${(acc.opening/100).toFixed(2)}"></label><label>أول يوم في الحساب<input type="date" name="start" required max="${nowDate()}" value="${escF(acc.start)}"></label></div><div class="f-actions"><button type="submit">حفظ رصيد البداية</button><button type="button" class="f-light" data-f="cancelOpening">إلغاء</button></div></form>`;
    } else {
      html+=`<p class="f-muted">رصيد البداية: ${money(acc.opening,ccy)} من ${escF(acc.start)} <button type="button" class="f-light" data-opening="${ccy}" style="min-height:32px;padding:3px 10px;font-size:12px">تعديل</button></p>`;
    }
    html+=`<div class="f-grid"><div class="f-kpi">فلوس داخلة الشهر ده<strong>${money(s.income,ccy)}</strong></div><div class="f-kpi">مصاريف إضافية<strong>${money(s.extra,ccy)}</strong></div><div class="f-kpi">مشتريات التطبيق (${s.count})<strong>${money(s.shopping,ccy)}</strong></div><div class="f-kpi f-full">تحويلات هذا الشهر<strong style="font-size:15px">داخلة: ${money(s.trIn,ccy)}</strong><strong style="font-size:15px">خارجة: ${money(s.trOut,ccy)}</strong></div><div class="f-kpi f-total f-full">رصيدك بال${CCY[ccy]} حتى نهاية الشهر${selectedMonth===nowDate().slice(0,7)?'، بالمسجل حتى اليوم':''}<strong>${money(s.balance,ccy)}</strong></div></div>`;
    if(s.untracked) html+=`<div class="f-alert">في ${s.untracked} مشتريات بالوضع الدولي أو بالدرهم في الشهر ده مش بتتحسب في أي رصيد، لأن عملتها مش ثابتة في التطبيق. لو كانت بإحدى عملاتك التلاتة، سجّلها بنفسك كـ«فلوس خارجة» في العملة الصح.</div>`;
    html+=`<details><summary>ملخص كل شهر ولقطاته</summary><div class="f-table"><table><thead><tr><th>الشهر</th><th>صافي الشهر</th><th>الرصيد</th><th>لقطة مثبتة</th></tr></thead><tbody>`;
    let cursor=acc.start.slice(0,7), last=nowDate().slice(0,7), guard=0;
    const rows=[];
    while(cursor<=last&&guard++<1200){const r=summary(data,purchases(),ccy,cursor);const sn=data.snapshots[ccy+':'+cursor];rows.unshift(`<tr><td>${cursor}</td><td>${money(r.net,ccy)}</td><td>${money(r.balance,ccy)}</td><td>${sn?money(sn.balance,ccy):'—'}</td></tr>`);let [y,m]=cursor.split('-').map(Number);m++;if(m>12){m=1;y++;}cursor=y+'-'+String(m).padStart(2,'0');}
    html+=rows.join('')+`</tbody></table></div><p class="f-muted" style="margin-top:10px">${snap?`لقطة ${escF(snap.savedAt.slice(0,10))}: رصيد ${money(snap.balance,ccy)} · صافي الشهر ${money(snap.net,ccy)}`:'مفيش لقطة مثبتة للشهر المختار.'}</p><button type="button" class="f-light" data-snapshot="${ccy}" ${selectedMonth>=nowDate().slice(0,7)?'disabled':''}>${snap?'تحديث لقطة نهاية الشهر':'تثبيت لقطة نهاية الشهر المختار'}</button><p class="f-muted">الحساب بيتحدث لو عدلت حركات قديمة. اللقطة بتحفظ القيمة زي ما هي وقت التثبيت، والشهر الحالي مبيتثبتش قبل ما يخلص.</p></details></div>`;
    return html;
  }
  function entryForm(){
    const accounts=setAccounts();
    if(!accounts.length) return '';
    const isTr=formType==='transfer';
    let html=`<div class="f-card"><h2>${editing?'تعديل حركة':'سجّل حركة'}</h2><p class="f-muted">سجّل هنا بس اللي مش موجود في مشتريات التطبيق، دي بتتحسب لوحدها.</p><form id="fEntry"><label>نوع الحركة<select name="type" id="fType">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}"${formType===k?' selected':''}>${v}</option>`).join('')}</select></label><div class="f-grid f-form">`;
    if(isTr){
      html+=`<label>من رصيد<select name="account">${accounts.map(c=>`<option value="${c}">${CCY_FULL[c]}</option>`).join('')}</select></label><label>إلى رصيد<select name="toAccount">${accounts.map((c,i)=>`<option value="${c}"${i===1?' selected':''}>${CCY_FULL[c]}</option>`).join('')}</select></label><label>اللي اتخصم من حسابك كله (شامل أي رسوم)<input name="amount" type="number" min="0.01" step="0.01" required inputmode="decimal"></label><label>اللي وصل للحساب التاني فعلًا<input name="toAmount" type="number" min="0.01" step="0.01" required inputmode="decimal"></label><label>التاريخ<input type="date" name="date" max="${nowDate()}" value="${nowDate()}" required></label><label class="f-full">وصف (اختياري)<input name="note" maxlength="250" placeholder="مثال: تحويل للأسرة، الرسوم 15 ريال"></label>`;
    } else {
      html+=`<label>العملة<select name="account">${accounts.map(c=>`<option value="${c}">${CCY_FULL[c]}</option>`).join('')}</select></label><label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" required inputmode="decimal"></label><label>التاريخ<input type="date" name="date" max="${nowDate()}" value="${nowDate()}" required></label><label>الوصف<input name="note" maxlength="250" required placeholder="مثال: مرتب، أو مصروف مشوار"></label>`;
    }
    html+=`</div><div class="f-actions" style="margin-top:12px"><button type="submit">${editing?'حفظ التعديل':'حفظ الحركة'}</button>${editing?'<button class="f-light" type="button" data-f="cancelEdit">إلغاء التعديل</button>':''}</div></form></div>`;
    return html;
  }
  function render(){
    if(!opened||!allowed()) return close();
    if(!loaded){shell.innerHTML=header()+'<div class="f-card">جاري تحميل السجل الخاص من الخادم…</div></div>';return;}
    if(setAccounts().length&&!serverReady){shell.innerHTML=header()+'<div class="f-card">جاري تأكيد تحميل المشتريات. لا نحسب الرصيد قبل اكتمالها. تأكد من الاتصال.</div></div>';return;}
    let html=header();
    if(setAccounts().length){
      html+=`<div class="f-card"><label>الشهر<input id="fMonth" type="month" value="${selectedMonth}" min="${setAccounts().map(c=>data.accounts[c].start.slice(0,7)).sort()[0]}" max="${nowDate().slice(0,7)}"></label><p class="f-muted">مشتريات التطبيق بتتخصم لوحدها من رصيد عملتها: مشتريات السعودية من الريال، ومشتريات مصر من الجنيه. بتتأكد من الخادم وقت فتح القسم؛ اقفل القسم وافتحه عشان تحدّثها.</p></div>`;
    }
    html+=entryForm();
    for(const ccy of CCY_ORDER) html+=data.accounts[ccy]?accountCard(ccy):setupCard(ccy);
    if(setAccounts().length){
      const entries=data.entries.filter(e=>e.date.slice(0,7)===selectedMonth).sort((a,b)=>b.date.localeCompare(a.date));
      html+=`<div class="f-card"><details open><summary>حركات الشهر المختار (${entries.length})</summary>${entries.map(e=>`<div class="f-entry"><span class="f-badge">${escF(TYPES[e.type])}</span> <span class="f-badge">${escF(CCY_FULL[e.account])}</span><p>${escF(e.note)} · ${e.type==='transfer'?`${money(e.amount,e.account)} إلى ${money(e.toAmount,e.toAccount)}`:money(e.amount,e.account)}</p><span class="f-muted">${e.date}</span><div class="f-actions"><button type="button" class="f-light" data-edit="${escF(e.id)}">تعديل</button><button type="button" class="f-light" data-delete="${escF(e.id)}">حذف</button></div></div>`).join('')||'<p class="f-muted">لا توجد حركات مسجلة في الشهر ده.</p>'}</details></div>`;
    }
    html+='<div class="f-alert">هذا سجل متابعة، وليس حاسبة زكاة. صافي الدخل وحده لا يحدد الزكاة.</div><p class="f-muted">السجل محمي بصلاحية المالك على الخادم. لا يُخزّن في ذاكرة التطبيق الدائمة أو تقارير الذكاء الاصطناعي، ولا يجمع العملات في رقم واحد. يتطلب اتصالًا بالإنترنت. اقفل الصفحة أو سجّل خروجك لو الجهاز مشترك.</p></div>';
    shell.innerHTML=html;
    if(editing){const e=data.entries.find(x=>x.id===editing);if(e){const form=el('fEntry');form.elements.account.value=e.account;if(e.type==='transfer'){form.elements.toAccount.value=e.toAccount;form.elements.toAmount.value=(e.toAmount/100).toFixed(2);}form.elements.date.value=e.date;form.elements.note.value=e.note;form.elements.amount.value=(e.amount/100).toFixed(2);}}
  }
  async function request(method,payload,expectedGeneration) {
    const user=auth.currentUser;if(!allowed())throw Error('السجل للمالك فقط');
    const token=await user.getIdToken();
    if(generation!==expectedGeneration||!allowed()||auth.currentUser.uid!==user.uid)throw Error('تغير الحساب. أعد فتح السجل');
    let url=endpoint;if(method==='PATCH')url+='?'+(updateTime?'currentDocument.updateTime='+encodeURIComponent(updateTime):'currentDocument.exists=false');
    const response=await fetch(url,{method,cache:'no-store',credentials:'omit',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(payload?{body:JSON.stringify({fields:{schemaVersion:{integerValue:'1'},payload:{stringValue:JSON.stringify(payload)}}})}:{})});
    if(generation!==expectedGeneration||!allowed())throw Error('أُغلق السجل أو تغير الحساب');
    if(response.status===404&&method==='GET')return null;
    if(!response.ok){if([409,412].includes(response.status))throw Error('تغير السجل في جهاز آخر. اقفل السجل وافتحه قبل إعادة الحفظ');if([401,403].includes(response.status))throw Error('تعذر تأكيد صلاحية المالك. لم يتم حفظ شيء');throw Error('تعذر الاتصال أو الحفظ. لم يتم تأكيد الحفظ');}
    return await response.json();
  }
  async function save(next,success){
    if(busy)return;busy=true;const g=generation;
    const controls=[...shell.querySelectorAll('button,input,select')].filter(n=>!n.matches('[data-f="close"]')).map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);status('جاري الحفظ على الخادم…');
    try{validate(next);const result=await request('PATCH',next,g);if(g!==generation)return;updateTime=result.updateTime;data=next;editing=null;openingEdit=null;render();status(success);}
    catch(e){if(g===generation){controls.forEach(([n,wasDisabled])=>n.disabled=wasDisabled);status(e.message||'لم يتم تأكيد الحفظ');}}
    finally{if(g===generation)busy=false;}
  }
  menuButton.onclick=async()=>{
    if(!allowed())return;
    close();opened=true;shell.hidden=false;document.body.style.overflow='hidden';const g=generation;render();
    try{const [result,shared]=await Promise.all([request('GET',null,g),db.collection('purchases').get({source:'server'})]);if(g!==generation||!allowed())return;financePurchases=shared.docs.map(d=>({id:d.id,...d.data()}));serverReady=true;data=result?migrate(JSON.parse(result.fields.payload.stringValue)):empty();updateTime=result?result.updateTime:null;loaded=true;selectedMonth=nowDate().slice(0,7);render();}
    catch(e){if(g===generation){shell.innerHTML=header()+'<div class="f-card">تعذر تحميل السجل. لم نعرض بيانات مخزنة قديمة. اقفله وافتحه بعد التأكد من الاتصال.</div></div>';status(e.message);}}
  };
  shell.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.f==='close')return close();if(busy)return;
    if(b.dataset.f==='cancelEdit'){editing=null;render();return;}
    if(b.dataset.f==='cancelOpening'){openingEdit=null;render();return;}
    if(b.dataset.opening){openingEdit=b.dataset.opening;render();return;}
    if(b.dataset.edit){const e=data.entries.find(x=>x.id===b.dataset.edit);if(!e)return;editing=e.id;formType=e.type;render();el('fEntry').scrollIntoView({behavior:'smooth',block:'center'});return;}
    if(b.dataset.delete){if(!confirm('حذف هذه الحركة من سجلك الخاص؟ اللقطات المثبتة لا تتغير تلقائيًا.'))return;const next=JSON.parse(JSON.stringify(data));next.entries=next.entries.filter(e=>e.id!==b.dataset.delete);save(next,'تم حذف الحركة الخاصة.');return;}
    if(b.dataset.snapshot){
      const ccy=b.dataset.snapshot;
      if(selectedMonth>=nowDate().slice(0,7))return;
      if(data.snapshots[ccy+':'+selectedMonth]&&!confirm('تحديث اللقطة القديمة بالقيم الحالية؟ لن يمكنك استعادة القيمة القديمة من هنا.'))return;
      const next=JSON.parse(JSON.stringify(data));next.snapshots[ccy+':'+selectedMonth]={...summary(data,purchases(),ccy,selectedMonth),savedAt:new Date().toISOString()};save(next,'تم تثبيت لقطة نهاية الشهر.');
    }
  });
  shell.addEventListener('change',event=>{
    if(event.target.id==='fMonth'){const m=event.target.value;if(/^\d{4}-\d{2}$/.test(m)&&m<=nowDate().slice(0,7)){selectedMonth=m;editing=null;render();}}
    if(event.target.id==='fType'){formType=event.target.value;editing=null;render();}
  });
  shell.addEventListener('submit',event=>{
    event.preventDefault();if(busy||!allowed())return;const f=event.target;const fields=new FormData(f);const next=JSON.parse(JSON.stringify(data));
    try{
      if(f.classList.contains('f-setup')){
        const ccy=f.dataset.ccy,start=fields.get('start');
        if(!Object.hasOwn(CCY,ccy)||next.accounts[ccy])throw Error('الحساب موجود بالفعل');
        if(!iso(start)||start>nowDate()||start<'2000-01-01')throw Error('اختر تاريخ بداية صحيحًا من 2000 وحتى اليوم');
        next.accounts[ccy]={start,opening:cents(fields.get('opening'))};selectedMonth=nowDate().slice(0,7);save(next,'تم حفظ بداية حساب '+CCY[ccy]+'.');
      } else if(f.classList.contains('f-opening')){
        const ccy=f.dataset.ccy,start=fields.get('start');
        if(!Object.hasOwn(CCY,ccy)||!next.accounts[ccy])throw Error('الحساب غير موجود');
        if(!iso(start)||start>nowDate()||start<'2000-01-01')throw Error('اختر تاريخ بداية صحيحًا من 2000 وحتى اليوم');
        next.accounts[ccy]={start,opening:cents(fields.get('opening'))};save(next,'تم تعديل رصيد البداية.');
      } else if(f.id==='fEntry') {
        const date=fields.get('date'),amount=cents(fields.get('amount')),type=fields.get('type'),account=fields.get('account');
        if(!next.accounts[account])throw Error('ابدأ حساب العملة الأول');
        if(!iso(date)||date<next.accounts[account].start||date>nowDate()||amount<=0)throw Error('راجع التاريخ والمبلغ');
        const entry={id:editing||(crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')),type,account,date,amount,note:''};
        if(type==='transfer'){
          const toAccount=fields.get('toAccount');
          if(!next.accounts[toAccount]||toAccount===account)throw Error('اختر حسابين مختلفين للتحويل');
          if(date<next.accounts[toAccount].start)throw Error('التاريخ قبل بداية حساب '+CCY[toAccount]);
          entry.toAccount=toAccount;entry.toAmount=cents(fields.get('toAmount'));
          if(entry.toAmount<=0)throw Error('راجع مبلغ التحويل');
          entry.note=String(fields.get('note')||'').trim()||`تحويل من ${CCY_FULL[account]} إلى ${CCY_FULL[toAccount]}`;
        } else {
          entry.note=String(fields.get('note')||'').trim();
          if(!entry.note)throw Error('اكتب وصف الحركة');
        }
        if(editing)next.entries=next.entries.map(e=>e.id===editing?entry:e);else next.entries.push(entry);
        selectedMonth=date.slice(0,7);save(next,'تم حفظ الحركة في سجلك الخاص فقط.');
      }
    }catch(e){status(e.message);}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened)close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&opened)close();});
  auth.onAuthStateChanged(()=>{menuButton.hidden=!allowed();close();});
})(typeof window!=='undefined'?window:globalThis);
