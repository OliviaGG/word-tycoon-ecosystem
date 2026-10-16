// ===== Single Player Namespace =====
// Server-driven SP mode so the browser never receives the raw answer-bearing pool files.

const spManager = require('./sp-manager');
const guessProcessor = require('./guess-processor');
const config = require('./config');
const rankingEngine = require('./ranking-engine');
const languageProfiles = require('./language-profiles');
const { requireRelayOrShared } = require('./shared-resolver');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSoloCompletions } = require('./solo-completions');
const { createSoloSessions } = require('./solo-sessions');

let spWeeklyWord = null;
let spWeeklyNumber = null;
let spWeeklyDate = null;
let spWeeklyPlayedUsers = new Set();
let _chatRelayUrl = null;
let _resolveIdentity = socket => requireRelayOrShared('src/game-shared.js').resolveWebIdentity([], socket);
let _onWeeklyChange = null;
let _cosmeticsCache = { getPlayerCosmetics: async () => ({}) };
let _completionStore = null;
let _sessionStore = null;

function _acceptSoloWin(game, userId, isRealUser, displayName, guessCount, operationId) {
  if (!Number.isSafeInteger(guessCount) || guessCount < 1 || guessCount > 10000) throw Error('Invalid solo guess count');
  if (isRealUser) {
    if (spManager.getStorageStatus?.().blocked) throw Error('Solo storage requires recovery');
    const decision = _completionStore.accept({
      userId, kind: game.isDaily ? 'daily' : game.isWeekly ? 'weekly' : 'practice',
      period: game.isDaily ? game.dailyDate : game.isWeekly ? game.weekStart : null,
      gameId: String(game.gameId), language: game.language || 'en', word: String(game.targetWord || game.word),
      displayName, guessCount, wordNumber: game.isDaily ? game.dailyNumber : game.isWeekly ? game.weeklyNumber : game.wordNumber,
      operationId: operationId || game.completionOperationId || (game.completionOperationId = crypto.randomUUID()),
    });
    game.completionId = decision.id;
    game.completionDecision = decision;
    if (game.isWeekly) spWeeklyPlayedUsers.add(userId);
    // Primary ownership already committed. Projection/transport failure cannot
    // undo this win; the bounded worker retries independently of the browser.
    _completionStore.recover().catch(() => {});
    // Preserve the existing library lookup; economic completion ownership is
    // already durable independently of this idempotent word projection.
    try { fetch('http://localhost:3020/api/library/report', {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ platform: 'discord', userId, word: decision.word.toLowerCase(), game: 'searchle-sp' }),
    }).catch(() => {}); } catch (_) {}
  }
  game.isWon = true;
  return { ok: true, completionId: game.completionId || null, sessionOnly: !isRealUser };
}

function _processedCallbacks(callbacks, context) {
  callbacks.isCurrent = () => context.socket.connected !== false && context.current() === context.game;
  callbacks.acceptGuess = (guess, text) => {
    const { game, userId, isRealUser, operationId } = context;
    if (!callbacks.isCurrent()) return { valid: false, result: 'round_changed', retryable: true };
    if (game.guesses.length >= 10000) return { valid: false, result: 'bad_request' };
    const won = guess.rank === config.winRank;
    // A winning guess cannot be published until its immutable decision commits.
    if (won) _acceptSoloWin(game, userId, isRealUser, guess.user.displayName || userId, game.guesses.length + 1, operationId);
    const next = { ...game, guesses: [...game.guesses, guess] };
    let saved = null;
    if (isRealUser) {
      try { saved = _sessionStore.save(userId, next); } catch (error) { if (!won) throw error; }
    }
    game.guesses = saved ? saved.guesses : next.guesses;
    game.guessedWords = new Set(game.guesses.map(g => g.word));
    try { callbacks.onNewGuess(guess); } catch (_) {}
    if (won) Promise.resolve(callbacks.onWin(guess, text)).catch(() => {});
    return { valid: true, result: 'accepted', word: text, ...(won ? { completionId: game.completionId || null } : {}) };
  };
  return callbacks;
}

