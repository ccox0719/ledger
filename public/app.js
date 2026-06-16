// app.js — The Ledger (Supabase-backed)
import { supabase, getSession, signIn, signOut, resolveHousehold, loadState, scheduleSave, flushSave, deleteTxns, deleteTxnIds } from './data.js';

// ---- Global app state (was localStorage-backed, now Supabase) ----
let state = { months:{}, rules:[], trips:[] };
let cursor = monthKey(new Date(2026,5,1));
let view = 'flow';

// Save on tab close to flush any pending debounce
window.addEventListener('beforeunload', () => { try { flushSave(state); } catch(e){} });


const KEY='ledger.cashflow.v4';
// type: 'in' income, 'out' expense, 'xfer' transfer to savings
function defaultMonth(){
  const E=(name,amt,day,grp)=>({id:crypto.randomUUID(),name,budgeted:amt,day,grp,type:'out',paid:false,actual:null});
  const I=(name,amt,day)=>({id:crypto.randomUUID(),name,budgeted:amt,day,grp:'INCOME',type:'in',paid:false,actual:null});
  const X=(name,amt,day,grp)=>({id:crypto.randomUUID(),name,budgeted:amt,day,grp,type:'xfer',paid:false,actual:null});
  return {
    todayBalance:null,
    oneTime:[],
    imported:[],
    groups:[
      {id:crypto.randomUUID(),name:'INCOME',lines:[
        I('ADP (1st)',2132,7), I('ADP (2nd)',2132,21), I('Raker Rhodes Engineering',5400,30),
        I('Annie Phone Stipend',0,15),
      ]},
      {id:crypto.randomUUID(),name:'CHARITABLE',lines:[
        E('Giving',100,1),E('Tithe',1060,6),E('Compassion',50,15),
      ]},
      {id:crypto.randomUUID(),name:'SAVINGS / TRANSFERS',lines:[
        X('Retirement Fund',2000,2),
        X('Credit Card Payment',0,19),
      ]},
      {id:crypto.randomUUID(),name:'HOUSING',lines:[
        E('First Mortgage',896.81,1),E('Lawn Care',39.61,5),
      ]},
      {id:crypto.randomUUID(),name:'UTILITIES',lines:[
        E('Trash',13.50,1),E('Water',110,2),E('Metro Net',58.68,10),
        {...E('Verizon (2 phones)',200.54,14),cadence:'even'},
        E('Electricity/Gas',225,30),
      ]},
      {id:crypto.randomUUID(),name:'FOOD',lines:[
        E('Groceries',375,1),E('Restaurants',50,1),E('Annie Flex',40,1),E('Chris Flex',40,1),E('School Lunches',31,30),
      ]},
      {id:crypto.randomUUID(),name:'TRANSPORTATION',lines:[
        E('Gas/Oil',300,15),E('License and Taxes',30,15),
      ]},
      {id:crypto.randomUUID(),name:'CLOTHING / RETAIL',lines:[
        E('Clothing',60,1),E('Retail',300,1),
      ]},
      {id:crypto.randomUUID(),name:'MEDICAL/HEALTH',lines:[
        E('Doctor/Chiropractor',230,1),E('Health',10,1),E('Dentist',0,15),E('Dieting/Exercise',8.33,15),E('Life Insurance',91.12,15),
      ]},
      {id:crypto.randomUUID(),name:'PERSONAL',lines:[
        E('Toiletries',130,1),E('Cosmetics',10,15),E('Hair Care',5,17),E('School Supplies',50,17),
      ]},
      {id:crypto.randomUUID(),name:'RECREATION',lines:[
        E('Entertainment',20,1),E('Lake Ann',104,6),E('Sports',270,15),
        E('Kindle Unlimited',0,1),E('Audible',0,6),E('Spotify',21.19,7),E('ChatGPT',20,5),
        E('Amazon Photos',5,15),E('Amazon Prime',12.50,17),E('HBO Max',10,28),
      ]},
      {id:crypto.randomUUID(),name:'TRAVEL',lines:[
        E('Vacation',0,1),E('Travel Reimbursement (work)',0,1),
      ]},
    ]
  };
}

// state/cursor/view are declared in the bootstrap wrapper (app.js head)

// Keyword rules: substring (uppercased) -> budget line name. Seeded from real Chase merchants.
// First-match wins, longest keywords first so specifics beat generics.
function defaultRules(){
  return [
    // Subscriptions / recurring -> exact lines
    ['SPOTIFY','Spotify'],['NETFLIX','HBO Max'],['HBOMAX','HBO Max'],['HBO MAX','HBO Max'],
    ['OPENAI','ChatGPT'],['CHATGPT','ChatGPT'],['KINDLE','Kindle Unlimited'],['AUDIBLE','Audible'],
    ['PRIME VIDEO','Amazon Prime'],['AMAZON PRIME','Amazon Prime'],
    ['STEAM','Entertainment'],['XBOX','Entertainment'],['MICROSOFT*XBOX','Entertainment'],['SNOW.COM','Entertainment'],['VAIL RESORT','Entertainment'],['STEAMGAMES','Entertainment'],
    // Charitable / giving
    ['COMPASSION','Compassion'],['LAKEANN','Lake Ann'],['LAKE ANN','Lake Ann'],
    ['KEYSTONE CHURCH','Tithe'],['FIRST FAMILY CHURCH','Tithe'],['CHRISTIANBOOK','Giving'],
    // Insurance / utilities
    ['USAA','Life Insurance'],['VERIZON','Verizon (2 phones)'],['METRO NET','Metro Net'],
    // Gas / transportation
    ['WAWA','Gas/Oil'],['CASEYS','Gas/Oil'],['QT ','Gas/Oil'],['PILOT','Gas/Oil'],['GULF OIL','Gas/Oil'],['KWIK','Gas/Oil'],['CASEY','Gas/Oil'],
    // Groceries (incl. warehouse stores — usually groceries + toiletries)
    ['ALDI','Groceries'],['HY-VEE','Groceries'],['FAREWAY','Groceries'],['WM SUPERCENTER','Groceries'],['WAL-MART','Groceries'],['WALMART','Groceries'],
    ['SAMS CLUB','Groceries'],['SAMSCLUB','Groceries'],['COSTCO','Groceries'],
    // Amazon -> all Retail
    ['AMAZON','Retail'],['AMZN','Retail'],
    // Health
    ['CORE PHYSICAL THERAPY','Doctor/Chiropractor'],['LS HI TEMPO','Doctor/Chiropractor'],['HI TEMPO','Doctor/Chiropractor'],
    ['SARAH ANDREWS','Health'],['IOWA RADIOLOGY','Health'],['WALGREENS','Health'],['UPH ','Health'],['PHARM','Health'],['LMFT','Health'],
    // Education / kids
    ['GRANDVIEW CHRISTIAN','School Supplies'],['GRAND VIEW CHRISTIAN','School Supplies'],['SCHOOL PACK','School Supplies'],['EPI','School Supplies'],
    // Sports / recreation
    ['SCHEELS','Sports'],['IAHSAA','Sports'],['URBAN AIR','Sports'],['IOWA STATE FAIR','Sports'],
    // Personal
    ['SP PIERCEDCO','Cosmetics'],['COSME','Cosmetics'],['SHEIN','Clothing'],['AZAZIE','Clothing'],['KOHL','Clothing'],['FIVE BELOW','Retail'],
    // Home
    ['HOME DEPOT','Retail'],['HOMEDEPOT','Retail'],['ANKENY HARDWARE','Retail'],['MODERN MECHANICAL','Retail'],
    // Catch-alls for dining
    ['SUBWAY','Restaurants'],['WENDYS','Restaurants'],['CULVERS','Restaurants'],['JIMMY JOHNS','Restaurants'],
    ['PIZZA','Restaurants'],['SMOKEY ROW','Restaurants'],['PANERA','Restaurants'],['CARL','Restaurants'],
    ['ICE CREAM','Restaurants'],['GYROS','Restaurants'],['FRIES','Restaurants'],['ROAST PORK','Restaurants'],
    ['RITA','Restaurants'],['ROUTE 66','Restaurants'],['CHICKIE','Restaurants'],['BAO','Restaurants'],
    ['CREPES','Restaurants'],['BREWHOUSE','Restaurants'],['BURGERS','Restaurants'],['TST*','Restaurants'],['SQ *','Restaurants'],['COLDSTONE','Restaurants'],['LITTLE CAESARS','Restaurants'],['BUTTERBEER','Restaurants'],
    ['WDW','Restaurants'],['B-BOP','Restaurants'],['SICKIES','Restaurants'],['KAMAL','Restaurants'],
  ];
}
function getRules(){ if(!state.rules)state.rules=defaultRules().map(r=>[r[0],r[1],'chase']); return state.rules; }
function getTrips(){ if(!state.trips)state.trips=[]; return state.trips; }

