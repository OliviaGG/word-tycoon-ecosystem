'use strict';
const crypto=require('node:crypto'),path=require('node:path');
const db=require('./database');
const relayDir=process.env.CHAT_RELAY_DIR||(process.platform==='win32'?'C:/Chat Relay':'/opt/chat-relay');
const sdk=require(path.join(relayDir,'src/game-shared.js'));
const {Game}=require('./game');
const queues=new Map();let timer=null;
function serialize(scope,action){
  let entry=queues.get(scope);if(!entry){entry={pending:0,tail:Promise.resolve()};queues.set(scope,entry);}
  if(entry.pending>=100) return Promise.reject(Error('action_queue_full'));
  entry.pending++;const result=entry.tail.then(action);entry.tail=result.catch(()=>{});
  result.finally(()=>{entry.pending--;if(!entry.pending&&queues.get(scope)===entry)queues.delete(scope);}).catch(()=>{});
  return result;
}
function cloneGame(game){const next=Object.assign(new Game(),game);next.restoreSnapshot(JSON.parse(JSON.stringify(game.snapshot())));return next;}
function intention(game,key,session,coins,event,details={}){
  if(!session||['web','bot','system'].includes(session.platform)||sdk.isGuestId(session.platformUserId))return null;
  const eventId='wiki-action:'+crypto.createHash('sha256').update(JSON.stringify(['wikirectangled',game.roundId,game.startTime,key,session.platform,session.platformUserId])).digest('hex');
  return {platform:session.platform,userId:session.platformUserId,username:session.displayName||'Player',displayName:session.displayName||'Player',coins,game:'wikirectangled',event,eventId,...details};
}
function accept(callback,intentions=[]){return db.durable(()=>{const result=callback();for(const value of intentions)if(value)db.reserveRewardIntention(value);return result;});}
function recover(){
  const queued=[];
  try{
    for(const p of db.pendingRewardIntentions()){
      const reserved=sdk.reservePlayerReward(p.platform,p.userId,p.username,p.displayName,p.coins,p.game,p.event,p);
      if(!reserved||reserved.payload?.eventId!==p.eventId)throw Error('reward outbox did not accept ownership');
      queued.push(p.eventId);
    }
  }finally{
    // One debounced mark for the batch instead of a full-image save per reward.
    if(queued.length){
      db.markRewardsQueued(queued);
      for(const eventId of queued)Promise.resolve(sdk.deliverPlayerReward(eventId)).catch(()=>{});
    }
  }
  return queued.length;
}
function start(){if(!timer){timer=setInterval(()=>{try{recover();}catch(error){console.error('[Durability] reward recovery failed:',error.message);}},1000);timer.unref?.();}}
module.exports={serialize,cloneGame,intention,accept,recover,start};
