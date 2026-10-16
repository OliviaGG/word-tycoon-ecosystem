'use strict';
const crypto = require('node:crypto');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Account-owned assignments and accepted guesses survive browser and process
// replacement. Rankings remain in the canonical pool, never in browser saves.
function createSoloSessions({ createJournal, directory, now = Date.now, journalOptions = {} }) {
  const journal = createJournal({ directory, game: 'subtextle', sdk: {}, now,
    maxScopes: 20000, maxBytes: 8 * 1024 * 1024, ...journalOptions });
  function validate(record) {
    const s = record.state;
    if (!s || s.version !== 1 || typeof s.userId !== 'string' || !s.userId || s.userId.length > 128 ||
      /^(?:web_guest_|guest[_-]|anon_|wsguest_)/i.test(s.userId) || !['en', 'pt-br'].includes(s.language) ||
      !['daily', 'weekly', 'practice'].includes(s.kind) || typeof s.gameId !== 'string' || !s.gameId || s.gameId.length > 160 ||
      typeof s.targetWord !== 'string' || !s.targetWord || s.targetWord.length > 160 ||
      typeof s.attemptId !== 'string' || !/^[a-f0-9-]{36}$/.test(s.attemptId) ||
      typeof s.isWon !== 'boolean' || !Number.isFinite(Date.parse(s.startTime)) ||
      !Array.isArray(s.guesses) || s.guesses.length > 10000 || s.guesses.some(g => !g || typeof g.word !== 'string' ||
        !g.word || g.word.length > 160 || !Number.isSafeInteger(g.rank) || g.rank < 1 || typeof g.user !== 'object') ||
      (s.kind !== 'practice' && !/^\d{4}-\d{2}-\d{2}$/.test(s.period || '')) ||
      record.scope !== scope(s.userId, s.kind, s.period, s.gameKey, s.language)) throw Error('Invalid solo assignment');
    return s;
  }
  function scope(userId, kind, period, gameKey, language = 'en') {
    return 'assignment:' + hash([userId, kind, kind === 'practice' ? gameKey : period, language]);
  }
  for (const key of journal.scopes()) validate(journal.current(key));
  function read(userId, kind, period, gameKey, language = 'en') {
    const r = journal.current(scope(userId, kind, period, gameKey, language));
    return r ? clone(validate(r)) : null;
  }
  function save(userId, game) {
    const kind = game.isDaily ? 'daily' : game.isWeekly ? 'weekly' : 'practice';
    const period = game.isDaily ? game.dailyDate : game.isWeekly ? game.weekStart : null;
    const key = scope(userId, kind, period, game.gameKey, game.language || 'en');
    const old = journal.current(key);
    const state = { version: 1, userId, kind, period, language: game.language || 'en',
      gameId: String(game.gameId), gameKey: game.gameKey, targetWord: game.targetWord || game.word,
      startTime: game.startTime, guesses: clone(game.guesses), isWon: !!game.isWon,
      attemptId: game.completionOperationId || old?.state.attemptId || crypto.randomUUID(),
      wordNumber: game.wordNumber ?? null, dailyNumber: game.dailyNumber ?? null,
      weeklyNumber: game.weeklyNumber ?? null, difficulty: game.difficulty || 'normal',
      completionId: game.completionId || null };
    validate({ scope: key, state });
    if (old && (old.state.gameId !== state.gameId || old.state.targetWord !== state.targetWord ||
      old.state.startTime !== state.startTime || old.state.attemptId !== state.attemptId)) throw Error('Solo assignment changed');
    if (old) {
      if (old.state.isWon && !state.isWon) throw Error('Solo assignment already completed');
      const guesses = new Map(old.state.guesses.map(g => [g.word, g]));
      for (const guess of state.guesses) if (!guesses.has(guess.word)) guesses.set(guess.word, guess);
      state.guesses = [...guesses.values()];
      validate({ scope: key, state });
    }
    const record = old ? journal.commit(key, old.roundId, state, old.meta) : journal.start(key, state, {});
    game.completionOperationId = state.attemptId;
    return clone(validate(record));
  }
  function latest(userId, language = 'en') {
    let latest = null;
    for (const key of journal.scopes()) {
      const record = journal.current(key), state = validate(record);
      if (state.userId === userId && state.language === language && state.kind === 'practice' && !state.isWon &&
        (!latest || record.updatedAt >= latest.updatedAt)) latest = record;
    }
    return latest ? clone(latest.state) : null;
  }
  return { read, save, latest, summary: () => journal.summary(), stop: () => journal.stop() };
}
module.exports = { createSoloSessions };