// Checking-account rules (US Bank). Maps the bank's payee names to budget lines.
// Income/transfers handled specially in buildActuals; these are for direct-from-checking spending.
function checkingRules(){
  return [
    ['US BANK HOME MTG','First Mortgage'],['HOME MTG','First Mortgage'],
    ['METRO FIBERNET','Metro Net'],['VERIZON','Verizon (2 phones)'],['MIDAMERICAN','Electricity/Gas'],
    ['POLK COUNTY','Real Estate Taxes'],['BB TUITION','School Supplies'],['TUITION','School Supplies'],
    ['KEYSTONE CHURCH','Tithe'],['RAISERIGHT','Groceries'],['IOWA REGULAR','License and Taxes'],
  ];
}
// load() handled by bootstrap (loadState from data.js)
function save(){ scheduleSave(state); }
function monthKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function monthName(k){const[y,m]=k.split('-').map(Number);return new Date(y,m-1,1).toLocaleString('en-US',{month:'long',year:'numeric'});}
function monAbbr(k){const[y,m]=k.split('-').map(Number);return new Date(y,m-1,1).toLocaleString('en-US',{month:'short'});}
function money(n){return '$'+(n<0?'-':'')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function moneyS(n){return '$'+Math.round(n).toLocaleString('en-US');}

function getMonth(){
  return ensureMonth(cursor,true);
}
function cloneMonthTemplate(prior){
  const mm=JSON.parse(JSON.stringify(prior));
  mm.groups=(mm.groups||[]).map(g=>({
    ...g,
    lines:(g.lines||[]).map(l=>({...l,paid:false,actual:null}))
  }));
  mm.oneTime=[];
  mm.imported=[];
  return mm;
}
function hasBudgetLines(m){
  return !!(m&&Array.isArray(m.groups)&&m.groups.some(g=>Array.isArray(g.lines)&&g.lines.length));
}
function defaultBudgetFor(existing={}){
  const fresh=defaultMonth();
  return {
    ...fresh,
    todayBalance: existing.todayBalance ?? fresh.todayBalance,
    oneTime: existing.oneTime || fresh.oneTime,
    imported: existing.imported || fresh.imported,
  };
}
function ensureMonth(key, shouldSave=false){
  if(!state.months[key]){
    const keys=Object.keys(state.months).filter(k=>k<key&&hasBudgetLines(state.months[k])).sort();
    if(keys.length){
      const prior=state.months[keys[keys.length-1]];
      state.months[key]=cloneMonthTemplate(prior);
      state.months[key].todayBalance=endingBalance(prior);
    } else state.months[key]=defaultMonth();
    if(shouldSave) save();
  } else if(!hasBudgetLines(state.months[key])){
    state.months[key]=defaultBudgetFor(state.months[key]);
    if(shouldSave) save();
  }
  if(!state.months[key].imported) state.months[key].imported=[];
  if(!state.months[key].groups) state.months[key].groups=[];
  if(!state.months[key].oneTime) state.months[key].oneTime=[];
  return state.months[key];
}
const flat=m=>m.groups.flatMap(g=>g.lines);
function cadenceActive(l,key=cursor){
  if(!l.cadence||l.cadence==='monthly') return true;
  const month=Number(key.split('-')[1]);
  if(l.cadence==='even') return month%2===0;
  if(l.cadence==='odd') return month%2===1;
  return true;
}
function cadenceLabel(cadence){
  return cadence==='even'?'even months':cadence==='odd'?'odd months':'monthly';
}
function lineAmt(l,key=cursor){return cadenceActive(l,key)?((l.paid&&l.actual!=null)?l.actual:(l.budgeted||0)):0;}
function events(m){
  const evs=flat(m).filter(l=>cadenceActive(l)).map(l=>({day:l.day||1,desc:l.name,grp:l.grp,type:l.type,
    delta:(l.type==='in'?1:-1)*lineAmt(l),ref:l}));
  (m.oneTime||[]).forEach(o=>evs.push({day:o.day||1,desc:o.name,grp:'One-time',type:'out',
    delta:-(o.amount||0),ref:o,oneTime:true}));
  evs.sort((a,b)=>a.day-b.day||(a.type==='in'?-1:1));
  return evs;
}
function endingBalance(m){let b=startBal(m);events(m).forEach(e=>b+=e.delta);return b;}
function lowPoint(m){let b=startBal(m),low={bal:b,idx:-1};events(m).forEach((e,i)=>{b+=e.delta;if(b<low.bal)low={bal:b,idx:i};});return low;}
function sums(m){let inc=0,exp=0,xfer=0;flat(m).forEach(l=>{const a=lineAmt(l);if(l.type==='in')inc+=a;else if(l.type==='xfer')xfer+=a;else exp+=a;});return{inc,exp,xfer};}

// Today's day-of-month, but only if the viewed month is the actual current month
function todayDayFor(cursorKey){
  const now=new Date();
  if(monthKey(now)!==cursorKey) return null; // viewing a different month
  return now.getDate();
}
// Given the user's "balance as of today", derive the implied start-of-month balance.
// start = todayBalance - (sum of all events on days <= today)
function deriveStart(m){
  if(m.todayBalance==null) return null;
  const td=todayDayFor(cursor);
  const cutoff=(td==null)?31:td; // if not current month, treat the entered figure as end-of-month
  let upto=0;
  events(m).forEach(e=>{ if((e.day||1)<=cutoff) upto+=e.delta; });
  return m.todayBalance - upto;
}
function startBal(m){ const d=deriveStart(m); return d==null?0:d; }
function hasAnchor(m){ return m.todayBalance!=null; }

function openModal({title,message,fields=[],confirmText='OK',cancelText='Cancel',danger=false}){
  return new Promise(resolve=>{
    const root=document.getElementById('modalRoot')||document.body;
    const backdrop=document.createElement('div');
    backdrop.className='modal-backdrop';
    const card=document.createElement('div');
    card.className='modal-card';
    const h=document.createElement('h2');
    h.textContent=title;
    card.appendChild(h);
    if(message){
      const p=document.createElement('p');
      p.textContent=message;
      card.appendChild(p);
    }
    const inputs={};
    fields.forEach(f=>{
      const label=document.createElement('label');
      label.className='modal-field';
      const span=document.createElement('span');
      span.textContent=f.label;
      const input=document.createElement('input');
      input.type=f.type||'text';
      input.value=f.value??'';
      input.placeholder=f.placeholder||'';
      input.step=f.step||'';
      input.min=f.min||'';
      input.max=f.max||'';
      label.appendChild(span);
      label.appendChild(input);
      card.appendChild(label);
      inputs[f.name]=input;
    });
    const actions=document.createElement('div');
    actions.className='modal-actions';
    const cancel=cancelText?document.createElement('button'):null;
    if(cancel){
      cancel.type='button';
      cancel.textContent=cancelText;
    }
    const ok=document.createElement('button');
    ok.type='button';
    ok.className=danger?'danger':'primary';
    ok.textContent=confirmText;
    if(cancel)actions.appendChild(cancel);
    actions.appendChild(ok);
    card.appendChild(actions);
    backdrop.appendChild(card);
    root.appendChild(backdrop);
    const close=value=>{backdrop.remove();resolve(value);};
    if(cancel)cancel.addEventListener('click',()=>close(null));
    ok.addEventListener('click',()=>{
      const values={};
      Object.entries(inputs).forEach(([k,input])=>{values[k]=input.value;});
      close(fields.length?values:true);
    });
    backdrop.addEventListener('click',e=>{if(e.target===backdrop)close(null);});
    backdrop.addEventListener('keydown',e=>{
      if(e.key==='Escape')close(null);
      if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))ok.click();
    });
    (Object.values(inputs)[0]||ok).focus();
  });
}
const confirmModal=(title,message,opts={})=>openModal({title,message,confirmText:opts.confirmText||'Confirm',cancelText:opts.cancelText||'Cancel',danger:!!opts.danger});
const noticeModal=(title,message)=>openModal({title,message,confirmText:'OK',cancelText:null});

async function openWhatIf(m){
  const values=await openModal({
    title:'Add What-if Expense',
    message:'Add a temporary expense to see how it changes cash flow.',
    confirmText:'Add Expense',
    fields:[
      {name:'name',label:'Name',placeholder:'New fridge'},
      {name:'amount',label:'Amount',type:'number',value:'0.00',step:'0.01',min:'0'},
      {name:'day',label:'Day of month',type:'number',value:'15',min:'1',max:'31'},
    ],
  });
  if(!values||!values.name.trim())return;
  if(!m.oneTime)m.oneTime=[];
  m.oneTime.push({id:crypto.randomUUID(),name:values.name.trim(),amount:parseFloat(values.amount)||0,day:Math.min(31,Math.max(1,parseInt(values.day)||1))});
  save();renderFlow(m);
}

