'use strict';
const crypto = require('node:crypto');
function createPixelettersRecovery({ createActions, directory, sdk, db, getJackpot, setJackpot,
  getFrenzy, getDailyPlayed, consumeDaily, onRollover, onError = () => {} }) {
  const actions = createActions({ directory, gameId: 'pixeletters', sdk, onError });
  function metadata(state, session = null) {
    const owned = actions.recordFor(state), prior = owned || (!session ? actions.journal.current('public') : null);
    return { complete: state.status !== 'active', startTime: session?.gameStartTime ?? state.potStartedAt ?? Date.parse(state.startedAt),
      ...(state.isDaily ? { period: owned?.meta.period || state.dailyDate || sdk.getEdmontonDate() } : {}),
      ...(session ? { handle: session.handle, noRewards: !!session.noRewards } : { jackpotSettings: getJackpot(),
        settings: db.getAllSettings(), dailyPlayed: !!state.isDaily || getDailyPlayed(), statisticsPending: prior?.meta.statisticsPending || [] }) };
  }
  function rawPot(state, session = null) {
    if (!state || !getJackpot().enabled) return 0;
    const config = getJackpot(), opening = state.potStartedAt ?? session?.gameStartTime ?? Date.parse(state.startedAt);
    const elapsed = Math.max(0, Math.floor((Date.now() - opening) / 1000));
    const raw = config.base + state.guesses.length * config.perGuess + elapsed * config.perSecond;
    return config.max > 0 ? Math.min(raw, config.max) : raw;
  }
  function pot(state, session = null) {
    if (!state) return 0;
    const completion = actions.recordFor(state)?.completion;
    if (completion) return completion.amount;
    return Math.floor(rawPot(state, session) * (session ? 1 : getFrenzy().multiplier || 1));
  }
  function actor(guess) {
    if (!guess || ['bot','system'].includes(String(guess.platform).toLowerCase()) || !sdk.isStatsEligible(guess.platform, guess.platformUserId)) return null;
    return { platform: String(guess.platform), platformUserId: String(guess.platformUserId),
      username: String(guess.username || guess.displayName || 'Player').slice(0, 80), displayName: String(guess.displayName || guess.username || 'Player').slice(0, 80) };
  }
  function statistics(state, result, record) {
    const guess = result.guess, acceptedAt = guess?.timestamp || new Date().toISOString();
    const eventId = crypto.createHash('sha256').update(JSON.stringify(['pixeletters-statistics',record.roundId,guess ? state.guesses.length : 'skip'])).digest('hex');
    const participants = [];
    if (result.gameOver && !result.skipped) {
      const unique = new Map();
      for (const item of state.guesses) { const person = actor(item); if (person) unique.set(person.platform + ':' + person.platformUserId, person); }
      const winner = result.won ? actor(state.guesses.at(-1)) : null;
      for (const person of unique.values()) participants.push({ ...person, won: !!winner && person.platform === winner.platform && person.platformUserId === winner.platformUserId });
    }
    const winner = result.won ? state.guesses.at(-1) : null;
    return { eventId, acceptedAt, guess: actor(guess), participants, ...(result.gameOver ? { history: {
      word: state.word, word_length: state.wordLength, guesses: state.guesses, status: state.status,
      winner_platform: winner?.platform || null, winner_user_id: winner?.platformUserId || null,
      winner_username: winner?.username || null, started_at: state.startedAt, ended_at: acceptedAt } } : {}) };
  }
  function reconcileStatistics() {
    const record = actions.journal.current('public'); if (!record) return 0;
    let complete = 0;
    for (const entry of (record.meta.statisticsPending || []).slice(0, 64)) {
      try {
        db.applyStatisticsReceipt(entry);
        const current = actions.journal.current('public');
        actions.journal.commit(current.scope, current.roundId, current.state,
          { ...current.meta, statisticsPending: current.meta.statisticsPending.filter(item => item.eventId !== entry.eventId) });
        complete++;
      } catch (error) { onError(error); break; }
    }
    return complete;
  }
  function newPublic(state) {
    state.potStartedAt = Date.parse(state.startedAt);
    actions.save(state, 'public', metadata(state));
    if (state.isDaily) consumeDaily(state.dailyDate || sdk.getEdmontonDate());
    reconcileStatistics();
  }
  function restorePublic() {
    const saved = actions.load('public'); if (!saved) return null;
    if (saved.record.meta.jackpotSettings) setJackpot(saved.record.meta.jackpotSettings);
    for (const [key,value] of Object.entries(saved.record.meta.settings || {})) if (db.getSetting(key) !== value) db.setSetting(key,value);
    if (saved.state.isDaily && saved.record.meta.period === sdk.getEdmontonDate()) consumeDaily(saved.record.meta.period);
    reconcileStatistics(); actions.recover(); return saved.state;
  }
  function ensure(state, session = null) {
    if (!session && state.isDaily && (actions.recordFor(state)?.meta.period || state.dailyDate) !== sdk.getEdmontonDate()) {
      onRollover(); const error = Error('The daily round changed. Please try again.'); error.code = 'DAILY_CHANGED'; throw error;
    }
    if (!actions.recordFor(state)) actions.save(state, session ? 'session:' + session.handle : 'public', metadata(state, session));
  }
  function accept(state, result, session = null) {
    const record = actions.recordFor(state); if (!record) throw Error('Missing accepted baseline');
    const meta = metadata(state, session), intentions = []; let completion;
    if (!session) {
      if (meta.statisticsPending.length >= 10000) throw Error('Statistics handoff capacity reached');
      meta.statisticsPending = [...meta.statisticsPending, statistics(state, result, record)];
    }
    if (result.won) {
      const winner = state.guesses.at(-1), rawAmount = rawPot(state,session), amount = Math.floor(rawAmount * (session ? 1 : getFrenzy().multiplier || 1));
      const event = state.isDaily ? 'mp-daily-win' : 'win';
      completion = { rawAmount, amount, winner, event, ...(meta.period ? { period: meta.period } : {}) };
      state.jackpotAwarded = amount;
      const intention = !session?.noRewards ? actions.reward('win',winner.platform,winner.platformUserId,winner.username,winner.displayName,amount,event,
        { guessCount:state.guesses.length,word:state.word,...(meta.period ? { rewardPeriod:meta.period } : {}) }) : null;
      if (intention) intentions.push(intention);
    } else if (result.gameOver) completion = { amount:0,rawAmount:0,status:state.status };
    actions.accept(state,meta,intentions,completion);
    if (!session) reconcileStatistics();
  }
  function sessionHooks() {
    return {
      restore(session) {
        const saved = actions.load('session:' + session.handle); if (!saved) return null;
        if (saved.record.meta.ended) return { currentGame:null,gameStartTime:0,isComplete:false };
        return { currentGame:saved.state,gameStartTime:saved.record.meta.startTime,isComplete:saved.state.status!=='active',noRewards:!!saved.record.meta.noRewards };
      },
      saveNew(session) { session.currentGame.mode ||= db.getSetting('game_mode') || 'standard'; actions.save(session.currentGame,'session:'+session.handle,metadata(session.currentGame,session)); },
      ensure: session => ensure(session.currentGame,session),
      accept: (session,result) => accept(session.currentGame,result,session),
      end(session) { const record=actions.journal.current('session:'+session.handle); if(record) actions.journal.commit(record.scope,record.roundId,record.state,{...record.meta,ended:true}); }
    };
  }
  const timer = setInterval(reconcileStatistics,5000); timer.unref?.();
  return { actions,metadata,rawPot,pot,newPublic,restorePublic,ensure,accept,reconcileStatistics,sessionHooks,
    isAccepted:state=>!!actions.recordFor(state),stop(){clearInterval(timer);actions.journal.stop();} };
}
module.exports = { createPixelettersRecovery };