function _getWeekStart() {
  const today = spManager.getDailyDateString();
  const d = new Date(today + 'T12:00:00Z');
  const diff = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function refreshSPWeekly() {
  const weekStart = _getWeekStart();
  if (spWeeklyDate && spWeeklyDate !== weekStart) {
    spWeeklyPlayedUsers.clear();
  }
  spWeeklyDate = weekStart;

  const pick = spManager.getWeeklyPoolFile(weekStart);
  const oldWord = spWeeklyWord;
  if (pick) {
    spWeeklyWord = pick.word;
    spWeeklyNumber = spManager.assignWeeklyNumber(spWeeklyWord);
    console.log(`[SP] Weekly game ready for ${weekStart} (Weekly #${spWeeklyNumber})`);
  } else {
    spWeeklyWord = null;
    spWeeklyNumber = null;
    console.log('[SP] No pool files available for weekly');
  }

  if (spWeeklyWord !== oldWord && _onWeeklyChange) {
    _onWeeklyChange(spWeeklyWord);
  }
}

async function hasUserPlayedWeekly(userId) {
  if (!_chatRelayUrl || !spWeeklyDate) return false;
  if (spWeeklyPlayedUsers.has(userId)) return true;
  if (_completionStore?.has(userId, 'weekly', spWeeklyDate)) return true;
  try {
    const res = await fetch(`${_chatRelayUrl}/api/sp-daily/status/searchle-sp-weekly/${userId}`);
    const data = await res.json();
    if (data.ok && data.completedDates && data.completedDates.includes(spWeeklyDate)) {
      spWeeklyPlayedUsers.add(userId);
      return true;
    }
  } catch (e) {
    console.log('[SP] Failed to check weekly status for', userId, ':', e.message);
  }
  return false;
}

async function saveWeeklyCompletion(userId, weekStart) {
  if (!_chatRelayUrl || !weekStart || weekStart !== _getWeekStart()) return;
  try {
    const apiSecret = process.env.GAME_API_SECRET;
    const response = await fetch(`${_chatRelayUrl}/api/sp-weekly/complete/searchle-sp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiSecret },
      body: JSON.stringify({ userId, weekStart })
    });
    const result = await response.json();
    if (response.ok && result.ok) spWeeklyPlayedUsers.add(userId);
  } catch (e) {
    console.log('[SP] Failed to save weekly completion:', e.message);
  }
}

async function saveDailyCompletion(userId, dailyDate) {
  if (!_chatRelayUrl || !dailyDate) return;
  try {
    const apiSecret = process.env.GAME_API_SECRET;
    await fetch(`${_chatRelayUrl}/api/sp-daily/complete/searchle-sp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiSecret },
      body: JSON.stringify({ userId, date: dailyDate }),
    });
  } catch (e) {
    console.log('[SP] Failed to save daily completion:', e.message);
  }
}

function _buildGameState(game) {
  return {
    gameId: game.gameId,
    gameKey: game.gameKey,
    filename: game.filename,
    serverRanked: !!game.serverRanked,
    language: languageProfiles.normalizeLanguageId(game.language),
    guesses: game.guesses,
    totalRankedWords: game.totalRankedWords,
    startTime: game.startTime,
    wordNumber: game.wordNumber,
    dailyNumber: game.dailyNumber || null,
    dailyDate: game.dailyDate || null,
    weeklyNumber: game.weeklyNumber,
    isDaily: !!game.isDaily,
    isWeekly: game.isWeekly,
    isWon: game.isWon,
    completionId: game.completionId || null,
    ...(game.isWon ? { targetWord: game.targetWord || game.word,
      completedAt: game.completionDecision?.acceptedAt || null,
      completedGuessCount: game.completionDecision?.guessCount || game.guesses.length,
      winner: game.completionDecision ? { id: game.completionDecision.userId, displayName: game.completionDecision.displayName } : null } : {}),
    difficulty: spManager.normalizeDifficulty(game.difficulty),
  };
}