function render(){
  const m=getMonth();
  document.getElementById('monthLabel').textContent=monthName(cursor);
  document.getElementById('tabFlow').className=view==='flow'?'on':'';
  document.getElementById('tabBudget').className=view==='budget'?'on':'';
  document.getElementById('tabCompare').className=view==='compare'?'on':'';
  document.getElementById('tabTravel').className=view==='travel'?'on':'';
  document.getElementById('flowView').style.display=view==='flow'?'':'none';
  document.getElementById('budgetView').style.display=view==='budget'?'':'none';
  document.getElementById('compareView').style.display=view==='compare'?'':'none';
  document.getElementById('travelView').style.display=view==='travel'?'':'none';
  if(view==='flow')renderFlow(m); else if(view==='budget')renderBudget(m); else if(view==='compare')renderCompare(m); else renderTravel(m);
}

function renderFlow(m){
  const c=document.getElementById('flowView');
  const evs=events(m), low=lowPoint(m), ending=endingBalance(m), s=sums(m);
  const warn=low.bal<0, hasStart=hasAnchor(m);
  const td=todayDayFor(cursor);
  const anchorLabel = td==null ? `Balance · end of ${monAbbr(cursor)}` : `Balance as of today · ${monAbbr(cursor)} ${td}`;
  let html=`<div class="balance-row">
    <div class="bcard"><div class="lbl">${anchorLabel}</div>
      <div class="amt"><input type="number" step="0.01" id="startBal" placeholder="enter balance" value="${hasStart?m.todayBalance:''}"></div></div>
    <div class="bcard low ${warn?'warn':''}"><div class="lbl">Projected low point</div>
      <div class="amt">${money(low.bal)}</div>
      <div class="sub ${warn?'warn':''}">${low.idx>=0?('after '+evs[low.idx].desc+' · '+monAbbr(cursor)+' '+evs[low.idx].day):'start of month'}${warn?' — goes negative!':''}</div></div>
  </div>`;
  html+=`<div class="bcard endcard">
    <div class="row">
      <div class="mini">Income<b style="color:var(--mint)">${moneyS(s.inc)}</b></div>
      <div class="mini">Spending<b>${moneyS(s.exp)}</b></div>
      <div class="mini">To savings<b style="color:var(--blue)">${moneyS(s.xfer)}</b></div>
    </div>
    <div><div class="lbl" style="font-size:.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Projected ending</div>
      <div class="amt" style="font-family:var(--mono);font-size:1.4rem;font-weight:700;text-align:right;color:${ending<0?'var(--red)':'var(--mint)'}">${money(ending)}</div></div>
  </div>`;
  html+=`<div class="legend"><span><i class="dot" style="background:var(--mint)"></i>income</span><span><i class="dot" style="background:var(--amber)"></i>expense</span><span><i class="dot" style="background:var(--blue)"></i>transfer</span></div>`;
  html+=`<div class="flow-head"><span class="h-date">Day</span><span class="h-desc">Item</span><span class="h-delta">Amount</span><span class="h-bal">Balance</span></div>`;
  let bal=startBal(m);
  let todayMarkerDrawn=false;
  evs.forEach((e,i)=>{
    if(td!=null && !todayMarkerDrawn && (e.day||1)>td){
      html+=`<div class="today-divider"><span>today · ${monAbbr(cursor)} ${td} · ${hasStart?money(m.todayBalance):'—'}</span></div>`;
      todayMarkerDrawn=true;
    }
    bal+=e.delta;
    const isLow=i===low.idx;
    const isPast = td!=null && (e.day||1)<=td;
    const sign=e.type==='in'?'+':'−';
    const cls=e.type==='in'?'in':e.type==='xfer'?'xfer':'out';
    const btn = e.oneTime
      ? `<button class="rm-btn" data-rmone="${e.ref.id}" title="Remove what-if">×</button>`
      : '';
    const rid = e.ref.id;
    // one-time rows and regular rows both get inline editing
    const nameEl = `<span class="desc-name" contenteditable spellcheck="false" data-ename="${rid}">${e.oneTime?'⚡ ':''}${e.desc}</span><span class="grp"> · ${e.grp}</span>`;
    const dayEl  = `<input class="flow-day" type="number" min="1" max="31" value="${e.day||1}" data-eday="${rid}" title="Day of month">`;
    const amtEl  = `<input class="flow-amt" type="number" step="0.01" value="${Math.abs(e.delta)||''}" data-eamt="${rid}" data-etype="${e.type}">`;
    html+=`<div class="flow-row ${isLow?'lowpoint':''} ${e.oneTime?'whatif':''} ${isPast?'past':''}" data-row="${i}">
      ${dayEl}
      <span class="desc">${nameEl}</span>
      <span class="delta ${cls}">${amtEl}</span>
      <span class="bal ${bal<0?'neg':''}" data-bal="${i}">${hasStart?money(bal):'—'}</span>
      ${btn}</div>`;
  });
  c.innerHTML=html;
  const addWhatIf=document.createElement('button');
  addWhatIf.className='add-group'; addWhatIf.style.marginTop='10px';
  addWhatIf.textContent='⚡ Add one-time what-if expense';
  addWhatIf.onclick=()=>openWhatIf(m);
  c.appendChild(addWhatIf);
  c.querySelectorAll('[data-rmone]').forEach(b=>b.addEventListener('click',()=>{
    m.oneTime=(m.oneTime||[]).filter(o=>o.id!==b.dataset.rmone);save();renderFlow(m);
  }));

  // Inline edit: name
  c.querySelectorAll('[data-ename]').forEach(el=>{
    el.addEventListener('blur',()=>{
      const id=el.dataset.ename;
      const raw=el.textContent.replace(/^⚡\s*/,'').trim()||'Untitled';
      const ot=(m.oneTime||[]).find(o=>o.id===id);
      if(ot){ot.name=raw;}
      else{const l=flat(m).find(x=>x.id===id);if(l)l.name=raw;}
      save();
    });
    el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();el.blur();}});
  });

  // Inline edit: day — full re-render since sort order may change
  c.querySelectorAll('[data-eday]').forEach(el=>{
    el.addEventListener('change',()=>{
      const id=el.dataset.eday, v=Math.min(31,Math.max(1,parseInt(el.value)||1));
      const ot=(m.oneTime||[]).find(o=>o.id===id);
      if(ot){ot.day=v;}
      else{const l=flat(m).find(x=>x.id===id);if(l)l.day=v;}
      save(); renderFlow(m);
    });
  });

  // Inline edit: amount — update balance live, save on blur
  c.querySelectorAll('[data-eamt]').forEach(el=>{
    el.addEventListener('input',()=>{
      const id=el.dataset.eamt, v=parseFloat(el.value)||0;
      const ot=(m.oneTime||[]).find(o=>o.id===id);
      if(ot){ot.amount=v;}
      else{const l=flat(m).find(x=>x.id===id);if(l)l.budgeted=v;}
      recalcBalances(m);
    });
    el.addEventListener('blur',()=>save());
    el.addEventListener('keydown',e=>{if(e.key==='Enter')el.blur();});
  });
  const sb=document.getElementById('startBal');
  sb.addEventListener('input',e=>{
    m.todayBalance=e.target.value===''?null:(parseFloat(e.target.value)||0);
    recalcBalances(m); // update numbers live, no re-render (keeps focus)
  });
  sb.addEventListener('blur',()=>save());
  sb.addEventListener('keydown',e=>{if(e.key==='Enter')sb.blur();});
}

// Update balance figures + top cards in place, without re-rendering rows (preserves input focus)
function recalcBalances(m){
  const evs=events(m), low=lowPoint(m), ending=endingBalance(m), hasStart=hasAnchor(m);
  let bal=startBal(m);
  evs.forEach((e,i)=>{
    bal+=e.delta;
    const el=document.querySelector(`[data-bal="${i}"]`);
    if(el){ el.textContent=hasStart?money(bal):'—'; el.className='bal'+(bal<0?' neg':''); }
  });
  // top cards
  const lowCard=document.querySelector('.bcard.low');
  if(lowCard){
    const warn=low.bal<0;
    lowCard.className='bcard low'+(warn?' warn':'');
    lowCard.querySelector('.amt').textContent=money(low.bal);
    const sub=lowCard.querySelector('.sub');
    sub.className='sub'+(warn?' warn':'');
    sub.textContent=(low.idx>=0?('after '+evs[low.idx].desc+' · '+monAbbr(cursor)+' '+evs[low.idx].day):'start of month')+(warn?' — goes negative!':'');
  }
  const endAmt=document.querySelector('.endcard .amt');
  if(endAmt){ endAmt.textContent=money(ending); endAmt.style.color=ending<0?'var(--red)':'var(--mint)'; }
  // lowpoint row highlight
  document.querySelectorAll('.flow-row').forEach((r,i)=>{
    r.classList.toggle('lowpoint', i===low.idx);
  });
}

