'use strict';
const C = require('../public/word-trails/core');

// Only a clock/catalog endpoint. Browser stars and progress never award coins.
function dailyStatus(now = new Date()) {
  const date = C.getEdmontonDate(now);
  return { ok: true, date, timeZone: 'America/Edmonton', serverNow: now.getTime(),
    resetAt: C.nextDailyReset(now), contentVersion: C.VERSION, dailyVersion: C.DAILY_VERSION,
    puzzleGenerationId: `${C.DAILY_VERSION}-${date}`, levels: C.puzzles.length };
}

function registerWordTrailsRoutes(app, clock = () => new Date()) {
  app.get('/api/word-trails/daily', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(dailyStatus(clock()));
  });
}

module.exports = { dailyStatus, registerWordTrailsRoutes };