async function _createLanguageSession(language, playedWords, difficulty = 'normal') {
  const lang = languageProfiles.normalizeLanguageId(language);
  const normalizedDifficulty = spManager.normalizeDifficulty(difficulty);
  const targetPool = languageProfiles.getTargetPool(lang, normalizedDifficulty);
  if (!targetPool || targetPool.length === 0) return null;

  const playedSet = new Set((playedWords || []).map(w => String(w || '').toLocaleLowerCase('pt-BR')));
  let pool = targetPool.filter(w => !playedSet.has(w));
  if (pool.length === 0) pool = targetPool;

  let targetWord = null;
  const rankingOptions = languageProfiles.getRankingOptions(lang);
  for (let i = 0; i < 12; i++) {
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    if (rankingEngine.isValidTarget(candidate, rankingOptions)) {
      targetWord = candidate;
      break;
    }
  }
  if (!targetWord) targetWord = pool[Math.floor(Math.random() * pool.length)];

  const rankings = await rankingEngine.computeRankings(targetWord, config, rankingOptions);
  const idSafe = targetWord.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '');
  return {
    gameId: `${Date.now()}_${idSafe}`,
    gameKey: `${lang}:${Date.now()}:${idSafe}`,
    filename: null,
    word: targetWord,
    targetWord,
    rankings,
    totalRankedWords: rankings.size,
    guesses: [],
    guessedWords: new Set(),
    startTime: new Date().toISOString(),
    isWon: false,
    wordNumber: null,
    weeklyNumber: null,
    isWeekly: false,
    serverRanked: true,
    language: lang,
    difficulty: normalizedDifficulty,
  };
}

function _createSession(meta, savedState, difficulty = 'normal') {
  const payload = spManager.loadPoolGameById(meta.gameId);
  if (!payload) return null;

  const guesses = (Array.isArray(savedState?.guesses) ? savedState.guesses : []).slice(0, 10000)
    .filter(guess => guess && typeof guess.word === 'string' && guess.word.length <= 160 &&
      guessProcessor.resolveRank(guess.word, payload.rankings, 'en') !== config.winRank)
    .map(guess => ({ word: guess.word, rank: guessProcessor.resolveRank(guess.word, payload.rankings, 'en'),
      user: { displayName: String(guess.user?.displayName || '').slice(0, 160) },
      timestamp: Number.isFinite(Date.parse(guess.timestamp)) ? guess.timestamp : new Date().toISOString() }));
  const guessedWords = new Set(guesses.map(guess => guess.word));

  const today = spManager.getDailyDateString();
  const dailyPick = meta.isDaily && meta.dailyDate === today
    ? spManager.getDailyPoolFile(today, spWeeklyWord) : null;
  const isDaily = !!(dailyPick && dailyPick.word === payload.targetWord);
  const isWeekly = !isDaily && payload.targetWord === spWeeklyWord;
  return {
    ...payload,
    serverRanked: true,
    language: 'en',
    gameKey: meta.gameKey || payload.gameKey,
    wordNumber: meta.wordNumber ?? payload.wordNumber,
    dailyNumber: isDaily ? spManager.getDailyNumber(today) : null,
    dailyDate: isDaily ? today : null,
    weeklyNumber: isWeekly ? spWeeklyNumber : (meta.weeklyNumber || null),
    isDaily,
    isWeekly,
    weekStart: isWeekly ? spWeeklyDate : null,
    guesses,
    guessedWords,
    startTime: Number.isFinite(Date.parse(savedState?.startTime)) ? savedState.startTime : new Date().toISOString(),
    isWon: false,
    difficulty: (meta.isDaily || meta.isWeekly) ? 'normal' : spManager.normalizeDifficulty(difficulty),
  };
}

function _savedStateFromHandshake(socket) {
  const saved = socket.handshake.auth?.savedGame;
  if (!saved || typeof saved !== 'object') return null;
  if (!saved.gameId || saved.isWon) return null;
  if (!Array.isArray(saved.guesses) || saved.guesses.length === 0) return null;
  return saved;
}