function renderBudget(m){
  const c=document.getElementById('budgetView');
  const s=sums(m);
  let html=`<div class="pool"><div><div class="lbl">Net this month (income − spending − transfers)</div>
    <div class="amt ${(s.inc-s.exp-s.xfer)>0.005?'pos':(s.inc-s.exp-s.xfer)<-0.005?'neg':'zero'}">${money(s.inc-s.exp-s.xfer)}</div>
    <div class="hint">what's left over after everything clears</div></div>
    <div class="totals">Income <b>${moneyS(s.inc)}</b><br>Spending <b>${moneyS(s.exp)}</b><br>Transfers <b>${moneyS(s.xfer)}</b></div></div>`;
  html+=`<div class="src-note">Verizon is modeled as Chris/Annie's 2-phone share: $300.81 ÷ 6 phones × 2 = ${money(100.27)} per month, paid as ${money(200.54)} every other month. Enter Annie's phone stipend as income when you know the amount.</div>`;
  html+=`<div class="colhead"><span class="c-name">Item</span><span class="c-ty">Type</span><span class="c-freq">Frequency</span><span class="c-day">Day</span><span class="c-amt">Amount</span><span class="c-del"></span></div><div>`;
  m.groups.forEach(g=>{
    const gt=g.lines.reduce((a,l)=>a+(l.type==='in'?lineAmt(l):-lineAmt(l)),0);
    html+=`<div class="group"><div class="group-head"><h2 contenteditable spellcheck="false" data-gid="${g.id}">${g.name}</h2><span class="gtot" data-gtot="${g.id}">${money(gt)}</span></div>`;
    g.lines.forEach(l=>{
      const ty=t=>`<option value="${t}" ${l.type===t?'selected':''}>${t==='in'?'income':t==='xfer'?'transfer':'expense'}</option>`;
      const fq=f=>`<option value="${f}" ${(l.cadence||'monthly')===f?'selected':''}>${cadenceLabel(f)}</option>`;
      html+=`<div class="line"><span class="lname" contenteditable spellcheck="false" data-lid="${l.id}">${l.name}</span>
        <select class="ty" data-tyof="${l.id}">${ty('out')}${ty('in')}${ty('xfer')}</select>
        <select class="freq" data-freqof="${l.id}">${fq('monthly')}${fq('even')}${fq('odd')}</select>
        <input class="day" type="number" min="1" max="31" value="${l.day||1}" data-dayof="${l.id}">
        <input class="amt" type="number" step="0.01" value="${l.budgeted||''}" placeholder="0.00" data-budof="${l.id}">
        <button class="del" data-delof="${l.id}">×</button></div>`;
    });
    html+=`<button class="add-line" data-addto="${g.id}">+ line</button></div>`;
  });
  html+=`</div><button class="add-group" id="addGroup">+ Add category group</button>`;
  c.innerHTML=html;
  c.querySelectorAll('[data-gid]').forEach(el=>el.addEventListener('blur',()=>{m.groups.find(g=>g.id===el.dataset.gid).name=el.textContent.trim()||'GROUP';save();}));
  c.querySelectorAll('[data-lid]').forEach(el=>el.addEventListener('blur',()=>{const l=flat(m).find(x=>x.id===el.dataset.lid);if(l){l.name=el.textContent.trim()||'Untitled';save();}}));
  c.querySelectorAll('[data-tyof]').forEach(el=>el.addEventListener('change',()=>{const l=flat(m).find(x=>x.id===el.dataset.tyof);if(l){l.type=el.value;save();renderBudget(m);}}));
  c.querySelectorAll('[data-freqof]').forEach(el=>el.addEventListener('change',()=>{const l=flat(m).find(x=>x.id===el.dataset.freqof);if(l){l.cadence=el.value;save();renderBudget(m);}}));
  c.querySelectorAll('[data-dayof]').forEach(el=>el.addEventListener('input',()=>{const l=flat(m).find(x=>x.id===el.dataset.dayof);if(l){l.day=Math.min(31,Math.max(1,parseInt(el.value)||1));save();}}));
  c.querySelectorAll('[data-budof]').forEach(el=>{
    el.addEventListener('input',()=>{
      const l=flat(m).find(x=>x.id===el.dataset.budof);
      if(l){l.budgeted=parseFloat(el.value)||0;refreshBudgetTotals(m);}
    });
    el.addEventListener('blur',()=>save());
    el.addEventListener('keydown',e=>{if(e.key==='Enter')el.blur();});
  });
  c.querySelectorAll('[data-delof]').forEach(el=>el.addEventListener('click',()=>{m.groups.forEach(g=>g.lines=g.lines.filter(x=>x.id!==el.dataset.delof));save();renderBudget(m);}));
  c.querySelectorAll('[data-addto]').forEach(el=>el.addEventListener('click',()=>{const g=m.groups.find(g=>g.id===el.dataset.addto);g.lines.push({id:crypto.randomUUID(),name:'New line',budgeted:0,day:1,grp:g.name,type:'out',cadence:'monthly',paid:false,actual:null});save();renderBudget(m);}));
  document.getElementById('addGroup').addEventListener('click',()=>{m.groups.push({id:crypto.randomUUID(),name:'NEW GROUP',lines:[]});save();renderBudget(m);});
}
function refreshBudgetTotals(m){
  const s=sums(m), net=s.inc-s.exp-s.xfer;
  const pool=document.querySelector('#budgetView .pool');
  if(pool){
    const amt=pool.querySelector('.amt');
    if(amt){
      amt.textContent=money(net);
      amt.className='amt '+(net>0.005?'pos':net<-0.005?'neg':'zero');
    }
    const totals=pool.querySelector('.totals');
    if(totals)totals.innerHTML=`Income <b>${moneyS(s.inc)}</b><br>Spending <b>${moneyS(s.exp)}</b><br>Transfers <b>${moneyS(s.xfer)}</b>`;
  }
  (m.groups||[]).forEach(g=>{
    const el=document.querySelector(`[data-gtot="${g.id}"]`);
    if(el){
      const gt=(g.lines||[]).reduce((a,l)=>a+(l.type==='in'?lineAmt(l):-lineAmt(l)),0);
      el.textContent=money(gt);
    }
  });
}

// ---------- CSV IMPORT + COMPARE ----------
function parseCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  const out=[];
  const split=(line)=>{const res=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){q=!q;}else if(ch===','&&!q){res.push(cur);cur='';}else cur+=ch;}res.push(cur);return res;};
  const header=split(lines[0]).map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase());
  const has=(name)=>header.indexOf(name)>=0;
  // Detect format: US Bank checking has Transaction + Name columns; Chase has "Transaction Date" + "Description"
  const isUSBank = has('name') && has('transaction') && !has('description');
  let source = isUSBank ? 'usbank' : 'chase';
  const idx=(name)=>header.indexOf(name);
  if(isUSBank){
    const iDate=idx('date'), iTrans=idx('transaction'), iName=idx('name'), iMemo=idx('memo'), iAmt=idx('amount');
    for(let i=1;i<lines.length;i++){
      const c=split(lines[i]).map(x=>x.replace(/^"|"$/g,''));
      if(c.length<=iAmt)continue;
      const amt=parseFloat(c[iAmt]); if(isNaN(amt))continue;
      // US Bank: 'Name' is the real description; if Transaction is a check number, Name is "CHECK"
      let desc=(c[iName]||'').trim();
      const trans=(c[iTrans]||'').trim();
      if(/^\d+$/.test(trans)) desc='CHECK #'+trans+(desc&&desc!=='CHECK'?' '+desc:'');
      // ISO date YYYY-MM-DD -> keep, we'll parse both formats later
      out.push({date:c[iDate],desc:desc.replace(/&amp;/gi,'&').trim(),type:amt>=0?'Credit':'Sale',amount:amt,source:'usbank'});
    }
  } else {
    const iDate=has('transaction date')?idx('transaction date'):idx('date');
    const iDesc=idx('description'), iAmt=idx('amount'), iType=idx('type');
    for(let i=1;i<lines.length;i++){
      const c=split(lines[i]); if(c.length<=iAmt)continue;
      const amt=parseFloat(c[iAmt]); if(isNaN(amt))continue;
      out.push({date:c[iDate],desc:(c[iDesc]||'').replace(/&amp;/gi,'&').trim(),type:(c[iType]||'').trim(),amount:amt,source:'chase'});
    }
  }
  out._source=source;
  return out;
}
function categorize(desc, source){
  const D=desc.toUpperCase();
  if(source==='usbank'){
    // Income / transfers we recognize and handle separately (return special tokens)
    if(/JOINT TECHNOLOGY|RAKER RHODES|ELECTRONIC DEPOSIT LPL|IRS\s+TREAS|IASTTAXRFD|MOBILE CHECK DEPOSIT|ELECTRONIC DEPOSIT VENMO|ELECTRONIC DEPOSIT AVAIL|USAA P&C/.test(D)) return '__INCOME__';
    if(/CHASE CREDIT CRD/.test(D)) return '__CARDPAY__'; // card payment — skip, card detail covers it
    if(/ELECTRONIC WITHDRAWAL LPL/.test(D)) return 'Retirement Fund'; // retirement transfer
    if(/MAINTENANCE FEE|SALES TAX|INTEREST PAID|MOBILE BANKING TRANSFER|CUSTOMER WITHDRAWAL|SPLITWISE|ZELLE|VENMO/.test(D)) return '__SKIP__';
    // hardcoded checking rules + any persisted user rules tagged 'usbank'
    const userUsbank=(getRules()||[]).filter(r=>r[2]==='usbank');
    const rules=[...checkingRules(),...userUsbank].sort((a,b)=>b[0].length-a[0].length);
    for(const [kw,line] of rules){ if(D.includes(kw.toUpperCase())) return line; }
    return null;
  }
  // Chase: only rules tagged 'chase' (or untagged legacy)
  const rules=[...getRules()].filter(r=>!r[2]||r[2]==='chase').sort((a,b)=>b[0].length-a[0].length);
  for(const [kw,line] of rules){ if(D.includes(kw.toUpperCase())) return line; }
  return null;
}
// Aggregate imported transactions for the current month into actual spend per budget line
function buildActuals(m){
  const txns=(m.imported||[]);
  const byLine={}; const uncategorized=[]; let workTravel=0, income=0, skipped=0;
  txns.forEach(t=>{
    if(t.type==='Payment') return;
    const spend=-t.amount;
    if(t.workTravel){ workTravel+=spend; return; }
    const line=t.cat!==undefined?t.cat:categorize(t.desc,t.source);
    if(line==='__INCOME__'){ income+=t.amount; return; }
    if(line==='__CARDPAY__'||line==='__SKIP__'){ skipped+=spend; return; }
    if(!line){ uncategorized.push(t); return; }
    byLine[line]=(byLine[line]||0)+spend;
  });
  return {byLine,uncategorized,count:txns.length,workTravel,income,skipped};
}

