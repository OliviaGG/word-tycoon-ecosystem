'use strict';
// Rankings are derived separately. Accepted ranks, scoring ownership and
// original completion decisions remain in this journal across restarts.
const FIELDS=['targetWord','targetNumber','totalRankedWords','guesses','guessedWords','guessedValues','guessedWordsRecent','startTime','isWon','winner','lastWinner','playerScores','paidTopWords','paidTopRanks','bestNonTop10Rank','language','hintLettersRevealed','recentTargets','fcTitle','handle','sessionId','lastActivityAt','dailyPuzzleDate'];
function encode(value){return JSON.parse(JSON.stringify(value,(_key,item)=>item instanceof Map?{__searchType:'map',entries:[...item]}:item instanceof Set?{__searchType:'set',entries:[...item]}:item===Infinity?{__searchType:'infinity'}:item));}
function decode(value){return JSON.parse(JSON.stringify(value),(_key,item)=>item&&item.__searchType==='map'?new Map(item.entries):item&&item.__searchType==='set'?new Set(item.entries):item&&item.__searchType==='infinity'?Infinity:item);}
function snapshot(game){return encode(Object.fromEntries(FIELDS.filter(key=>game[key]!==undefined).map(key=>[key,game[key]])));}
function restore(game,state){for(const key of FIELDS)delete game[key];Object.assign(game,decode(state));}
function validate(state){const game=decode(state);
 if (game.targetNumber !== undefined && (!Number.isInteger(game.targetNumber) || game.targetNumber < 1 || game.targetNumber > 1000000)) throw Error('Invalid accepted Searchle number target');
 if (game.targetWord !== undefined && (typeof game.targetWord !== 'string' || !game.targetWord.length || game.targetWord.length > 160)) throw Error('Invalid accepted Searchle word target');
 if(!game||(!Number.isInteger(game.targetNumber)&&typeof game.targetWord!=='string')||!Array.isArray(game.guesses)||game.guesses.length>10000||typeof game.isWon!=='boolean'||!(game.playerScores instanceof Map)||!(game.paidTopWords instanceof Set)&&!(game.paidTopRanks instanceof Set)||!(game.guessedWords instanceof Set)&&!(game.guessedValues instanceof Set)||!Number.isFinite(Date.parse(game.startTime)))throw Error('Invalid accepted Searchle round');
 for(const guess of game.guesses)if(!guess||typeof guess.word!=='string'||guess.word.length>160||!Number.isSafeInteger(guess.rank)||guess.rank<1||!guess.user||typeof guess.user!=='object')throw Error('Invalid accepted Searchle guess');
 for(const [key,player] of game.playerScores)if(typeof key!=='string'||!player||player.identityKey!==key||!Number.isSafeInteger(player.xp)||player.xp<0)throw Error('Invalid accepted Searchle score');
}
function createSearchRecovery({createJournal,directory,sdk,getMetadata=()=>({}),setMetadata=()=>{},onError=()=>{},journalOptions={}}){
 const journal=createJournal({directory,game:'subtextle',sdk,...journalOptions}),owners=new WeakMap();let running=false;
 function current(game){const owner=owners.get(game);if(!owner)return null;const record=journal.current(owner.scope);if(!record||record.roundId!==owner.roundId)throw Error('Obsolete Searchle round');return record;}
 function load(scope){const record=journal.current(scope);if(!record)return null;validate(record.state);if(record.completion&&(!Number.isFinite(record.completion.at)||!Number.isFinite(record.completion.nextRoundAt)||!Array.isArray(record.completion.payouts)))throw Error('Invalid accepted Searchle completion');return record;}
 function adopt(game,record){validate(record.state);restore(game,record.state);owners.set(game,{scope:record.scope,roundId:record.roundId});setMetadata(game,decode(record.meta));return record;}
 function start(game,scope,metadata=getMetadata(game),legacy=false,overrides=null){if(overrides)metadata={...metadata,...overrides};const state=snapshot(game);validate(state);let completion;
  if(legacy&&game.isWon){const at=Date.now();completion={at,nextRoundAt:at+8000,payouts:[],legacy:true};}
  const record=journal.start(scope,state,encode(metadata),completion);owners.set(game,{scope,roundId:record.roundId});if(overrides)setMetadata(game,decode(record.meta));return record;
 }
 function run(game,mutate,{intentions=()=>[],completion=()=>undefined}={}){
  if(running)throw Error('Overlapping Searchle acceptance');const owner=current(game);if(!owner)throw Error('Unowned Searchle round');const before=owner.state,metadata=owner.meta;let result,record;
  running=true;
  try{result=mutate();if(result&&typeof result.then==='function')throw Error('Searchle acceptance must be synchronous');const state=snapshot(game);validate(state);const finished=completion(result);
   record=journal.commit(owner.scope,owner.roundId,state,encode(getMetadata(game)),intentions(result),finished);
  }catch(error){restore(game,before);setMetadata(game,decode(metadata));throw error;}
  finally{running=false;}
  recover();return{result,record};
 }
 function payout(key,player,coins,event,extras={}){const platform=String(player.platform||''),userId=String(player.platformUserId||player.id||'');
  if(['bot','system','admin'].includes(platform.toLowerCase())||!sdk.isStatsEligible(platform,userId)||coins<=0)return null;
  if(!Number.isSafeInteger(coins))throw Error('Invalid accepted Searchle payout');return{key,payload:{...extras,game:'subtextle',platform,userId,username:String(player.username||player.displayName||'Player'),displayName:String(player.displayName||'Player'),coins,event}};
 }
 function retire(scope){const record=journal.current(scope);if(record)journal.commit(scope,record.roundId,record.state,{...record.meta,ended:true});}
 function recover(){try{return journal.recover();}catch(error){onError(error);return 0;}}
 journal.startRecovery(onError);
 return{journal,current,load,adopt,start,run,payout,retire,recover,isRunning:()=>running,stop:()=>journal.stop()};
}
module.exports={createSearchRecovery,snapshot,restore,encode,decode,validate};
