/* Aylin private finance: public code, private data stays in owner-only Firestore REST documents.
   No persistent cache, localStorage, analytics, AI calls or exports for this ledger. */
(function (root) {
  'use strict';
  const OWNER_UID = 'PQzokv2oTVgcN7afESwk1b7qFKI3';
  const COUNTRY_CURRENCY = {SA:'SAR', EG:'EGP', AE:'AED'};
  const TYPES = {income:'دخل', expense:'مصروف فعلي إضافي'};
  const cents = n => { const v=Number(n); if(!Number.isFinite(v)||Math.abs(v)>1e10) throw Error('مبلغ غير صالح'); return Math.round((v+Number.EPSILON)*100); };
  const iso = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
  const monthEnd = m => { const [y,n]=m.split('-').map(Number); return new Date(Date.UTC(y,n,0)).toISOString().slice(0,10); };
  const empty = () => ({v:1, settings:null, entries:[], snapshots:{}});
  function validate(data) {
    if(!data || data.v!==1 || !Array.isArray(data.entries) || !data.snapshots || typeof data.snapshots!=='object') throw Error('صيغة السجل غير مدعومة');
    if(data.settings) {
      const s=data.settings;
      if(!['SAR','EGP','AED'].includes(s.currency)||!iso(s.start)||!Number.isSafeInteger(s.opening)) throw Error('إعدادات الرصيد غير صالحة');
    }
    const ids=new Set();
    for(const e of data.entries) {
      if(!e || typeof e.id!=='string'||ids.has(e.id)||!Object.hasOwn(TYPES,e.type)||!iso(e.date)||!Number.isSafeInteger(e.amount)||e.amount<=0||typeof e.note!=='string'||e.note.length>250) throw Error('بند غير صالح');
      if(data.settings && e.date<data.settings.start) throw Error('بند قبل تاريخ بداية السجل');
      ids.add(e.id);
    }
    if(data.entries.length>5000) throw Error('وصل السجل للحد الأقصى الآمن');
    return data;
  }
  function summary(data, purchases, month) {
    validate(data); if(!data.settings) return null;
    const s=data.settings, end=monthEnd(month), begin=month+'-01';
    let income=0,extra=0,shopping=0,transfers=0,prior=0,count=0,excluded=0;
    for(const e of data.entries) {
      if(e.date<s.start||e.date>end) continue;
      const sign=e.type==='income'?1:e.type==='expense'?-1:0;
      if(e.date<begin) prior+=sign*e.amount;
      else if(e.type==='income') income+=e.amount;
      else if(e.type==='expense') extra+=e.amount;
      
    }
    const seen=new Set();
    for(const p of purchases) {
      if(!p || p.deleted || !iso(p.date||'') || p.date<s.start || p.date>end) continue;
      if(p.id && seen.has(p.id)) continue; if(p.id) seen.add(p.id);
      if(COUNTRY_CURRENCY[p.country||'SA']!==s.currency) {if(p.date>=begin) excluded++;continue;}
      const value=cents(p.price);
      if(p.date<begin) prior-=value; else {shopping+=value;count++;}
    }
    return {month,income,extra,shopping,transfers,count,excluded,net:income-extra-shopping,balance:s.opening+prior+income-extra-shopping};
  }
  const api={summary,validate,empty,cents,iso,monthEnd,OWNER_UID};
  if(typeof module!=='undefined'&&module.exports) {module.exports=api;return;}
  if(!root.document) return;
  const el = id=>document.getElementById(id);
  const escF = value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nowDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let financePurchases=[],serverReady=false;
  let data=empty(), updateTime=null, generation=0, opened=false, loaded=false, busy=false, selectedMonth=nowDate().slice(0,7), editing=null;
  const allowed=()=>auth.currentUser && auth.currentUser.uid===OWNER_UID;
  const endpoint='https://firestore.googleapis.com/v1/projects/aylin-market/databases/(default)/documents/privateFinance/'+OWNER_UID;
  const money=n=>new Intl.NumberFormat('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100)+' '+(data.settings?data.settings.currency:'');
  const style=document.createElement('style');
  style.textContent=`#privateFinance[hidden]{display:none!important}#privateFinance{position:fixed;inset:0;z-index:65;background:#f3f5f7;color:#172434;overflow:auto;direction:rtl;font-family:inherit}#privateFinance *{box-sizing:border-box}#privateFinance .finance-wrap{max-width:780px;margin:auto;padding:18px 16px 60px}#privateFinance header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}#privateFinance h1{font-size:23px;margin:0 0 5px}#privateFinance h2{font-size:18px;margin:0 0 14px}#privateFinance p{line-height:1.8;margin:8px 0}#privateFinance .f-muted{font-size:13px;color:#586879}#privateFinance .f-card{background:white;padding:18px;border:1px solid #dce3e9;border-radius:18px;margin:14px 0}#privateFinance .f-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}#privateFinance label{display:block;font-size:13px;font-weight:700;line-height:1.7}#privateFinance input,#privateFinance select,#privateFinance button{font:inherit;min-height:44px;border-radius:10px;border:1px solid #cbd5df;padding:10px 12px}#privateFinance input,#privateFinance select{width:100%;background:white;color:#172434;margin:4px 0 12px}#privateFinance button{cursor:pointer;background:#124d62;color:white;font-weight:700}#privateFinance button.f-light{background:#fff;color:#124d62}#privateFinance button:disabled{opacity:.5;cursor:wait}#privateFinance .f-actions{display:flex;gap:8px;flex-wrap:wrap}#privateFinance .f-kpi{padding:14px;border-radius:12px;background:#f1f6f8;min-width:0}#privateFinance .f-kpi strong{display:block;font-size:20px;margin-top:7px;overflow-wrap:anywhere}#privateFinance .f-kpi.f-total{background:#e2f3ec;color:#134e36}#privateFinance .f-alert{background:#fff5dd;border:1px solid #ead79e;border-radius:12px;padding:12px;font-size:13px;line-height:1.8}#privateFinance .f-status{min-height:22px;color:#9a3412;line-height:1.7;font-size:14px}#privateFinance .f-table{overflow:auto}#privateFinance table{border-collapse:collapse;width:100%;font-size:13px;white-space:nowrap}#privateFinance td,#privateFinance th{padding:12px 8px;text-align:right;border-bottom:1px solid #e2e8ef}#privateFinance details summary{cursor:pointer;font-weight:bold;padding:8px 0}#privateFinance .f-entry{border-top:1px solid #e2e8ef;padding:13px 0;line-height:1.8;overflow-wrap:anywhere}#privateFinance .f-entry button{min-height:36px;padding:5px 12px;font-size:12px}#privateFinance .f-badge{font-size:11px;background:#e5eef4;padding:4px 7px;border-radius:6px}#privateFinance .f-full{grid-column:1/-1}@media(max-width:420px){#privateFinance .f-grid.f-form{display:block}#privateFinance .f-kpi strong{font-size:17px}#privateFinance .finance-wrap{padding:14px 12px 45px}#privateFinance h1{font-size:21px}#privateFinance .f-card{padding:14px}}`;
  document.head.appendChild(style);
  const shell=document.createElement('section');shell.id='privateFinance';shell.hidden=true;shell.setAttribute('aria-label','حسابي الخاص');document.body.appendChild(shell);
  const menuButton=document.createElement('button');menuButton.type='button';menuButton.className='btn g';menuButton.id='muPrivateFinance';menuButton.hidden=true;menuButton.textContent='🔒 حسابي الخاص: الدخل والمدخرات';
  el('muOut').before(menuButton);
  function status(text){const node=el('fStatus');if(node)node.textContent=text;}
  function close(){generation++;opened=false;loaded=false;data=empty();financePurchases=[];serverReady=false;updateTime=null;editing=null;busy=false;shell.replaceChildren();shell.hidden=true;document.body.style.overflow='';}
  function header(){return `<div class="finance-wrap"><header><div><h1>حسابي الخاص</h1><span class="f-muted">الدخل والمصاريف والمدخرات · للمالك فقط</span></div><button type="button" class="f-light" data-f="close">إغلاق</button></header><div id="fStatus" role="status" aria-live="polite" class="f-status"></div>`;}
  function purchases(){return financePurchases;}
  function render(){
    if(!opened||!allowed()) return close();
    if(!loaded){shell.innerHTML=header()+'<div class="f-card">جاري تحميل السجل الخاص من الخادم…</div></div>';return;}
    let html=header();
    if(!data.settings){
      html+=`<div class="f-card"><h2>ابدأ برصيد معلوم</h2><p>اكتب إجمالي مدخراتك في عملة واحدة في بداية التاريخ المختار، قبل أي حركة في ذلك اليوم. لا نفترض أن رصيدك صفر.</p><p class="f-muted">هذا السجل لعملة واحدة. المشتريات بعملة أخرى لا تُجمع معها، ولا نحسب سعر تحويل تلقائيًا.</p><form id="fSetup"><label>عملة هذا السجل<select name="currency" required><option value="">اختر العملة</option><option value="SAR">ريال سعودي SAR</option><option value="EGP">جنيه مصري EGP</option><option value="AED">درهم إماراتي AED</option></select></label><div class="f-grid f-form"><label>تاريخ بداية السجل<input type="date" name="start" required max="${nowDate()}"></label><label>رصيد المدخرات الافتتاحي<input type="number" name="opening" step="0.01" required inputmode="decimal" placeholder="اكتب 0 لو لا توجد مدخرات"></label></div><button type="submit">حفظ البداية الخاصة</button></form></div>`;
    } else {
      if(!serverReady){shell.innerHTML=header()+'<div class="f-card">جاري تأكيد تحميل المشتريات. لا نحسب الرصيد قبل اكتمالها. تأكد من الاتصال.</div></div>';return;}
      const s=summary(data,purchases(),selectedMonth),settings=data.settings, snap=data.snapshots[selectedMonth];
      html+=`<div class="f-muted">العملة: ${escF(settings.currency)} · البداية: ${escF(settings.start)} · رصيد البداية: ${money(settings.opening)}</div><div class="f-card"><label>الشهر الميلادي<input id="fMonth" type="month" value="${selectedMonth}" min="${settings.start.slice(0,7)}" max="${nowDate().slice(0,7)}"></label><div class="f-grid"><div class="f-kpi">الدخل<strong>${money(s.income)}</strong></div><div class="f-kpi">مشتريات التطبيق (${s.count})<strong>${money(s.shopping)}</strong></div><div class="f-kpi">مصاريف إضافية وتحويلات للغير<strong>${money(s.extra)}</strong></div><div class="f-kpi">صافي الإضافة هذا الشهر<strong>${money(s.net)}</strong></div><div class="f-kpi f-total f-full">الرصيد التراكمي حتى نهاية الشهر${selectedMonth===nowDate().slice(0,7)?'، حسب المسجل حتى اليوم':''}<strong>${money(s.balance)}</strong></div></div><p class="f-muted">الرصيد = رصيد البداية + كل الدخل − المصاريف − المشتريات منذ تاريخ البداية. يشمل مشتريات البيت المسجلة بكل الأعضاء في عملة السجل، بما فيها المرتجعات، مرة واحدة. هذا رصيد حسابي، وليس رصيد بنك متصل. المشتريات مؤكدة من الخادم وقت فتح القسم؛ اقفله وافتحه لتحديثها.</p>${s.excluded?`<div class="f-alert">${s.excluded} عملية بعملة أخرى أو بالوضع الدولي غير مشمولة. لا نجمع عملات مختلفة ولا نفترض عملة الوضع الدولي.</div>`:''}</div>`;
      html+=`<div class="f-card"><h2>${editing?'تعديل بند':'إضافة دخل أو مصروف'}</h2><p class="f-muted">سجّل هنا ما هو خارج مشتريات التطبيق فقط، ولا تعِد كتابة فاتورة محسوبة تلقائيًا.</p><form id="fEntry"><div class="f-grid f-form"><label>نوع الحركة<select name="type">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>المبلغ (${escF(settings.currency)})<input name="amount" type="number" min="0.01" step="0.01" required inputmode="decimal"></label><label>التاريخ<input type="date" name="date" min="${settings.start}" max="${nowDate()}" value="${nowDate()}" required></label><label>وصف الحركة<input name="note" maxlength="250" required placeholder="مثال: راتب أو تحويل للأسرة"></label></div><div class="f-actions" style="margin-top:12px"><button type="submit">${editing?'حفظ التعديل':'حفظ الحركة'}</button>${editing?'<button class="f-light" type="button" data-f="cancelEdit">إلغاء التعديل</button>':''}</div></form></div>`;
      html+=`<div class="f-card"><h2>مرجع رصيد الشهر</h2><p class="f-muted">الحساب يتحدث لو عدلت المشتريات أو الحركات القديمة. تقدر تثبت لقطة في نهاية شهر سابق لترجع لها السنة الجاية، من غير ما تمنع تعديل السجل الأصلي.</p>${snap?`<p>لقطة ${escF(snap.savedAt.slice(0,10))}: رصيد ${money(snap.balance)} · صافي الشهر ${money(snap.net)}</p>`:'<p class="f-muted">لم تثبت لقطة لهذا الشهر.</p>'}<button type="button" class="f-light" data-f="snapshot" ${selectedMonth>=nowDate().slice(0,7)?'disabled':''}>${snap?'تحديث لقطة نهاية الشهر':'تثبيت لقطة نهاية الشهر'}</button><p class="f-muted">الشهر الحالي لا يُثبّت قبل انتهائه.</p></div>`;
      const rows=[]; let cursor=settings.start.slice(0,7), last=nowDate().slice(0,7),guard=0;
      while(cursor<=last&&guard++<1200){const r=summary(data,purchases(),cursor);rows.unshift(`<tr><td>${cursor}</td><td>${money(r.net)}</td><td>${money(r.balance)}</td><td>${data.snapshots[cursor]?money(data.snapshots[cursor].balance):'لم يُثبّت'}</td></tr>`);let [y,m]=cursor.split('-').map(Number);m++;if(m>12){m=1;y++;}cursor=y+'-'+String(m).padStart(2,'0');}
      html+=`<div class="f-card"><h2>تاريخ المدخرات الشهري</h2><p class="f-muted">الصافي هو حركة الشهر فقط. الرصيد يشمل ما قبله. اللقطة تحتفظ بالقيمة وقت تثبيتها.</p><div class="f-table"><table><thead><tr><th>الشهر</th><th>صافي الإضافة</th><th>الرصيد الحسابي</th><th>الرصيد المثبّت</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`;
      const entries=data.entries.filter(e=>e.date.slice(0,7)===selectedMonth).sort((a,b)=>b.date.localeCompare(a.date));
      html+=`<div class="f-card"><details><summary>حركاتك الإضافية في الشهر (${entries.length})</summary>${entries.map(e=>`<div class="f-entry"><span class="f-badge">${escF(TYPES[e.type])}</span><p>${escF(e.note)} · ${money(e.amount)}</p><span class="f-muted">${e.date}</span><div class="f-actions"><button type="button" class="f-light" data-edit="${escF(e.id)}">تعديل</button><button type="button" class="f-light" data-delete="${escF(e.id)}">حذف</button></div></div>`).join('')||'<p class="f-muted">لا توجد حركات إضافية.</p>'}</details></div>`;
    }
    html+='<div class="f-alert">هذا سجل متابعة، وليس حاسبة زكاة. صافي الدخل وحده لا يحدد الزكاة. سنفصل النصاب والحول والديون والأصول، وطريقة التعامل مع المدخرات الشهرية، بعد تحديد المنهج المناسب.</div><p class="f-muted">السجل محمي بصلاحية المالك على الخادم. لا يُخزّن في ذاكرة التطبيق الدائمة أو تقارير الذكاء الاصطناعي. يتطلب اتصالًا بالإنترنت للقراءة والحفظ. اقفل الصفحة أو سجّل خروجك لو الجهاز مشترك.</p></div>';
    shell.innerHTML=html;
    if(editing){const e=data.entries.find(x=>x.id===editing);if(e){const form=el('fEntry');for(const k of ['type','date','note'])form.elements[k].value=e[k];form.elements.amount.value=(e.amount/100).toFixed(2);}}
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
    try{validate(next);const result=await request('PATCH',next,g);if(g!==generation)return;updateTime=result.updateTime;data=next;editing=null;render();status(success);}
    catch(e){if(g===generation){controls.forEach(([n,wasDisabled])=>n.disabled=wasDisabled);status(e.message||'لم يتم تأكيد الحفظ');}}
    finally{if(g===generation)busy=false;}
  }
  menuButton.onclick=async()=>{
    if(!allowed())return;
    close();opened=true;shell.hidden=false;document.body.style.overflow='hidden';const g=generation;render();
    try{const [result,shared]=await Promise.all([request('GET',null,g),db.collection('purchases').get({source:'server'})]);if(g!==generation||!allowed())return;financePurchases=shared.docs.map(d=>({id:d.id,...d.data()}));serverReady=true;data=result?validate(JSON.parse(result.fields.payload.stringValue)):empty();updateTime=result?result.updateTime:null;loaded=true;selectedMonth=nowDate().slice(0,7);render();}
    catch(e){if(g===generation){shell.innerHTML=header()+'<div class="f-card">تعذر تحميل السجل. لم نعرض بيانات مخزنة قديمة. اقفله وافتحه بعد التأكد من الاتصال.</div></div>';status(e.message);}}
  };
  shell.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.f==='close')return close();if(busy)return;
    if(b.dataset.f==='cancelEdit'){editing=null;render();return;}
    if(b.dataset.edit){editing=b.dataset.edit;render();el('fEntry').scrollIntoView({behavior:'smooth',block:'center'});return;}
    if(b.dataset.delete){if(!confirm('حذف هذه الحركة من سجلك الخاص؟ اللقطات المثبتة لا تتغير تلقائيًا.'))return;const next=JSON.parse(JSON.stringify(data));next.entries=next.entries.filter(e=>e.id!==b.dataset.delete);save(next,'تم حذف الحركة الخاصة.');return;}
    if(b.dataset.f==='snapshot'){
      if(selectedMonth>=nowDate().slice(0,7))return;
      if(data.snapshots[selectedMonth]&&!confirm('تحديث اللقطة القديمة بالقيم الحالية؟ لن يمكنك استعادة القيمة القديمة من هنا.'))return;
      const next=JSON.parse(JSON.stringify(data));next.snapshots[selectedMonth]={...summary(data,purchases(),selectedMonth),savedAt:new Date().toISOString()};save(next,'تم تثبيت لقطة نهاية الشهر.');
    }
  });
  shell.addEventListener('change',event=>{if(event.target.id==='fMonth'){const m=event.target.value;if(/^\d{4}-\d{2}$/.test(m)&&m>=data.settings.start.slice(0,7)&&m<=nowDate().slice(0,7)){selectedMonth=m;editing=null;render();}}});
  shell.addEventListener('submit',event=>{
    event.preventDefault();if(busy||!allowed())return;const f=event.target;const fields=new FormData(f);const next=JSON.parse(JSON.stringify(data));
    try{
      if(f.id==='fSetup'){
        const start=fields.get('start');if(!iso(start)||start>nowDate()||start<'2000-01-01')throw Error('اختر تاريخ بداية صحيحًا من 2000 وحتى اليوم');
        next.settings={currency:fields.get('currency'),start,opening:cents(fields.get('opening'))};selectedMonth=nowDate().slice(0,7);save(next,'تم حفظ بداية السجل الخاص.');
      } else if(f.id==='fEntry') {
        const date=fields.get('date'),amount=cents(fields.get('amount')),note=String(fields.get('note')).trim();
        if(!iso(date)||date<next.settings.start||date>nowDate()||amount<=0||!note)throw Error('راجع التاريخ والمبلغ والوصف');
        const entry={id:editing||(crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')),type:fields.get('type'),date,amount,note};
        if(editing)next.entries=next.entries.map(e=>e.id===editing?entry:e);else next.entries.push(entry);
        selectedMonth=date.slice(0,7);save(next,'تم حفظ الحركة في سجلك الخاص فقط.');
      }
    }catch(e){status(e.message);}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened)close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&opened)close();});
  auth.onAuthStateChanged(()=>{menuButton.hidden=!allowed();close();});
})(typeof window!=='undefined'?window:globalThis);
