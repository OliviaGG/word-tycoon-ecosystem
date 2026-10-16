'use strict';
function acceptSearchGuess({recovery,game,session=null,guess,word,config,gameManager,sessionManager,frenzy=1,period=null,afterAccepted}){
 let award,decision;const winnerKey=u=>u?.linkedDiscord?'discord:'+u.linkedDiscord:(u?.platform||'?')+':'+(u?.platformUserId||u?.id||'unknown');
 const accepted=recovery.run(game,()=>{
  if(game.isWon||game.guessedWords.has(word))throw Error('Searchle guess already accepted');
  game.guessedWords.add(word);game.guesses.push(guess);
  award=session?sessionManager.awardForGuess(session,guess.rank,guess.user):gameManager.awardForGuess(guess.rank,guess.user);
  if(session)session.lastActivityAt=Date.now();
  if(guess.rank!==config.winRank)return;
  if(!Number.isFinite(frenzy)||frenzy<1||frenzy>100)throw Error('Invalid Searchle frenzy');
  const scoring=session?sessionManager.getPodium(session,1000):gameManager.getAllScoringPlayers(),finder=guess.user,finderKey=winnerKey(finder);
  let top=null;for(const player of scoring)if(!top||player.xp>top.xp||!session&&player.xp===top.xp&&player.identityKey===finderKey)top=player;
  const winner=top?{...top}:finder,key=winnerKey(winner),winEvent=!session&&period?'mp-daily-win':'win';
  const meta=session?sessionManager.setSessionWinner(session,guess,word):gameManager.setWinner(guess,word,winner,finder,gameManager.getPodium(7));
  game.winner=winner;
  if(session)session.lastWinner.user=winner;
  const payouts=[];let winnerPayout=0;
  for(const player of scoring){const coins=Math.floor(player.xp*frenzy);if(coins<=0)continue;const won=player.identityKey===key;if(won)winnerPayout=coins;
   const intention=recovery.payout('payout:'+player.identityKey,player,coins,won?winEvent:'word',{guessCount:game.guesses.length,word:game.targetWord,durationSeconds:meta.durationSeconds,xpFromPodium:true,roundXp:player.xp,...(won&&period?{rewardPeriod:period}:{})});if(intention)payouts.push(intention);
  }
  if(!session&&winnerPayout<=0){winnerPayout=Math.floor(gameManager.TARGET_REWARD*frenzy);const intention=recovery.payout('fallback-win',winner,winnerPayout,winEvent,{guessCount:game.guesses.length,word:game.targetWord,durationSeconds:meta.durationSeconds,xpFromPodium:false,...(period?{rewardPeriod:period}:{})});if(intention)payouts.push(intention);}
  const at=Date.now(),podium=session?sessionManager.getPodium(session,7):gameManager.getPodium(7);
  decision={at,nextRoundAt:at+(session?8000:config.autoRestartDelay),winner,targetFinder:finder,winnerKey:key,targetFinderKey:finderKey,word,guessCount:meta.guessCount,durationSeconds:meta.durationSeconds,winnerPayout,displayPot:session?meta.pot:winnerPayout,multiplier:frenzy,period,isDaily:!session&&!!period,podium,payouts};
 },{intentions:()=>decision?.payouts||[],completion:()=>decision});
 if(afterAccepted){
  try{Promise.resolve(afterAccepted({guess,word,award,completion:accepted.record.completion||null})).catch(()=>console.warn('[Searchle] Accepted guess observer deferred'));}
  catch{console.warn('[Searchle] Accepted guess observer deferred');}
 }
 return{valid:true,result:'accepted',word,award,completion:accepted.record.completion||null};
}
module.exports={acceptSearchGuess};
