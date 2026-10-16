'use strict';
const copy = value => JSON.parse(JSON.stringify(value));
const path=require('node:path'),{createPublicMetadataStore}=require('./public-metadata');
const METHODS = ['reset','loadPuzzle','loadFromPuzzle','generateAndLoad','loadCustomPuzzle','start','pause','resume','end','shuffleLetters','restoreState'];
function createBeeRecovery({createJournal,directory,sdk,Game,getPublicData,setPublicData,getSettings,getFrenzy,onError=()=>{},journalOptions={}}) {
 const journal=createJournal({directory,game:'spelling-bee',sdk,...journalOptions}), owners=new WeakMap();
 const publicStore=createPublicMetadataStore({directory:path.join(directory,'metadata'),fsImpl:journalOptions.fsImpl});
 let running=null;
 function validate(state) {
  if(!state || !Array.isArray(state.letters) || ![0,7].includes(state.letters.length) || state.letters.length===7 && (new Set(state.letters).size!==7 || state.letters.some(x=>typeof x!=='string'||!/^[a-z]$/.test(x)) || !state.letters.includes(state.centerLetter)) ||
   !Array.isArray(state.validWords) || state.validWords.length>10000 || state.validWords.some(x=>typeof x!=='string'||!/^[a-z]{3,128}$/.test(x)) || !state.foundWords || !state.players || !Array.isArray(state.wordHistory) || state.wordHistory.length>10000 ||
   !['idle','active','paused','ended'].includes(state.status) || !Number.isFinite(state.timerDuration) || state.timerDuration<0 || state.timerDuration>86400) throw Error('Invalid accepted Spelling Bee board');
  for(const field of ['commonWords','rareWords','hiddenWords','threeLetterWords']) if(!Array.isArray(state[field])) throw Error('Invalid accepted word classification');
  for(const word of Object.keys(state.foundWords)) if(!state.validWords.includes(word)) throw Error('Invalid accepted find');
 }
 function recordFor(game) {const owner=owners.get(game);if(!owner)return null;const record=journal.current(owner.scope);if(!record||owner.roundId!==record.roundId)throw Error('Obsolete Spelling Bee round');return record;}
 function publicData() {const data=getPublicData();if(!Array.isArray(data.history)||data.history.length>200||!Array.isArray(data.savedGames)||data.savedGames.length>50||!data.playerStats||!Array.isArray(data.playedPuzzleIds)||!data.settings)throw Error('Invalid Spelling Bee recovery metadata');return data;}
 function metadata(game,session) {return session?{handle:session.handle,sessionId:session.sessionId||null,gameStartTime:session.gameStartTime,lastActivityAt:session.lastActivityAt,isComplete:!!session.isComplete,noRewards:!!session.noRewards}:publicStore.metadata(publicData());}
 function pot(game,session) {const accepted=recordFor(game);if(accepted?.completion)return accepted.completion.amount;return rawPot(game,session);}
 function rawPot(game,session) {const settings=getSettings();if(!settings.enabled||session?.noRewards)return 0;const start=session?session.gameStartTime:getPublicData().gameStartTime;const elapsed=Math.max(0,Math.floor((Date.now()-start)/1000));const result=settings.base+Object.keys(game.foundWords).length*settings.perGuess+elapsed*settings.perSecond;const amount=Math.min(result,settings.max);if(!Number.isSafeInteger(amount)||amount<0)throw Error('Invalid accepted Spelling Bee jackpot');return amount;}
 function reward(key,player,amount,event,extras={}) {const platform=String(player.platform||''),id=String(player.platformUserId||player.username||'');if(['bot','system','admin'].includes(platform.toLowerCase())||!sdk.isStatsEligible(platform,id)||amount<=0)return null;return{key,payload:{...extras,game:'spelling-bee',platform,userId:id,username:String(player.username||player.displayName||'Anonymous'),displayName:String(player.displayName||player.username||'Anonymous'),coins:amount,event}};}
 function hydrate(game,state) {game._beeOriginalRestore(copy(state),{exact:true,silent:true});}
 function load(scope) {const record=journal.current(scope);if(!record)return null;validate(record.state);
  if(scope==='public'){record.meta.publicData=publicStore.expand(record.meta);const data=record.meta.publicData;if(!data||!data.settings||!Number.isFinite(data.gameStartTime))throw Error('Invalid accepted Spelling Bee metadata');}
  else if(!Number.isFinite(record.meta.gameStartTime)||!Number.isFinite(record.meta.lastActivityAt))throw Error('Invalid accepted Spelling Bee session metadata');
  if(record.completion && (!Number.isFinite(record.completion.at)||!Number.isFinite(record.completion.nextRoundAt)||!Number.isSafeInteger(record.completion.amount)||record.completion.amount<0||!Array.isArray(record.completion.leaderboard)))throw Error('Invalid accepted Spelling Bee completion');
  return record;}
 function attach(game,scope,session=null) {
  if(game._beeOriginalRestore)return game;
  game._beeOriginalRestore=game.restoreState.bind(game);
  const originals={};for(const method of METHODS)originals[method]=game[method].bind(game);
  for(const method of METHODS)game[method]=function(...args){if(running?.game===game)return originals[method](...args);return run(game,session,()=>originals[method](...args),{newRound:['reset','loadPuzzle','loadFromPuzzle','generateAndLoad','loadCustomPuzzle','restoreState'].includes(method),method});};
  game._beeScope=scope;return game;
 }
 function adopt(game,record,session=null) {attach(game,record.scope,session);hydrate(game,record.state);owners.set(game,{scope:record.scope,roundId:record.roundId});if(session){Object.assign(session,{gameStartTime:record.meta.gameStartTime,lastActivityAt:record.meta.lastActivityAt,isComplete:!!record.completion||!!record.meta.isComplete,noRewards:!!record.meta.noRewards});session.completion=record.completion||null;}else setPublicData(copy(record.meta.publicData));return game;}
 function baseline(game,scope,session=null) {
  attach(game,scope,session);const state=game.getSerializableState();validate(state);let completion;
  // A legacy completed board has no verifiable unpaid win. Preserve completion
  // and advancement without minting a reward for historical progress.
  if(game.completionEmitted||session?.isComplete){const at=Date.now();completion={at,nextRoundAt:at+30000,winner:null,leaderboard:game.getLeaderboard(),rawAmount:0,amount:0,multiplier:1,isDaily:false,period:null,legacy:true};}
  const record=journal.start(scope,state,metadata(game,session),completion);owners.set(game,{scope,roundId:record.roundId});
  if(session&&completion){session.isComplete=true;session.completion=copy(completion);}
  return record;
 }
 function run(game,session,mutate,{newRound=false,method=null,wordPlayer=null,wordPolicy=null,prepare=null}={}) {
  if(running){if(running.game!==game)throw Error('Overlapping Spelling Bee mutation');return mutate();}
  const previous=recordFor(game),before=copy(game.getSerializableState()),beforePublic=session?null:previous?publicStore.expand(previous.meta):publicData(),beforeSession=session?{gameStartTime:session.gameStartTime,lastActivityAt:session.lastActivityAt,isComplete:session.isComplete,completion:session.completion||null}:null;
  const emit=game.emit,events=[];game.emit=function(...args){events.push(args);return true;};running={game};let result,accepted;
  try {
   result=mutate();if(result&&typeof result.then==='function')throw Error('Spelling Bee transactions must be synchronous');
   if(result?.valid===false && !events.length)return result;
   if(method==='start' && result?.success){if(session){session.gameStartTime=game.startTime;session.lastActivityAt=Date.now();}else{const next=publicData();next.gameStartTime=game.startTime;setPublicData(next);}}
   if(newRound){if(session){session.isComplete=false;session.completion=null;}else{const next=publicData();next.statsFinalized=false;setPublicData(next);}}
   if(prepare)prepare(result);
   let completion=newRound?undefined:previous?.completion,firstCompletion=!completion && events.some(e=>e[0]==='all-words-found');const intentions=[];
   if(result?.valid && wordPlayer && !session?.noRewards){const amount=wordPolicy==='score'?result.score:(result.isPangram?1000:100);const intention=reward('word:'+result.word,wordPlayer,amount,result.isPangram?'pangram':'word',{word:result.word});if(intention)intentions.push(intention);}
   if(firstCompletion){const multiplier=session?1:getFrenzy();if(!Number.isFinite(multiplier)||multiplier<1||multiplier>100)throw Error('Invalid accepted Spelling Bee frenzy');const winner=game.getLeaderboard()[0]||null,rawAmount=rawPot(game,session),amount=Math.round(rawAmount*multiplier),data=session?null:publicData();const period=data?.isDaily?game.dailyPuzzleDate:null;
    completion={at:Date.now(),nextRoundAt:Date.now()+30000,winner,leaderboard:game.getLeaderboard(),rawAmount,amount,multiplier,isDaily:!!data?.isDaily,period};
    if(!Number.isSafeInteger(amount)||amount<0||completion.isDaily&&!/^\d{4}-\d{2}-\d{2}$/.test(period||''))throw Error('Invalid accepted completion');
    if(winner&&!session?.noRewards){const intention=reward('win',winner,amount,completion.isDaily?'mp-daily-win':'win',{guessCount:winner.words.length,...(period?{rewardPeriod:period}:{})});if(intention)intentions.push(intention);}
    if(session){session.isComplete=true;session.completion=copy(completion);}game.completionEmitted=true;
   }
   if(!session && (firstCompletion || events.some(e=>e[0]==='game-ended'))) finalizeProjection(game,completion);
   const state=game.getSerializableState();validate(state);const meta=metadata(game,session);
   if(!previous||newRound){if(intentions.length)throw Error('Cannot reward an unowned puzzle');accepted=journal.start(game._beeScope,state,meta);}
   else accepted=journal.commit(previous.scope,previous.roundId,state,meta,intentions,firstCompletion?completion:undefined);
   owners.set(game,{scope:accepted.scope,roundId:accepted.roundId});
  }catch(error){hydrate(game,before);if(session)Object.assign(session,beforeSession);else setPublicData(beforePublic);throw error;}
  finally{game.emit=emit;running=null;}
  recover();if(!session){try{publicStore.prune(accepted.meta.publicDataRef);}catch(error){onError(error);}}for(const event of events)emit.apply(game,event);return result;
 }
 function finalizeProjection(game,completion) {
  const data=copy(publicData());if(data.statsFinalized)return;data.statsFinalized=true;const time=completion?.at||Date.now(),state=game.getSerializableState(),participants=Object.values(state.players);
  for(const player of participants){const id=player.platformUserId||player.username;if(!sdk.isStatsEligible(player.platform,id))continue;const key=player.linkedDiscord?'discord:'+player.linkedDiscord:player.platform+':'+id;const stats=data.playerStats[key]||{username:player.username,displayName:player.displayName,platform:player.linkedDiscord?'discord':player.platform,avatar:player.avatar,linkedDiscord:player.linkedDiscord||null,totalScore:0,totalWords:0,totalPangrams:0,gamesPlayed:0};Object.assign(stats,{totalScore:stats.totalScore+player.score,totalWords:stats.totalWords+player.words.length,totalPangrams:stats.totalPangrams+player.pangrams,gamesPlayed:stats.gamesPlayed+1,displayName:player.displayName,avatar:player.avatar,lastSeen:time});data.playerStats[key]=stats;}
  data.history.unshift({puzzleId:state.puzzleId,puzzleName:state.puzzleName,letters:state.letters,centerLetter:state.centerLetter,totalWords:state.validWords.length,wordsFound:Object.keys(state.foundWords).length,participants:participants.map(p=>({username:p.username,displayName:p.displayName,platform:p.platform,platformUserId:p.platformUserId,linkedDiscord:p.linkedDiscord||null,wordsFound:p.words.length,score:p.score})),startedAt:state.startTime,endedAt:time,timestamp:time});data.history.length=Math.min(data.history.length,200);
  if(state.letters.length===7){const archive={...state,id:'game_'+(state.startTime||time),totalWords:state.validWords.length,foundCount:Object.keys(state.foundWords).length,currentScore:Object.values(state.foundWords).reduce((n,w)=>n+w.score,0),foundPangrams:Object.values(state.foundWords).filter(w=>w.isPangram).length,playerCount:participants.length,topPlayers:[...participants].sort((a,b)=>b.score-a.score).slice(0,5),savedAt:time,allWordsFound:!!completion,status:completion?'completed':state.status};data.savedGames=data.savedGames.filter(x=>x.id!==archive.id);data.savedGames.unshift(archive);data.savedGames.length=Math.min(data.savedGames.length,50);}
  if(completion&&game.puzzleId!==null)data.playedPuzzleIds=[...new Set([...data.playedPuzzleIds,String(game.puzzleId)])];
  if(completion?.isDaily && !data.puzzles.some(p=>p.id==='daily-'+completion.period)){
   data.puzzles.push({id:'daily-'+completion.period,name:'Daily: '+state.letters.join('').toUpperCase(),theme:'Daily',letters:state.letters,centerLetter:state.centerLetter,pangram:null});
   while(data.puzzles.length>200){const index=data.puzzles.findIndex(p=>!String(p.id).startsWith('daily-')&&!String(p.id).startsWith('weekly-'));data.puzzles.splice(index<0?0:index,1);}
  }
  setPublicData(data);
 }
 function saveMetadata(game,session=null) {return run(game,session,()=>undefined);}
 function retire(scope) {const record=journal.current(scope);if(record)journal.commit(scope,record.roundId,record.state,{...record.meta,ended:true});}
 function recover(){try{return journal.recover();}catch(error){onError(error);return 0;}}
 journal.startRecovery(onError);
 return{journal,recordFor,validate,load,attach,adopt,baseline,run,pot,rawPot,saveMetadata,retire,recover,stop:()=>journal.stop()};
}
module.exports={createBeeRecovery};
