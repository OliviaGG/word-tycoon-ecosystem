'use strict';
const crypto=require('node:crypto');
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pending=(d,meta)=>[...(!meta.historyRecorded?['history']:[]),...(!meta.completionAcknowledged?['completion']:[])].map(phase=>({eventId:d.id,acceptedAt:new Date(d.acceptedAt).toISOString(),phase}));
// Own the accepted win before history projection or Relay delivery. The generic
// primary journal supplies fsync, private permissions and uncertain-write blocking.
function createSoloCompletions({createJournal,directory,recordHistory,sendCompletion,now=Date.now,journalOptions={},deliveryTimeoutMs=5000}){
 const journal=createJournal({directory,game:'subtextle',sdk:{},now,maxScopes:20000,maxBytes:65536,...journalOptions});
 const active=new Map();let timer=null,cursor=0;
 function valid(record){
  const d=record.completion;
  if(!d||d.version!==1||typeof d.userId!=='string'||!d.userId||d.userId.length>128||/^(?:web_guest_|guest[_-]|anon_|wsguest_)/i.test(d.userId)||
    !['daily','weekly','practice'].includes(d.kind)||typeof d.gameId!=='string'||!d.gameId||d.gameId.length>160||!['en','pt-br'].includes(d.language)||
    !Number.isSafeInteger(d.acceptedAt)||d.acceptedAt<0||typeof d.word!=='string'||!d.word||d.word.length>160||
    !Number.isSafeInteger(d.guessCount)||d.guessCount<1||d.guessCount>10000||typeof d.displayName!=='string'||d.displayName.length>160||
    (d.kind!=='practice'&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.period)||!Number.isFinite(Date.parse(d.period+'T12:00:00Z'))||new Date(d.period+'T12:00:00Z').toISOString().slice(0,10)!==d.period))||
    (d.wordNumber!==null&&(!Number.isSafeInteger(d.wordNumber)||d.wordNumber<1))||typeof d.operationId!=='string'||!d.operationId||d.operationId.length>160||
    d.id!==hash([d.userId,d.kind,d.kind==='practice'?[d.gameId,d.operationId]:d.period,d.language])||record.scope!=='solo:'+d.id||
    typeof record.meta.historyRecorded!=='boolean'||typeof record.meta.completionAcknowledged!=='boolean'||
    JSON.stringify(record.meta.statisticsPending)!==JSON.stringify(pending(d,record.meta))||
    (d.kind==='practice'&&!record.meta.completionAcknowledged)||JSON.stringify(record.state)!==JSON.stringify(d))throw Error('Invalid solo completion record');
  return d;
 }
 for(const scope of journal.scopes())valid(journal.current(scope));
 function accept(input){
  const decision={version:1,userId:String(input.userId||''),kind:input.kind,gameId:String(input.gameId||''),language:input.language||'en',period:input.period||null,
    acceptedAt:now(),word:String(input.word||''),guessCount:input.guessCount,displayName:String(input.displayName||'').slice(0,160),wordNumber:input.wordNumber??null,operationId:String(input.operationId||input.gameId||'')};
  decision.id=hash([decision.userId,decision.kind,decision.kind==='practice'?[decision.gameId,decision.operationId]:decision.period,decision.language]);
  const scope='solo:'+decision.id,existing=journal.current(scope);
  if(existing){valid(existing);return clone(existing.completion);}
  const meta={historyRecorded:false,completionAcknowledged:decision.kind==='practice'};meta.statisticsPending=pending(decision,meta);
  valid({scope,state:decision,completion:decision,meta});
  return valid(journal.start(scope,decision,meta,decision));
 }
 function checkpoint(scope,key){const record=journal.current(scope);valid(record);record.meta[key]=true;record.meta.statisticsPending=pending(record.completion,record.meta);journal.commit(scope,record.roundId,record.state,record.meta,[],record.completion);}
 function deliver(scope){if(active.has(scope))return active.get(scope);
  const pending=(async()=>{let record=journal.current(scope);const d=valid(record);
   if(!record.meta.historyRecorded){const receipt=recordHistory({...d,completionId:d.id,timestamp:new Date(d.acceptedAt).toISOString()});if(receipt?.completionId!==d.id)throw Error('History did not confirm durable completion');checkpoint(scope,'historyRecorded');}
   record=journal.current(scope);if(!record.meta.completionAcknowledged){const controller=new AbortController();let timeout;
    try{const result=await Promise.race([sendCompletion(clone(d),controller.signal),new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('Solo completion delivery timed out'));},deliveryTimeoutMs);})]);if(!result?.ok)throw Error('Solo completion delivery pending');checkpoint(scope,'completionAcknowledged');}
    finally{clearTimeout(timeout);}
   }
   return clone(journal.current(scope));
  })();active.set(scope,pending);pending.finally(()=>active.delete(scope)).catch(()=>{});return pending;
 }
 async function recover(limit=25){const scopes=journal.scopes().filter(scope=>journal.current(scope).meta.statisticsPending.length);if(!scopes.length)return 0;
  const selected=Array.from({length:Math.min(limit,scopes.length)},(_,i)=>scopes[(cursor+i)%scopes.length]);cursor=(cursor+selected.length)%scopes.length;
  const results=await Promise.allSettled(selected.map(deliver));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return results.length;
 }
 function has(userId,kind,period,language='en'){const scope='solo:'+hash([String(userId),kind,period,language]);const record=journal.current(scope);if(record)valid(record);return!!record;}
 function start(onError=()=>{}){if(!timer){timer=setInterval(()=>recover().catch(onError),1000);timer.unref?.();}}
 function stop(){if(timer)clearInterval(timer);timer=null;journal.stop();}
 return{accept,has,recover,start,stop,lookup:(userId,kind,period,language='en')=>{const record=journal.current('solo:'+hash([String(userId),kind,period,language]));return record?clone(valid(record)):null;},read:id=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid completion ID');const record=journal.current('solo:'+id);if(record)valid(record);return record;},summary:()=>({...journal.summary(),pending:journal.scopes().filter(scope=>journal.current(scope).meta.statisticsPending.length).length})};
}
module.exports={createSoloCompletions};