async function _pickInitialGame(userId, isRealUser, launchMode, playedGameKeys, savedState, playedWords, difficulty = 'normal') {
  if (savedState &&
      !(launchMode === 'weekly' && !savedState.isWeekly) &&
      !(launchMode === 'daily' && !savedState.isDaily)) {
    const savedMeta = spManager.getGameMetaById(savedState.gameId);
    if (savedMeta) {
      return {
        meta: {
          ...savedMeta,
          gameKey: savedState.gameKey || savedMeta.gameKey,
          wordNumber: savedState.wordNumber ?? savedMeta.wordNumber,
          dailyNumber: savedState.dailyNumber || null,
          dailyDate: savedState.dailyDate || null,
          weeklyNumber: savedState.weeklyNumber || null,
          isDaily: !!savedState.isDaily,
          isWeekly: !!savedState.isWeekly,
        },
        savedState,
        weeklyCompleted: false,
      };
    }
  }

  const playedWordSet = new Set((playedWords || []).map(w => String(w || '').toLowerCase()));

  if (launchMode === 'daily') {
    const dailyDate = spManager.getDailyDateString();
    const pick = spManager.getDailyPoolFile(dailyDate, spWeeklyWord);
    const dailyNumber = spManager.getDailyNumber(dailyDate);
    const dailyMeta = pick && spManager.getGameMetaByWord(pick.word);
    if (dailyMeta) {
      return {
        meta: {
          ...dailyMeta,
          gameKey: `daily:${dailyDate}`,
          wordNumber: null,
          dailyNumber,
          dailyDate,
          weeklyNumber: null,
          isDaily: true,
          isWeekly: false,
        },
        savedState: null,
        weeklyCompleted: false,
      };
    }
  }

  const wantsWeekly = launchMode === 'weekly' || spManager.normalizeDifficulty(difficulty) === 'normal';
  if (wantsWeekly && spWeeklyWord) {
    const userAlreadyPlayed = isRealUser ? await hasUserPlayedWeekly(userId) : spWeeklyPlayedUsers.has(userId);
    const weeklyAlreadyPlayed = userAlreadyPlayed || playedWordSet.has(String(spWeeklyWord).toLowerCase());
    if (!weeklyAlreadyPlayed) {
      const weeklyMeta = spManager.getGameMetaByWord(spWeeklyWord);
      if (weeklyMeta && !new Set(playedGameKeys || []).has(weeklyMeta.gameKey)) {
        return { meta: weeklyMeta, savedState: null, weeklyCompleted: false };
      }
    } else if (launchMode === 'weekly') {
      return { meta: null, savedState: null, weeklyCompleted: true };
    }
  }

  const randomMeta = spManager.pickPoolGame(playedGameKeys || [], playedWords || [], difficulty);
  return { meta: randomMeta, savedState: null, weeklyCompleted: false };
}

