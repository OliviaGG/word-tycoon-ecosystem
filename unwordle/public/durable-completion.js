(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WTDurableCompletion=factory();})(typeof window==='object'?window:this,function(){
 'use strict';
 function create({storage,prefix,gameId,getAccount,getDate,request,getSession,onChange=()=>{}}){
  let busy=false;
  const keyFor=(account,date)=>prefix+encodeURIComponent(account)+':'+date;
  const owner=()=>{const value=getAccount();return typeof value==='string'&&value.length>0&&value.length<=160?value:null;};
  function read(key){const raw=storage.getItem(key);if(raw===null)return null;if(raw.length>64000)throw Error('Completion recovery storage is too large');const r=JSON.parse(raw);if(r.version!==1||typeof r.account!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!r.evidence||key!==keyFor(r.account,r.date))throw Error('Completion recovery storage needs repair');return r;}
  function records(){const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix)){keys.push(key);if(keys.length>16)throw Error('Completion recovery capacity reached');}}return keys.map(key=>({key,record:read(key)}));}
  function submit(date,evidence){const account=owner();if(!account){onChange('signin');return false;}
   try{if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date!==getDate())throw Error('Daily period has ended');
    const key=keyFor(account,date),value=JSON.stringify({version:1,account,date,evidence});if(value.length>64000)throw Error('Completion evidence is too large');
    const existing=read(key);if(existing&&JSON.stringify(existing.evidence)!==JSON.stringify(evidence))throw Error('A different completion is already awaiting recovery');
    if(!existing){if(records().length>=16)throw Error('Completion recovery capacity reached');storage.setItem(key,value);if(storage.getItem(key)!==value)throw Error('Completion could not be retained');}
    onChange('pending');return true;
   }catch(error){onChange('storage',error.message);return false;}
  }
  async function recover(){if(busy)return;const account=owner();if(!account)return;const session=getSession?.();const context=session?JSON.stringify({id:String(session.id),provider:session.provider||'discord',anchorId:String(session.anchorId||session.id)}):null;busy=true;
   try{for(const {key,record:r} of records()){
     if(r.account!==account)continue;if(r.expiredChecked && r.date!==getDate()){onChange('expired');continue;}
     onChange('pending');
     let reply;try{reply=await request('/api/sp-daily/complete/'+gameId,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...(context?{'x-solo-session-context':context}:{})},body:JSON.stringify({date:r.date,evidence:r.evidence,expectedAccountId:r.account}),redirect:'error',signal:AbortSignal.timeout(10000)});}catch{onChange('retry');break;}
     let data;try{data=await reply.json();}catch{onChange('retry');break;}
     if(!reply.ok||data?.ok!==true){if(r.date!==getDate()&&reply.status!==401&&reply.status!==409&&reply.status<500){r.expiredChecked=true;storage.setItem(key,JSON.stringify(r));onChange('expired');continue;}onChange(reply.status===401||reply.status===409?'account':reply.status>=500?'retry':'rejected',data?.error);break;}
     // Remove only the exact account/period/evidence accepted by the server.
     const latest=read(key);if(latest&&JSON.stringify(latest.evidence)===JSON.stringify(r.evidence))storage.removeItem(key);
     onChange('saved',r.date);
    }}catch(error){onChange('storage',error.message);}finally{busy=false;}
  }
  return{submit,recover};
 }
 function attach({gameId,getAccount,baseUrl,getSession}){
  const notice=document.createElement('div'),message=document.createElement('span'),button=document.createElement('button');
  notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.style.cssText='position:fixed;top:64px;left:12px;right:12px;z-index:10001;padding:12px;margin:0 auto;max-width:600px;border:1px solid #334155;border-radius:8px;background:#fff;color:#111827;box-shadow:0 4px 18px #0003;font:14px/1.4 system-ui';
  button.type='button';button.textContent='Retry completion';button.style.marginLeft='10px';notice.append(message,button);document.body.appendChild(notice);
  const messages={pending:'Recording your completion…',saved:'Completion recorded.',retry:'Completion is saved on this device and awaits connection. Retry when online.',signin:'Sign in to record this completion.',account:'Sign in with the account that completed this puzzle to retry.',expired:'The daily period ended before this completion was recorded. Saved evidence is retained.',rejected:'The server could not verify this completion. Saved evidence is retained.',storage:'Completion could not be saved on this device. Keep this page open and retry.'};
  let draft=null;
  const queue=create({storage:localStorage,prefix:'wt-completion:'+gameId+':',gameId,getAccount,getSession,getDate:()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),request:(route,options)=>fetch(baseUrl()+route,options),onChange(state,date){notice.hidden=false;message.textContent=messages[state]||messages.retry;button.hidden=['pending','saved','expired','rejected'].includes(state);if(state==='saved'){draft=null;try{window.dispatchEvent(new CustomEvent('sp-daily-recorded',{detail:{game:gameId,date}}));}catch{}}}});
  function recover(){if(draft&&getAccount()===draft.account&&queue.submit(draft.date,draft.evidence))draft=null;return queue.recover();}
  button.addEventListener('click',recover);window.addEventListener('online',recover);window.addEventListener('focus',recover);setInterval(()=>{if(document.visibilityState==='visible')recover();},30000);
  return{submit(date,evidence){const snapshot=JSON.parse(JSON.stringify(evidence));draft={account:getAccount(),date,evidence:snapshot};if(queue.submit(date,snapshot))draft=null;return queue.recover();},recover};
 }
 return{create,attach,sessionContextVersion:2};
});