// Travel detection: scan imported txns for travel-signal merchants, cluster by date proximity
const TRAVEL_SIGNALS=['UNITED','DELTA','AMERICAN AIR','SOUTHWEST','FRONTIER','ALLEGIANT','HILTON','MARRIOTT','HYATT','HOTEL','AIRBNB','VRBO',
  'WDW','DISNEY','UNIVERSAL','EPIC PARKING','EPIC ','SNOW.COM','VAIL','BRECKENRIDGE','RESORT','LIGHTNING LANE','PARKING','RENTAL CAR','HERTZ','ENTERPRISE','AVIS',
  'MYSTIC DUNES','BUTTERBEER','OLLIVANDERS','WEASLEYS','HULK','MAGIC CASTLE','MAGICAL MENAGE','WIZARDING','PLTPAYWEB','KTA WEB','UNIV PARKING','TUTTO ITALIA'];
function looksTravel(desc){
  const D=desc.toUpperCase();
  return TRAVEL_SIGNALS.some(s=>D.includes(s));
}
function parseMDY(s){
  s=(s||'').trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)){const p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
  const p=s.split('/');if(p.length<3)return null;return new Date(+p[2],+p[0]-1,+p[1]);
}
function detectTripClusters(m){
  const flagged=(m.imported||[]).filter(t=>looksTravel(t.desc)&&t.type!=='Payment'&&t.amount<0)
    .map(t=>({...t,d:parseMDY(t.date)})).filter(t=>t.d).sort((a,b)=>a.d-b.d);
  const clusters=[]; let cur=[];
  for(const t of flagged){
    if(!cur.length){cur=[t];continue;}
    const gap=(t.d-cur[cur.length-1].d)/86400000;
    if(gap<=4){cur.push(t);} else {clusters.push(cur);cur=[t];}
  }
  if(cur.length)clusters.push(cur);
  return clusters.filter(c=>c.length>=3||c.reduce((s,t)=>s+(-t.amount),0)>200)
    .map(c=>({start:c[0].d,end:c[c.length-1].d,total:c.reduce((s,t)=>s+(-t.amount),0),count:c.length,txns:c}));
}
function fmtDate(d){return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}

function renderCompare(m){
  const c=document.getElementById('compareView');
  const txns=m.imported||[];
  if(!txns.length){
    c.innerHTML=`<div style="text-align:center;padding:30px 16px">
      <div style="font-size:.9rem;color:var(--text-dim);margin-bottom:16px;line-height:1.6">
        Upload Chase card or US Bank checking CSVs to compare actual spending against your budget.<br>
        Files may include multiple months; transactions will be placed in the right month automatically.</div>
      <label class="add-group" style="cursor:pointer;display:inline-block;max-width:280px">
        ⬆ Choose CSV file
        <input type="file" id="csvFile" accept=".csv,.CSV" style="display:none">
      </label></div>`;
    document.getElementById('csvFile').addEventListener('change',handleCSV);
    return;
  }
  const {byLine,uncategorized,workTravel,income,skipped}=buildActuals(m);
  const trips=detectTripClusters(m);
  // Build comparison: for each budget line that's an expense, show budgeted vs actual
  const groups=m.groups.map(g=>{
    const lines=g.lines.filter(l=>l.type!=='in').map(l=>{
      const actual=byLine[l.name]||0;
      const budgeted=lineAmt(l);
      return {name:l.name,budgeted,actual,delta:budgeted-actual};
    }).filter(l=>l.budgeted>0||l.actual>0);
    const gb=lines.reduce((s,l)=>s+l.budgeted,0), ga=lines.reduce((s,l)=>s+l.actual,0);
    return {name:g.name,lines,gb,ga};
  }).filter(g=>g.lines.length);

  const totalBud=groups.reduce((s,g)=>s+g.gb,0), totalAct=groups.reduce((s,g)=>s+g.ga,0);

  let html=`<div class="cmp-summary">
    <div class="cmp-stat"><div class="k">Budgeted</div><div class="v">${moneyS(totalBud)}</div></div>
    <div class="cmp-stat"><div class="k">Actual spent</div><div class="v">${moneyS(totalAct)}</div></div>
    <div class="cmp-stat"><div class="k">Difference</div><div class="v" style="color:${totalBud-totalAct>=0?'var(--mint)':'var(--red)'}">${money(totalBud-totalAct)}</div></div>
  </div>`;

  if(workTravel>0){
    html+=`<div class="travel-note">↩ ${money(workTravel)} tagged as work travel — netted out of spending (reimbursable).</div>`;
  }

  // Trip detection banner — cross-reference logged trips
  if(trips.length){
    html+=`<div class="trip-banner"><div class="tb-head">✈ Possible trips detected</div>`;
    trips.forEach((tr,ti)=>{
      // does this cluster fall within a logged trip?
      const logged=getTrips().find(lt=>{
        if(!lt.start)return false;
        const s=new Date(lt.start+'T00:00'), e=new Date((lt.end||lt.start)+'T00:00');
        return tr.start<=e && tr.end>=s; // overlap
      });
      const match = logged?`<span class="tb-match ${logged.kind}">↳ ${logged.name} (${logged.kind})</span>`:'';
      html+=`<div class="trip-row">
        <div class="trip-info"><b>${fmtDate(tr.start)} – ${fmtDate(tr.end)}</b> · ${tr.count} charges · ${money(tr.total)} ${match}</div>
        <div class="trip-actions">
          <button class="tb-btn" data-trip="${ti}" data-as="Vacation">Tag vacation</button>
          <button class="tb-btn work" data-trip="${ti}" data-as="work">Tag work (reimburse)</button>
        </div></div>`;
    });
    html+=`<div class="tb-hint">Tagging assigns every charge in the window. Work travel nets out of spending; vacation goes to your Travel → Vacation line. Log trips in the Travel tab to auto-match.</div></div>`;
  }

  html+=`<div class="cmp-bar-head"><span>Category</span><span>Budget → Actual</span></div>`;
  groups.forEach(g=>{
    const over=g.ga>g.gb;
    html+=`<div class="cmp-group">
      <div class="cmp-ghead"><span>${g.name}</span><span class="${over?'over':'ok'}">${money(g.ga)} / ${money(g.gb)}</span></div>`;
    g.lines.forEach(l=>{
      const pct=l.budgeted>0?Math.min(100,(l.actual/l.budgeted)*100):(l.actual>0?100:0);
      const lo=l.actual>l.budgeted;
      html+=`<div class="cmp-line">
        <span class="cl-name">${l.name}</span>
        <div class="cl-track"><div class="cl-fill" style="width:${pct}%;background:${lo?'var(--red)':'var(--amber)'}"></div></div>
        <span class="cl-nums ${lo?'over':''}">${money(l.actual)} / ${money(l.budgeted)}</span>
      </div>`;
    });
    html+=`</div>`;
  });
  if(uncategorized.length){
    const utot=uncategorized.reduce((s,t)=>s+(-t.amount),0);
    html+=`<div class="cmp-group"><div class="cmp-ghead"><span>UNCATEGORIZED (${uncategorized.length})</span><span>${money(utot)}</span></div>
      <div style="font-size:.74rem;color:var(--text-dim);padding:4px 4px 8px">These didn't match a rule. Assign them and the app will remember:</div>`;
    uncategorized.slice(0,40).forEach((t,i)=>{
      const opts=m.groups.flatMap(g=>g.lines).filter(l=>l.type!=='in').map(l=>`<option value="${l.name}">${l.name}</option>`).join('');
      html+=`<div class="cmp-line"><span class="cl-name" title="${t.desc}">${t.desc}</span>
        <span class="cl-nums">${money(-t.amount)}</span>
        <select class="cl-assign" data-desc="${encodeURIComponent(t.desc)}"><option value="">— assign —</option>${opts}</select></div>`;
    });
    html+=`</div>`;
  }
  // Source summary + skipped/income info
  const sources=[...new Set((m.imported||[]).map(t=>t.source||'chase'))];
  const srcLabel=sources.map(s=>s==='usbank'?'US Bank checking':'Chase card').join(' + ');
  html+=`<div class="src-note">Imported: ${srcLabel} · ${(m.imported||[]).length} transactions`;
  if(income>0)html+=` · ${moneyS(income)} income detected`;
  if(skipped>0)html+=` · ${moneyS(skipped)} transfers/fees skipped`;
  html+=`</div>`;

  // If Chase card data present, compute net card charges and offer to set the Credit Card Payment line
  const cardTxns=(m.imported||[]).filter(t=>(t.source||'chase')==='chase'&&t.type!=='Payment');
  if(cardTxns.length){
    const cardNet=cardTxns.reduce((s,t)=>s-t.amount,0); // positive = net charged this month
    const ccLine=flat(m).find(l=>l.name==='Credit Card Payment');
    const cur=ccLine?ccLine.budgeted:0;
    html+=`<div class="cc-suggest">
      <div>Card charges imported this month: <b>${money(cardNet)}</b><br>
      <span class="cc-sub">This is what'll hit checking when you pay the card. Currently your Credit Card Payment line is set to ${money(cur)}.</span></div>
      <button class="cc-btn" id="setCCPay" data-amt="${cardNet.toFixed(2)}">Set payment → ${money(cardNet)}</button>
    </div>`;
  }

  // Review-all panel (collapsed by default)
  html+=`<button class="add-group" id="toggleReview" style="margin-top:14px">🔍 Review all parsed transactions (${(m.imported||[]).length})</button>
    <div id="reviewPanel" style="display:none"></div>`;

  html+=`<div style="display:flex;gap:8px;margin-top:12px">
    <label class="add-group" style="cursor:pointer;flex:1;text-align:center">⬆ Import CSV across months<input type="file" id="csvFile" accept=".csv,.CSV" style="display:none"></label>
    <button class="add-group" id="clearCsv" style="flex:1">Clear all imports</button></div>`;
  c.innerHTML=html;

  document.getElementById('toggleReview').addEventListener('click',()=>{
    const p=document.getElementById('reviewPanel');
    if(p.style.display==='none'){ p.innerHTML=buildReviewHTML(m); p.style.display=''; wireReview(m,p); }
    else p.style.display='none';
  });
  const ccBtn=document.getElementById('setCCPay');
  if(ccBtn)ccBtn.addEventListener('click',()=>{
    const ccLine=flat(m).find(l=>l.name==='Credit Card Payment');
    if(ccLine){ ccLine.budgeted=parseFloat(ccBtn.dataset.amt)||0; save(); renderCompare(m); }
  });
  const csvInput=document.getElementById('csvFile');
  if(csvInput)csvInput.addEventListener('change',handleCSV);
  const clearBtn=document.getElementById('clearCsv');
  if(clearBtn)clearBtn.addEventListener('click',async()=>{
    const ok=await confirmModal('Clear Imports',`Clear all imported transactions for ${monthName(cursor)}?`,{confirmText:'Clear Imports',danger:true});
    if(!ok)return;
    m.imported=[];
    await deleteTxns(cursor);
    save();renderCompare(m);
  });
  // Trip tagging
  c.querySelectorAll('.tb-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const tr=trips[+btn.dataset.trip], as=btn.dataset.as;
    tr.txns.forEach(tx=>{
      const orig=(m.imported||[]).find(t=>t.desc===tx.desc&&t.date===tx.date&&t.amount===tx.amount);
      if(!orig)return;
      if(as==='work'){ orig.workTravel=true; orig.cat=undefined; }
      else { orig.cat='Vacation'; orig.workTravel=false; }
    });
    save();renderCompare(m);
  }));
  c.querySelectorAll('.cl-assign').forEach(sel=>sel.addEventListener('change',()=>{
    const desc=decodeURIComponent(sel.dataset.desc), line=sel.value;
    if(!line)return;
    const kw=desc.toUpperCase().replace(/[^A-Z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>=4)[0]||desc.toUpperCase();
    // tag rule with the source of the matching transaction(s)
    const match=(m.imported||[]).find(t=>t.desc===desc);
    const src=match?(match.source||'chase'):'chase';
    getRules().unshift([kw,line,src]);
    (m.imported||[]).forEach(t=>{ if(t.desc.toUpperCase().includes(kw)) t.cat=line; });
    save();renderCompare(m);
  }));
}

