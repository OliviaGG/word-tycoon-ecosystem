'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function createColourRecovery({createActions,directory,sdk,mm,getConfig,setConfig,getPublicMeta,setPublicMeta,mirrorHistory,onError=()=>{}}){
 const actions=createActions({directory,gameId:'colour500',sdk,onError}),scopes=new Set(['public']);let historyCursor=0;
 for(const filename of fs.readdirSync(directory))if(/^[a-f0-9]{64}\.json$/.test(filename))scopes.add(JSON.parse(fs.readFileSync(path.join(directory,filename),'utf8')).scope);
 function validateState(state){if(!state||!Array.isArray(state.code)||!Number.isInteger(state.codeLength)||state.codeLength<3||state.codeLength>6||state.code.length!==state.codeLength||!Number.isInteger(state.paletteSize)||state.paletteSize<4||state.paletteSize>8||state.code.some(n=>!Number.isInteger(n)||n<0||n>=state.paletteSize)||!Array.isArray(state.guesses)||state.guesses.length>200||typeof state.gameOver!=='boolean'||!Number.isFinite(state.startedAt)||typeof state.allowDuplicates!=='boolean')throw Error('Invalid accepted colour state');}
 function metadata(state,session=null){const prior=actions.recordFor(state)||actions.journal.current(session?'session:'+session.handle:'public');
  return{complete:!!state.gameOver,startTime:state.startedAt??session?.gameStartTime,
   ...(session?{handle:session.handle,noRewards:!!session.noRewards,statisticsPending:prior?.meta.statisticsPending||[]}:{config:getConfig(),...getPublicMeta()})};
 }
 function rawPot(state,session=null){if(!state||!getConfig().jackpot.enabled)return 0;const j=getConfig().jackpot,guesses=state.guesses.length,seconds=Math.max(0,(Date.now()-(state.startedAt??session?.gameStartTime))/1000);
  const bonus=(units,rate)=>{if(rate<=0)return 0;const threshold=j.base>0?j.base/rate:Infinity;return units<=threshold?units*rate:j.base*Math.pow(units/threshold,1.5);};
  const total=j.base+Math.round(bonus(guesses,j.perGuess,100)+bonus(seconds,j.perSecond,600));
  return j.max>0?Math.min(total,j.max):total;
 }
 function pot(state,session=null){const complete=state&&actions.recordFor(state)?.completion;return complete?complete.amount:rawPot(state,session);}
 function rowFor(state,record){const winner=state.winner,eventId=crypto.createHash('sha256').update(JSON.stringify(['colour500-history',record.roundId])).digest('hex');
  return{eventId,acceptedAt:new Date(state.wonAt).toISOString(),history:{eventId,at:new Date(state.wonAt).toISOString(),code:mm.formatLetters(state.code),codeLength:state.codeLength,paletteSize:state.paletteSize,guessCount:state.guesses.length,platform:winner.platform,platformUserId:winner.platformUserId,displayName:winner.displayName}};
 }
 function appendHistory(meta,entry){const receipts=meta.historyReceipts||[];if(receipts.includes(entry.eventId))return meta;
  if(receipts.length>=20000)throw Error('History receipt archival required');
  return{...meta,history:[...(meta.history||[]),entry.history].slice(-5000),historyReceipts:[...receipts,entry.eventId]};
 }
 function publishMeta(meta){setPublicMeta(meta);try{mirrorHistory(meta.history);}catch(error){onError(error);}}
 function reconcileHistory(){let count=0;const publicRecord=actions.journal.current('public');if(!publicRecord)return count;
  const privateScopes=[...scopes].filter(scope=>scope!=='public');
  const selected=Array.from({length:Math.min(16,privateScopes.length)},(_,i)=>privateScopes[(historyCursor+i)%privateScopes.length]);
  if(privateScopes.length)historyCursor=(historyCursor+selected.length)%privateScopes.length;
  for(const scope of selected){const record=actions.journal.current(scope);if(!record)continue;
   for(const entry of (record.meta.statisticsPending||[]).slice(0,4)){
    try{const current=actions.journal.current('public'),meta=appendHistory(current.meta,entry);
     if(meta!==current.meta)actions.journal.commit('public',current.roundId,current.state,meta);
     publishMeta(meta);
     const privateRecord=actions.journal.current(scope);actions.journal.commit(scope,privateRecord.roundId,privateRecord.state,{...privateRecord.meta,statisticsPending:privateRecord.meta.statisticsPending.filter(item=>item.eventId!==entry.eventId)});count++;
    }catch(error){onError(error);break;}
   }
  }
  return count;
 }
 function newPublic(state){state.startedAt??=Date.now();state.allowDuplicates??=getConfig().allowDuplicates;validateState(state);actions.save(state,'public',metadata(state));reconcileHistory();}
 function restorePublic(){const saved=actions.load('public');if(!saved)return null;validateState(saved.state);const meta=saved.record.meta;if(!meta.config||!Array.isArray(meta.history)||meta.history.length>5000||!Array.isArray(meta.historyReceipts)||meta.historyReceipts.length>20000||meta.historyReceipts.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw Error('Invalid accepted history');setConfig(meta.config);setPublicMeta(meta);reconcileHistory();actions.recover();return saved;}
 function ensure(state,session=null){if(!actions.recordFor(state)){
   state.startedAt??=session?.gameStartTime??Date.now();state.allowDuplicates??=getConfig().allowDuplicates;
   validateState(state);const scope=session?'session:'+session.handle:'public';scopes.add(scope);actions.save(state,scope,metadata(state,session));
  }}
 function accept(state,session=null){const record=actions.recordFor(state);if(!record)throw Error('Missing durable colour baseline');
  let meta=metadata(state,session),completion;const intentions=[];
  if(state.gameOver){const amount=session?.noRewards?0:Math.floor(pot(state,session));if(!Number.isSafeInteger(amount)||amount<0)throw Error('Invalid accepted payout');
   state.wonAt=Date.now();state.jackpotAwarded=amount;completion={amount,winner:state.winner};
   const winner=state.winner,intention=!session?.noRewards?actions.reward('win',winner.platform,winner.platformUserId,winner.displayName,winner.displayName,amount,'win',{guessCount:state.guesses.length,word:mm.formatLetters(state.code)}):null;if(intention)intentions.push(intention);
   if(!session?.noRewards){const entry=rowFor(state,record);
    if(session){if(meta.statisticsPending.length>=1000)throw Error('History handoff capacity reached');meta.statisticsPending=[...meta.statisticsPending,entry];}
    else{meta=appendHistory(meta,entry);const totalWins=meta.history.filter(row=>String(row.platformUserId)===String(winner.platformUserId)).length;
     meta.totalRoundsPlayed=(meta.totalRoundsPlayed||0)+1;meta.lastWinner={...winner,code:mm.formatLetters(state.code),symbols:mm.formatCode(state.code),totalWins};
    }
   }
  }
  actions.accept(state,meta,intentions,completion);if(!session)publishMeta(meta);reconcileHistory();return actions.recordFor(state);
 }
 function sessionHooks(){return{
  restore(session){const scope='session:'+session.handle,saved=actions.load(scope);scopes.add(scope);if(!saved)return null;if(saved.record.meta.ended)return{gameState:null,gameStartTime:0};validateState(saved.state);return{gameState:saved.state,gameStartTime:saved.record.meta.startTime,noRewards:!!saved.record.meta.noRewards};},
  saveNew(session){const state=session.gameState;state.startedAt??=session.gameStartTime;state.allowDuplicates??=getConfig().allowDuplicates;validateState(state);const scope='session:'+session.handle;scopes.add(scope);actions.save(state,scope,metadata(state,session));},
  end(session){const scope='session:'+session.handle,record=actions.journal.current(scope);if(record)actions.journal.commit(scope,record.roundId,record.state,{...record.meta,ended:true});}
 };}
 const timer=setInterval(()=>{try{reconcileHistory();}catch(error){onError(error);}},5000);timer.unref?.();
 return{actions,metadata,rawPot,pot,newPublic,restorePublic,ensure,accept,reconcileHistory,sessionHooks,savePublicMetadata:state=>actions.save(state,'public',metadata(state)),stop(){clearInterval(timer);actions.journal.stop();}};
}
module.exports={createColourRecovery};