function init(io, options) {
  _chatRelayUrl = options?.chatRelayUrl || 'http://localhost:3000';
  _resolveIdentity = options?.resolveIdentity || _resolveIdentity;
  _onWeeklyChange = options?.onWeeklyChange || null;
  _cosmeticsCache = options?.cosmeticsCache || _cosmeticsCache;
  const createJournal = requireRelayOrShared('src/game-action-journal.js').createGameActionJournal;
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
  _sessionStore = options?.sessionStore || createSoloSessions({ createJournal, directory: path.join(dataDir, 'solo-sessions') });
  _completionStore = options?.completionStore || createSoloCompletions({
    createJournal, directory: path.join(dataDir, 'solo-actions'),
    recordHistory: decision => spManager.recordWin({
      userId: decision.userId, displayName: decision.displayName, word: decision.word, wordNumber: decision.wordNumber,
      guessCount: decision.guessCount, language: decision.language, completionId: decision.id, timestamp: decision.timestamp,
    }),
    sendCompletion: async (decision, signal) => {
      const destination = new URL(_chatRelayUrl);
      if (destination.username || destination.password || destination.pathname !== '/' || destination.search || destination.hash ||
          !((destination.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname) && destination.port === '3000') ||
            (destination.protocol === 'https:' && ['wordtycoon.live', 'www.wordtycoon.live'].includes(destination.hostname) && !destination.port))) throw Error('Invalid solo completion destination');
      const body = { userId: decision.userId, expectedAccountId: decision.userId, serverCompletion: decision,
        ...(decision.kind === 'weekly' ? { weekStart: decision.period } : { date: decision.period }) };
      const response = await fetch(destination.origin + `/api/sp-${decision.kind}/complete/searchle-sp`, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET }, body: JSON.stringify(body),
      });
      if (!response.ok) throw Error('Solo completion gateway unavailable');
      const result = await response.json();
      if (!result?.ok) throw Error('Solo completion gateway rejected the decision');
      return result;
    },
  });
  _completionStore.start(() => {});
  refreshSPWeekly();
  const weeklyTimer = setInterval(refreshSPWeekly, 60 * 60 * 1000);
  weeklyTimer.unref?.();
  const spNsp = io.of('/sp');
  const boundedStrings = value => Array.isArray(value) && value.length <= 10000 &&
    value.every(x => typeof x === 'string' && x.length <= 160) ? value : [];

  spNsp.on('connection', async socket => {
    let identity = { verified: false };
    try { identity = await _resolveIdentity(socket); } catch (_) {}
    if (socket.connected === false) return;
    const isRealUser = !!(identity.verified && identity.id);
    const userId = isRealUser ? String(identity.id) : `anon_${socket.id}`;
    if (userId.length > 128 || isRealUser && /^(?:web_guest_|guest[_-]|anon_|wsguest_)/i.test(userId)) return socket.disconnect?.(true);
    const auth = socket.handshake.auth || {};
    const language = languageProfiles.normalizeLanguageId(auth.language);
    const launchMode = ['daily', 'weekly'].includes(auth.mode) ? auth.mode : null;
    let difficulty = launchMode ? 'normal' : spManager.normalizeDifficulty(auth.difficulty);
    const room = `sp:${socket.id}`;
    socket.join(room);
    let currentGame = null, generation = 0, pending = Promise.resolve();
    const history = () => spManager.loadWinHistory().filter(win => win.userId === userId);
    const ack = (cb, result) => { try { if (typeof cb === 'function') cb(result); } catch (_) {} };
    async function owns(ticket) {
      if (socket.connected === false || ticket !== generation) return false;
      if (!isRealUser) return true;
      try { const fresh = await _resolveIdentity(socket); return fresh.verified && String(fresh.id) === userId && socket.connected !== false && ticket === generation; }
      catch (_) { return false; }
    }
    function restore(session, snapshot) {
      if (!snapshot) return session;
      if (String(session.gameId) !== snapshot.gameId || (session.targetWord || session.word) !== snapshot.targetWord) throw Error('Canonical solo assignment unavailable');
      return { ...session, gameKey: snapshot.gameKey, guesses: snapshot.guesses,
        guessedWords: new Set(snapshot.guesses.map(g => g.word)), startTime: snapshot.startTime,
        isDaily: snapshot.kind === 'daily', isWeekly: snapshot.kind === 'weekly',
        dailyDate: snapshot.kind === 'daily' ? snapshot.period : null, weekStart: snapshot.kind === 'weekly' ? snapshot.period : null,
        dailyNumber: snapshot.dailyNumber, weeklyNumber: snapshot.weeklyNumber, wordNumber: snapshot.wordNumber,
        completionOperationId: snapshot.attemptId, completionId: snapshot.completionId,
        isWon: snapshot.isWon, difficulty: snapshot.difficulty };
    }
    function ownSession(session, allowRestore = true) {
      if (!session || !isRealUser) return session;
      const kind = session.isDaily ? 'daily' : session.isWeekly ? 'weekly' : 'practice';
      const period = session.isDaily ? session.dailyDate : session.isWeekly ? session.weekStart : null;
      const stored = allowRestore ? _sessionStore.read(userId, kind, period, session.gameKey, language) : null;
      if (stored) {
        // The original server assignment wins if the daily pool changed.
        const canonical = language === 'en' ? spManager.loadPoolGameById(stored.gameId) : session;
        if (!canonical) throw Error('Canonical solo assignment unavailable');
        session = restore({ ...canonical, language, serverRanked: true }, stored);
      }
      const completed = kind !== 'practice' && _completionStore.lookup(userId, kind, period, language);
      if (completed) { session.isWon = true; session.completionId = completed.id; session.completionDecision = completed; }
      _sessionStore.save(userId, session);
      return session;
    }
    async function select(mode, data, saved, freshPractice = false) {
      if (isRealUser && !mode && !freshPractice) {
        const previous = _sessionStore.latest(userId, language);
        if (previous) {
          let session;
          if (language === 'en') session = spManager.loadPoolGameById(previous.gameId);
          else session = { gameId: previous.gameId, targetWord: previous.targetWord, language,
            rankings: await rankingEngine.computeRankings(previous.targetWord, config, languageProfiles.getRankingOptions(language)) };
          if (!session) throw Error('Canonical solo assignment unavailable');
          session = restore({ ...session, serverRanked: true, language,
            totalRankedWords: session.totalRankedWords || session.rankings.size }, previous);
          return ownSession(session);
        }
      }
      if (language !== 'en') return ownSession(await _createLanguageSession(language, boundedStrings(data?.playedWords), difficulty), !freshPractice);
      const pick = await _pickInitialGame(userId, isRealUser, mode, boundedStrings(data?.playedGameKeys), saved, boundedStrings(data?.playedWords), difficulty);
      if (pick.weeklyCompleted) return { weeklyCompleted: true };
      if (!pick.meta) return null;
      let session = _createSession(pick.meta, pick.savedState, difficulty);
      if (!session) return null;
      if (!session.isDaily && !session.isWeekly && freshPractice) session.gameKey = `practice:${crypto.randomUUID()}`;
      return ownSession(session, !freshPractice || session.isDaily || session.isWeekly);
    }
    const saved = _savedStateFromHandshake(socket);
    // Legacy browser guesses only restore display progress. A terminal restored
    // guess never certifies completion; subsequent accepted wins are server-owned.
    if (saved && (saved.guesses.length > 10000 || saved.guesses.some(g => !g || typeof g.word !== 'string' || g.word.length > 160))) {
      socket.emit('sp-init', { unavailable: true, gameId: null }); return;
    }
    try {
      currentGame = await select(launchMode, auth, saved);
      if (socket.connected === false) return;
      socket.emit('sp-init', currentGame?.weeklyCompleted ? { weeklyCompleted: true, winHistory: history() } :
        currentGame ? { ..._buildGameState(currentGame), winHistory: history() } : { gameId: null, winHistory: history() });
    } catch (_) { socket.emit('sp-init', { unavailable: true, gameId: null }); return; }

    socket.on('sp-submit-guess', (data, acknowledge) => {
      const game = currentGame, ticket = generation;
      const run = async () => {
        if (!game || game.weeklyCompleted || !data || typeof data.input !== 'string' || data.input.length > 160 ||
          !data.user || typeof data.user !== 'object' || Array.isArray(data.user) ||
          data.gameId !== undefined && String(data.gameId) !== String(game.gameId) ||
          data.operationId !== undefined && (typeof data.operationId !== 'string' || !data.operationId || data.operationId.length > 160))
          return ack(acknowledge, { valid: false, result: 'bad_request' });
        if (!await owns(ticket) || currentGame !== game) return ack(acknowledge, { valid: false, result: 'round_changed', retryable: true });
        if (game.isWon) return ack(acknowledge, { valid: false, result: 'completed', completionId: game.completionId || null });
        const user = { ...data.user, id: userId, platform: isRealUser ? 'discord' : 'web' };
        const result = await guessProcessor.processGuess({ message: data.input, user, platform: user.platform, linkedDiscord: isRealUser ? userId : null },
          game, config, _cosmeticsCache, _processedCallbacks({
            onBump: word => spNsp.to(room).emit('sp-duplicate', { word }),
            onNewGuess: guess => spNsp.to(room).emit('sp-guess-result', { guess, totalRankedWords: game.totalRankedWords }),
            onWin: (guess, solvedWord) => {
              spNsp.to(room).emit('sp-win', { ..._buildGameState(game), targetWord: solvedWord, user: guess.user, guessCount: game.guesses.length });
              spNsp.to(room).emit('sp-win-recorded', { winHistory: history() });
            },
          }, { game, userId, isRealUser, operationId: game.completionOperationId, socket,
            current: () => ticket === generation ? currentGame : null }));
        ack(acknowledge, result || { valid: false, result: 'invalid' });
      };
      const task = pending.then(run).catch(() => ack(acknowledge, { valid: false, result: 'unavailable', retryable: true }));
      pending = task; return task;
    });
    // Compatibility for old locally ranked clients; all new clients use the
    // authoritative guess pipeline. The selected target remains server-owned.
    socket.on('sp-win', async (data, acknowledge) => {
      const game = currentGame, ticket = generation;
      if (!game || game.weeklyCompleted || !data || typeof data !== 'object' || Array.isArray(data) ||
        typeof data.word !== 'string' || data.word.length > 160 || !Number.isSafeInteger(data.guessCount) ||
        data.guessCount < 1 || data.guessCount > 10000 || data.gameId !== undefined && String(data.gameId) !== String(game.gameId))
        return ack(acknowledge, { ok: false, result: 'bad_request' });
      if (!await owns(ticket) || currentGame !== game) return ack(acknowledge, { ok: false, result: 'round_changed' });
      if (data.word.trim().toLowerCase() !== String(game.targetWord || game.word).toLowerCase())
        return ack(acknowledge, { ok: false, result: 'round_changed' });
      if (game.isWon) return ack(acknowledge, { ok: true, alreadyAccepted: true, completionId: game.completionId || null });
      try {
        const result = _acceptSoloWin(game, userId, isRealUser, String(identity.displayName || identity.username || userId), data.guessCount, game.completionOperationId);
        try { if (isRealUser) _sessionStore.save(userId, game); } catch (_) {}
        ack(acknowledge, result);
        spNsp.to(room).emit('sp-win-recorded', { winHistory: history() });
      } catch (_) { ack(acknowledge, { ok: false, result: 'unavailable', retryable: true }); }
    });
    async function replace(data, specific) {
      const ticket = ++generation;
      if (!await owns(ticket)) return;
      const nextDifficulty = spManager.normalizeDifficulty(data?.difficulty || difficulty);
      difficulty = nextDifficulty;
      try {
        let next;
        if (specific) {
          if (language !== 'en' || !data || !['string', 'number'].includes(typeof data.gameId) || String(data.gameId).length > 160) return;
          const meta = spManager.getGameMetaById(data.gameId);
          if (!meta) return;
          next = _createSession(meta, null, meta.isWeekly ? 'normal' : difficulty);
          if (next && !next.isWeekly && !next.isDaily) next.gameKey = `practice:${crypto.randomUUID()}`;
          if (next) next = ownSession(next, next.isWeekly || next.isDaily);
        } else next = await select(null, data, null, true);
        if (ticket !== generation || socket.connected === false || !next) return;
        currentGame = next;
        spNsp.to(room).emit('sp-new-game', _buildGameState(currentGame));
      } catch (_) { socket.emit('sp-error', { result: 'unavailable', retryable: true }); }
    }
    socket.on('new-game-request', data => replace(data, false));
    socket.on('sp-play-specific', data => replace(data, true));
    socket.on('sp-get-pool-list', () => {
      if (language !== 'en') return socket.emit('sp-pool-list', { games: [], disabled: true, language, difficulty });
      const word = difficulty === 'normal' ? spWeeklyWord : null;
      const meta = word ? spManager.getGameMetaByWord(word) : null;
      socket.emit('sp-pool-list', { games: spManager.getPoolBrowserGames(word, difficulty),
        currentWeeklyGameId: meta?.gameId || null, weeklyWord: word, weeklyNumber: meta ? spWeeklyNumber : null, difficulty });
    });
    socket.on('disconnect', () => { generation++; });
  });
  console.log('[SP] Durable single player namespace initialized on /sp');
}

function getWeeklyInfo() {
  return {
    word: spWeeklyWord || null,
    weekStart: spWeeklyDate || null,
    weeklyNumber: spWeeklyNumber || null,
    length: spWeeklyWord ? spWeeklyWord.length : null,
  };
}

module.exports = { init, getWeeklyInfo, stop: () => { _completionStore?.stop(); _sessionStore?.stop(); },
  getRecoveryStatus: () => ({ ...(_completionStore?.summary() || { blocked: true }), sessions: _sessionStore?.summary(), storageBlocked: !!spManager.getStorageStatus?.().blocked }) };