function txnMonthKey(dateStr){
  // handles MM/DD/YYYY (Chase) and YYYY-MM-DD (US Bank)
  const s=(dateStr||'').trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)){ const p=s.split('-'); return p[0]+'-'+p[1]; }
  const p=s.split('/'); if(p.length<3)return null;
  return p[2]+'-'+String(parseInt(p[0])).padStart(2,'0');
}
function normTxnDate(dateStr){
  const s=(dateStr||'').trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const p=s.split('/'); if(p.length<3)return s;
  return `${p[2]}-${String(parseInt(p[0])).padStart(2,'0')}-${String(parseInt(p[1])).padStart(2,'0')}`;
}
function txnKey(t){
  const source=t.source||'chase';
  const date=normTxnDate(t.date);
  const desc=(t.desc||'').toUpperCase().replace(/\s+/g,' ').trim();
  const amount=Number(t.amount||0).toFixed(2);
  const type=(t.type||'').toUpperCase().trim();
  return [source,date,desc,amount,type].join('|');
}
function mergeImported(existingRows,newRows){
  const byKey=new Map();
  for(const row of existingRows||[]) byKey.set(txnKey(row), row);
  let added=0, updated=0;
  for(const row of newRows){
    const key=txnKey(row);
    const prior=byKey.get(key);
    if(prior){
      byKey.set(key,{
        ...prior,
        ...row,
        _id:prior._id,
        cat:prior.cat!==undefined?prior.cat:row.cat,
        workTravel:prior.workTravel!==undefined?prior.workTravel:row.workTravel,
      });
      updated++;
    } else {
      byKey.set(key,row);
      added++;
    }
  }
  return {rows:[...byKey.values()],added,updated};
}
function normalizeImportedState(){
  const duplicateIds=[];
  for(const m of Object.values(state.months||{})){
    const byKey=new Map();
    for(const row of m.imported||[]){
      const key=txnKey(row);
      const prior=byKey.get(key);
      if(prior){
        if(row._id) duplicateIds.push(row._id);
        byKey.set(key,{
          ...prior,
          cat:prior.cat!==undefined?prior.cat:row.cat,
          workTravel:prior.workTravel||row.workTravel,
          _id:prior._id||row._id,
        });
      } else byKey.set(key,row);
    }
    m.imported=[...byKey.values()];
  }
  return duplicateIds;
}
function normalizeRetirementFundLines(){
  let changed=false;
  for(const m of Object.values(state.months||{})){
    for(const g of m.groups||[]){
      if(g.name!=='SAVINGS / TRANSFERS') continue;
      const retirementLines=(g.lines||[]).filter(l=>/^Retirement Fund( \(\d+\))?$/.test(l.name||''));
      if(retirementLines.length<=1 && retirementLines[0]?.name==='Retirement Fund') continue;
      const first=retirementLines[0];
      const merged={
        ...(first||{}),
        id:first?.id||crypto.randomUUID(),
        name:'Retirement Fund',
        budgeted:retirementLines.length?retirementLines.reduce((sum,l)=>sum+(Number(l.budgeted)||0),0):2000,
        day:first?.day||2,
        grp:g.name,
        type:'xfer',
        paid:false,
        actual:null,
      };
      if(Math.abs(merged.budgeted-4500)<0.01) merged.budgeted=2000;
      g.lines=[merged,...(g.lines||[]).filter(l=>!/^Retirement Fund( \(\d+\))?$/.test(l.name||''))];
      changed=true;
    }
  }
  return changed;
}
function normalizePhoneLines(){
  let changed=false;
  for(const m of Object.values(state.months||{})){
    const incomeGroup=(m.groups||[]).find(g=>g.name==='INCOME');
    if(incomeGroup && !(incomeGroup.lines||[]).some(l=>l.name==='Annie Phone Stipend')){
      incomeGroup.lines.push({id:crypto.randomUUID(),name:'Annie Phone Stipend',budgeted:0,day:15,grp:'INCOME',type:'in',cadence:'monthly',paid:false,actual:null});
      changed=true;
    }
    const utilities=(m.groups||[]).find(g=>g.name==='UTILITIES');
    if(!utilities) continue;
    for(const line of utilities.lines||[]){
      if(line.name==='Verizon'||line.name==='Verizon Wireless'||line.name==='Verizon (phones)'){
        line.name='Verizon (2 phones)';
        line.budgeted=200.54;
        line.cadence=line.cadence||'even';
        line.day=line.day||14;
        changed=true;
      }
      if(line.name==='Verizon (2 phones)' && !line.cadence){
        line.cadence='even';
        changed=true;
      }
    }
  }
  return changed;
}
function lineKey(name){
  return String(name||'').trim().toLowerCase();
}
function normalizeBudgetTemplate(){
  let changed=false;
  const template=defaultMonth();
  for(const m of Object.values(state.months||{})){
    if(!hasBudgetLines(m)) continue;
    const nextGroups=[];
    const existingGroups=new Map((m.groups||[]).map(g=>[lineKey(g.name),g]));
    for(const tg of template.groups){
      const eg=existingGroups.get(lineKey(tg.name))||{id:crypto.randomUUID(),name:tg.name,lines:[]};
      const used=new Set();
      const existingLines=new Map();
      for(const l of eg.lines||[]) existingLines.set(lineKey(l.name),l);
      const nextLines=[];
      for(const tl of tg.lines||[]){
        let el=existingLines.get(lineKey(tl.name));
        if(!el && tl.name==='Retirement Fund'){
          el=(eg.lines||[]).find(l=>/^Retirement Fund( \(\d+\))?$/.test(l.name||''));
        }
        if(el) used.add(el.id);
        nextLines.push({
          ...(el||{}),
          id:el?.id||crypto.randomUUID(),
          name:tl.name,
          budgeted:tl.budgeted,
          day:tl.day,
          grp:tg.name,
          type:tl.type,
          cadence:tl.cadence||'monthly',
          paid:el?.paid||false,
          actual:el?.actual??null,
        });
        if(!el) changed=true;
        else if(el.name!==tl.name||el.budgeted!==tl.budgeted||el.day!==tl.day||el.grp!==tg.name||el.type!==tl.type||(el.cadence||'monthly')!==(tl.cadence||'monthly')) changed=true;
      }
      for(const el of eg.lines||[]){
        if(!used.has(el.id)&&!/^Retirement Fund( \(\d+\))?$/.test(el.name||'')){
          nextLines.push({...el,grp:tg.name,cadence:el.cadence||'monthly'});
        } else if(/^Retirement Fund( \(\d+\))?$/.test(el.name||'')&&!nextLines.some(l=>l.id===el.id)){
          changed=true;
        }
      }
      nextGroups.push({...eg,name:tg.name,lines:nextLines});
    }
    for(const g of m.groups||[]){
      if(!existingGroups.has(lineKey(g.name))) continue;
      if(!template.groups.some(tg=>lineKey(tg.name)===lineKey(g.name))){
        nextGroups.push(g);
      }
    }
    if(JSON.stringify(m.groups)!==JSON.stringify(nextGroups)){
      m.groups=nextGroups;
      changed=true;
    }
  }
  return changed;
}
function handleCSV(e){
  const file=e.target.files[0]; if(!file)return;
  const reader=new FileReader();
  reader.onload=async()=>{
    const all=parseCSV(reader.result);
    const src=all._source||'chase';
    const byMonth=new Map();
    all.forEach(t=>{
      const mk=txnMonthKey(t.date);
      if(!mk) return;
      if(!byMonth.has(mk)) byMonth.set(mk,[]);
      byMonth.get(mk).push(t);
    });
    let added=0, updated=0, skipped=all.length;
    const touched=[...byMonth.keys()].sort();
    for(const mk of touched){
      const m=ensureMonth(mk);
      const merged=mergeImported(m.imported||[],byMonth.get(mk));
      m.imported=merged.rows;
      added+=merged.added;
      updated+=merged.updated;
      skipped-=byMonth.get(mk).length;
    }
    const dupes=normalizeImportedState();
    if(dupes.length) await deleteTxnIds(dupes);
    save();
    await flushSave(state);
    if(!touched.includes(cursor) && touched.length) cursor=touched[touched.length-1];
    view='compare';
    render();
    const msg=`Imported ${added} new and matched ${updated} existing ${src==='usbank'?'US Bank':'Chase'} transactions across ${touched.length} month${touched.length===1?'':'s'}${skipped?`; skipped ${skipped} rows without usable dates`:''}.`;
    setTimeout(()=>noticeModal('Import Complete',msg),0);
  };
  reader.readAsText(file);
}

