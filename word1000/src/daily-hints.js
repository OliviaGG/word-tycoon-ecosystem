'use strict';
const { createTransactionalHintHandler } = require('./paid-hints');
function candidatesForDaily(state) {
  const word = String(state?.word || '').toUpperCase();
  if (!/^[A-Z]{4,10}$/.test(word) || state.gameOver) return [];
  const known = new Set();
  for (const guess of state.guesses || []) for (let i = 0; i < word.length; i++) if (guess.word[i] === word[i]) known.add(i);
  return [...word].map((letter, position) => ({ letter, position, wordLength: word.length })).filter(hint => !known.has(hint.position));
}
function createDailyHintHandler({ resolveUser, secret, fetchDaily, relay, admit }) {
  return createTransactionalHintHandler({ resolveUser, secret, relay, admit, gameId: 'word1000', candidateBuilder: candidatesForDaily,
    getRound: async (handle, body) => {
      const length = body.length;
      if (!Number.isInteger(length) || length < 4 || length > 10 || handle !== 'daily-' + length || body.daily !== true || body.gameOver === true) return null;
      if (!Array.isArray(body.guesses) || body.guesses.length >= 8 || body.guesses.some(word => typeof word !== 'string' || !new RegExp('^[A-Z]{' + length + '}$', 'i').test(word))) return null;
      const daily = await fetchDaily(length), word = String(daily?.word || '').toUpperCase();
      if (!daily || !/^\d{4}-\d{2}-\d{2}$/.test(daily.date) || word.length !== length || !/^[A-Z]+$/.test(word)) throw Error('Invalid canonical daily');
      if (body.date !== daily.date) return null;
      return { startTime: daily.date + 'T00:00:00.000Z', state: { word, guesses: body.guesses.map(word => ({ word: word.toUpperCase() })), gameOver: body.guesses.some(guess => guess.toUpperCase() === word) } };
    },
  });
}
module.exports = { createDailyHintHandler, candidatesForDaily };