function reviewSortState(panel=document.getElementById('reviewPanel')){
  const sort=panel?.dataset.sort||'date';
  const dir=panel?.dataset.dir||'desc';
  return {sort,dir};
}
function reviewCategory(t){
  return t.cat!==undefined?t.cat:categorize(t.desc,t.source);
}
function reviewCategoryLabel(t){
  const cat=reviewCategory(t);
  if(t.workTravel)return 'work travel';
  if(cat==='__INCOME__')return 'income';
  if(cat==='__CARDPAY__')return 'card payment';
  if(cat==='__SKIP__')return 'transfer/fee';
  return cat||'none';
}
function sortedReviewTxns(m,panel=document.getElementById('reviewPanel')){
  const {sort,dir}=reviewSortState(panel);
  const mult=dir==='asc'?1:-1;
  const val=t=>{
    if(sort==='src')return t.source||'chase';
    if(sort==='date')return parseMDY(t.date)||0;
    if(sort==='desc')return (t.desc||'').toUpperCase();
    if(sort==='amount')return Number(t.amount)||0;
    if(sort==='cat')return reviewCategoryLabel(t).toUpperCase();
    return '';
  };
  return (m.imported||[]).slice().sort((a,b)=>{
    const av=val(a), bv=val(b);
    if(av<bv)return -1*mult;
    if(av>bv)return 1*mult;
    return ((a.desc||'').localeCompare(b.desc||''))*mult;
  });
}
function buildReviewHTML(m){
  const {sort,dir}=reviewSortState();
  const txns=sortedReviewTxns(m);
  const lineOpts=m.groups.flatMap(g=>g.lines).filter(l=>l.type!=='in').map(l=>l.name);
  const head=(key,label,cls)=>`<button class="rev-sort ${cls} ${sort===key?'on dir-'+dir:''}" data-sort="${key}">${label}</button>`;
  let h=`<div class="rev-head">${head('src','Src','rv-src')}${head('date','Date','rv-date')}${head('desc','Description','rv-desc')}${head('amount','Amount','rv-amt')}${head('cat','Category','rv-cat')}</div>`;
  txns.forEach((t,i)=>{
    let cat=reviewCategory(t);
    let catDisplay, catClass='';
    if(t.workTravel){catDisplay='✈ work travel';catClass='rv-special';}
    else if(cat==='__INCOME__'){catDisplay='income';catClass='rv-special';}
    else if(cat==='__CARDPAY__'){catDisplay='card payment';catClass='rv-special';}
    else if(cat==='__SKIP__'){catDisplay='transfer/fee';catClass='rv-special';}
    else if(!cat){catDisplay='— none —';catClass='rv-none';}
    else catDisplay=cat;
    const editable = !(t.workTravel||['__INCOME__','__CARDPAY__','__SKIP__'].includes(cat));
    const sel = editable
      ? `<select class="rv-assign" data-idx="${i}"><option value="">${catDisplay}</option>${lineOpts.map(o=>`<option value="${o}" ${o===cat?'selected':''}>${o}</option>`).join('')}</select>`
      : `<span class="rv-fixed ${catClass}">${catDisplay}</span>`;
    const src=(t.source==='usbank')?'<span class="src-tag usb">USB</span>':'<span class="src-tag chs">CHS</span>';
    h+=`<div class="rev-row ${catClass}">
      <span class="rv-src">${src}</span>
      <span class="rv-date">${shortDate(t.date)}</span>
      <span class="rv-desc" title="${t.desc.replace(/"/g,'&quot;')}">${t.desc}</span>
      <span class="rv-amt ${t.amount>=0?'pos':''}">${money(t.amount)}</span>
      <span class="rv-cat">${sel}</span>
    </div>`;
  });
  return h;
}
function shortDate(d){
  const s=String(d||'');
  const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso)return `${Number(iso[2])}/${Number(iso[3])}`;
  const mdy=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if(mdy)return `${Number(mdy[1])}/${Number(mdy[2])}`;
  return s;
}
function wireReview(m,panel){
  panel.querySelectorAll('[data-sort]').forEach(btn=>btn.addEventListener('click',()=>{
    const key=btn.dataset.sort;
    panel.dataset.dir=(panel.dataset.sort===key&&panel.dataset.dir==='asc')?'desc':'asc';
    panel.dataset.sort=key;
    panel.innerHTML=buildReviewHTML(m);
    wireReview(m,panel);
  }));
  const txns=sortedReviewTxns(m,panel);
  panel.querySelectorAll('.rv-assign').forEach(sel=>sel.addEventListener('change',()=>{
    const t=txns[+sel.dataset.idx]; if(!t)return;
    const line=sel.value;
    // find the real object in m.imported and tag it
    const real=(m.imported||[]).find(x=>x.desc===t.desc&&x.date===t.date&&x.amount===t.amount&&(x.source||'')===(t.source||''));
    if(real){ real.cat=line||undefined; }
    save();
    // refresh both the panel and the comparison above
    renderCompare(m);
    const p=document.getElementById('reviewPanel');
    if(p){ p.innerHTML=buildReviewHTML(m); p.style.display=''; wireReview(m,p); }
  }));
}

function renderTravel(m){
  const c=document.getElementById('travelView');
  const trips=getTrips().slice().sort((a,b)=>(a.start||'').localeCompare(b.start||''));
  let html=`<div class="trip-add">
    <div class="ta-row">
      <input id="tName" placeholder="Trip name (e.g. Region 7 Symposium)" class="ta-name">
    </div>
    <div class="ta-row">
      <label>Start<input type="date" id="tStart"></label>
      <label>End<input type="date" id="tEnd"></label>
      <div class="ta-type">
        <button class="tt-btn on" id="tPersonal" data-v="personal">Personal</button>
        <button class="tt-btn" id="tWork" data-v="work">Work</button>
      </div>
    </div>
    <button class="add-group" id="tAdd" style="margin-top:4px">+ Add trip</button>
  </div>`;

  if(!trips.length){
    html+=`<div style="text-align:center;color:var(--text-dim);font-size:.85rem;padding:24px 12px">No trips logged yet. Add one above — it'll help match travel charges when you import statements.</div>`;
  } else {
    html+=`<div class="trip-list">`;
    trips.forEach(t=>{
      html+=`<div class="trip-card ${t.kind}" data-tripid="${t.id}">
        <div class="tc-main">
          <input class="tc-name-edit" value="${(t.name||'').replace(/"/g,'&quot;')}" placeholder="Trip name" data-edit-name="${t.id}">
          <div class="tc-dates">
            <input type="date" value="${t.start||''}" data-edit-start="${t.id}">
            <span>→</span>
            <input type="date" value="${t.end||t.start||''}" data-edit-end="${t.id}">
          </div>
        </div>
        <div class="tc-side">
          <div class="tc-type-toggle">
            <button class="tc-tt ${t.kind==='personal'?'on':''}" data-edit-kind="${t.id}" data-k="personal">Personal</button>
            <button class="tc-tt work ${t.kind==='work'?'on':''}" data-edit-kind="${t.id}" data-k="work">Work</button>
          </div>
          <button class="tc-del" data-deltrip="${t.id}" title="Remove">×</button>
        </div>
      </div>`;
    });
    html+=`</div>`;
  }
  c.innerHTML=html;

  // work/personal toggle
  let kind='personal';
  c.querySelector('#tPersonal').onclick=()=>{kind='personal';c.querySelector('#tPersonal').classList.add('on');c.querySelector('#tWork').classList.remove('on');};
  c.querySelector('#tWork').onclick=()=>{kind='work';c.querySelector('#tWork').classList.add('on');c.querySelector('#tPersonal').classList.remove('on');};
  c.querySelector('#tAdd').onclick=()=>{
    const name=c.querySelector('#tName').value.trim();
    const start=c.querySelector('#tStart').value, end=c.querySelector('#tEnd').value;
    if(!name&&!start){return;}
    getTrips().push({id:crypto.randomUUID(),name,start,end:end||start,kind});
    save();renderTravel(m);
  };
  c.querySelectorAll('[data-deltrip]').forEach(b=>b.addEventListener('click',()=>{
    state.trips=getTrips().filter(t=>t.id!==b.dataset.deltrip);save();renderTravel(m);
  }));
  // Inline edits to existing trips
  c.querySelectorAll('[data-edit-name]').forEach(el=>el.addEventListener('blur',()=>{
    const t=getTrips().find(x=>x.id===el.dataset.editName);if(t){t.name=el.value.trim();save();}
  }));
  c.querySelectorAll('[data-edit-start]').forEach(el=>el.addEventListener('change',()=>{
    const t=getTrips().find(x=>x.id===el.dataset.editStart);if(t){t.start=el.value;save();}
  }));
  c.querySelectorAll('[data-edit-end]').forEach(el=>el.addEventListener('change',()=>{
    const t=getTrips().find(x=>x.id===el.dataset.editEnd);if(t){t.end=el.value;save();}
  }));
  c.querySelectorAll('[data-edit-kind]').forEach(b=>b.addEventListener('click',()=>{
    const t=getTrips().find(x=>x.id===b.dataset.editKind);if(t){t.kind=b.dataset.k;save();renderTravel(m);}
  }));
}

// (tab/nav handlers moved into wireChrome(), called after auth+load)

// ---- Wire tab + nav handlers (after DOM ready) ----
function wireChrome(){
  document.getElementById('tabFlow').onclick=()=>{view='flow';render();};
  document.getElementById('tabBudget').onclick=()=>{view='budget';render();};
  document.getElementById('tabCompare').onclick=()=>{view='compare';render();};
  document.getElementById('tabTravel').onclick=()=>{view='travel';render();};
  document.getElementById('prevMonth').onclick=()=>shift(-1);
  document.getElementById('nextMonth').onclick=()=>shift(1);
  document.getElementById('resetBtn').onclick=async()=>{
    const ok=await confirmModal('Reset Month',`Reset ${monthName(cursor)} to defaults? This replaces the budget lines for this month.`,{confirmText:'Reset Month',danger:true});
    if(ok){state.months[cursor]=defaultMonth();save();render();}
  };
}
function shift(d){const[y,mo]=cursor.split('-').map(Number);cursor=monthKey(new Date(y,mo-1+d,1));render();}

// ---- Boot: auth gate, then load from Supabase, then render ----
async function boot(){
  try{
    const session = await getSession();
    if(!session){ showLogin(); return; }
    await startApp();
  }catch(err){
    showFatal(err);
  }
}

async function startApp(){
  try{
    document.getElementById('loginScreen')?.remove();
    document.getElementById('appRoot').style.display='';
    const hid = await resolveHousehold();
    if(!hid){
      document.getElementById('appRoot').innerHTML =
        `<div style="padding:40px;text-align:center;color:var(--text-dim)">Your login works, but this account isn't linked to a household yet.<br>Run the household setup SQL (see schema.sql) and reload.</div>`;
      return;
    }
    state = await loadState();
    const duplicateIds=normalizeImportedState();
    const changedBudgetTemplate=normalizeBudgetTemplate();
    const changedRetirementLines=normalizeRetirementFundLines();
    const changedPhoneLines=normalizePhoneLines();
    if(duplicateIds.length){ await deleteTxnIds(duplicateIds); }
    if(duplicateIds.length||changedBudgetTemplate||changedRetirementLines||changedPhoneLines) save();
    // seed defaults for the current month if missing or if a partial DB row exists
    // without the budget template.
    ensureMonth(cursor,true);
    if(!state.rules || !state.rules.length) state.rules = defaultRules().map(r=>[r[0],r[1],'chase']);
    if(!state.trips) state.trips=[];
    wireChrome();
    window._signout = async ()=>{ await flushSave(state); await signOut(); location.reload(); };
    render();
  }catch(err){
    showFatal(err);
  }
}

function showLogin(){
  const root=document.getElementById('appRoot');
  root.style.display='none';
  const div=document.createElement('div');
  div.id='loginScreen';
  div.innerHTML=`
    <div class="login-card">
      <h1>The Ledger</h1>
      <p>Sign in to your household budget.</p>
      <input id="loginEmail" type="email" placeholder="Email" autocomplete="email">
      <input id="loginPass" type="password" placeholder="Password" autocomplete="current-password">
      <button id="loginBtn">Sign in</button>
      <div id="loginErr" class="login-err"></div>
    </div>`;
  document.body.appendChild(div);
  const go=async()=>{
    const email=document.getElementById('loginEmail').value.trim();
    const pass=document.getElementById('loginPass').value;
    const err=document.getElementById('loginErr');
    err.textContent='Signing in...';
    try{
      const { error } = await signIn(email,pass);
      if(error){ err.textContent=error.message; return; }
      await startApp();
    }catch(ex){
      err.textContent=ex.message || String(ex);
    }
  };
  document.getElementById('loginBtn').onclick=go;
  document.getElementById('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
}

function showFatal(err){
  const msg=(err&&err.message)?err.message:String(err);
  document.getElementById('loginScreen')?.remove();
  const root=document.getElementById('appRoot');
  root.style.display='';
  root.innerHTML=`<div class="wrap"><div style="margin:34px auto;max-width:680px;background:var(--surface);border:1px solid var(--red);border-radius:var(--radius);padding:18px;color:var(--text)">
    <h1 style="font-size:1.1rem;margin-bottom:8px">Ledger could not load</h1>
    <p style="color:var(--text-dim);font-size:.9rem;line-height:1.6">${msg}</p>
  </div></div>`;
}

boot();
