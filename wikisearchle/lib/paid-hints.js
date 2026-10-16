'use strict';
const crypto = require('crypto');
function candidatesFor(state) {
  const word = String(state?.word || '').toUpperCase();
  if (!/^[A-Z]{4,8}$/.test(word) || state.gameOver) return [];
  const known = new Set();
  for (const guess of state.guesses || []) {
    const text = String(guess.word || '').toUpperCase();
    if (text.length === word.length) for (let i = 0; i < word.length; i++) if (text[i] === word[i]) known.add(i);
  }
  return [...word].map((letter, position) => ({ letter, position, wordLength: word.length })).filter(hint => !known.has(hint.position));
}
function createAdmission({ now = Date.now, maxAccounts = 5000, limit = 20 } = {}) {
  const buckets = new Map();
  return accountId => {
    const time = now();
    let bucket = buckets.get(accountId);
    if (bucket && time - bucket.at >= 60000) { buckets.delete(accountId); bucket = null; }
    if (!bucket) {
      if (buckets.size >= maxAccounts) for (const [id, hit] of buckets) if (time - hit.at >= 60000) buckets.delete(id);
      if (buckets.size >= maxAccounts) return false;
      bucket = { at: time, count: 0 }; buckets.set(accountId, bucket);
    }
    return ++bucket.count <= limit;
  };
}
function createHintHandler({ resolveUser, getRound, relay, secret, admit = createAdmission() }) {
  return async (req, res) => {
    const accountId = await resolveUser(req);
    if (!accountId) return res.status(401).json({ ok: false, error: 'auth_required' });
    if (!admit(accountId)) return res.status(429).json({ ok: false, error: 'hint_retry_required' });
    const { actionId, expectedStartTime, recoverOnly } = req.body || {};
    const handle = String(req.body?.handle || 'public').trim().toLowerCase();
    if (typeof actionId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(actionId) || !/^[a-z0-9_-]{1,32}$/.test(handle)) {
      return res.status(400).json({ ok: false, error: 'refresh_required' });
    }
    const identity = { discordId: accountId, game: 'wordle', actionId };
    const send = purchase => {
      if (purchase.handle !== handle) return res.status(409).json({ ok: false, error: 'hint_action_conflict' });
      const current = getRound(handle);
      return res.json({ ...purchase, staleRound: !current || current.state.gameOver || current.startTime !== purchase.startTime });
    };
    try {
      // Lookup precedes active-round validation: a lost reply stays recoverable
      // after a win, restart or private room closing, without purchasing again.
      const receipt = await relay('/api/hints/reveal/receipt', identity);
      if (!receipt.ok) throw Error('Receipt lookup failed');
      if (receipt.found) return send(receipt.purchase);
      if (recoverOnly) return res.json({ ok: false, reason: 'hint_receipt_missing', remaining: null });
      const round = getRound(handle);
      const close = reason => relay('/api/hints/reveal/close', { ...identity, handle, startTime: expectedStartTime, reason });
      if (!round || round.state.gameOver || typeof expectedStartTime !== 'string' || expectedStartTime !== round.startTime) {
        return send(await close('round_changed'));
      }
      const candidates = candidatesFor(round.state);
      if (!candidates.length) return send(await close('nothing_to_reveal'));
      const roundKey = crypto.createHmac('sha256', secret).update(JSON.stringify([handle, round.startTime, round.state.word])).digest('hex');
      const purchase = await relay('/api/hints/reveal', { ...identity, handle, startTime: round.startTime, roundKey, candidates });
      return send(purchase);
    } catch (_) { return res.status(503).json({ ok: false, error: 'hint_retry_required' }); }
  };
}
module.exports = { createHintHandler, candidatesFor, createAdmission };

const SYMBOL_LABELS = { not_present: 'not in the word', wrong_position: 'in the word, wrong position', correct: 'correct letter & position' };
function candidatesForBetwixt(state) {
  const word = String(state?.word || state?.secret || '').toUpperCase();
  if (!/^[A-Z]{4,8}$/.test(word) || state.gameOver || state.isWon) return [];
  return [...word].map((letter, position) => ({ letter, position, wordLength: word.length })).filter(hint => !state.confirmedLetters?.[hint.position]);
}
function candidatesForSymbols(state) {
  if (state?.gameOver || state?.solved || state?.failed || !Array.isArray(state?.symbols) || state.symbols.length !== 3) return [];
  return state.symbols.map((symbol, position) => ({ type: 'symbol_meaning', symbol, position,
    meaning: state.symbolMeanings?.[symbol], label: SYMBOL_LABELS[state.symbolMeanings?.[symbol]] })).filter(hint => hint.label);
}
function createTransactionalHintHandler({ resolveUser, getRound, relay, secret, gameId = 'wordle', candidateBuilder = candidatesFor, admit = createAdmission(), beforeDelivery = () => {}, onDelivered = async () => {} }) {
  const roundKey = (handle, round) => crypto.createHmac('sha256', secret).update(JSON.stringify([gameId, handle, round.startTime, round.state.word])).digest('hex');
  return async (req, res) => {
    const accountId = await resolveUser(req);
    if (!accountId) return res.status(401).json({ ok: false, error: 'auth_required' });
    if (!admit(accountId)) return res.status(429).json({ ok: false, error: 'hint_retry_required' });
    const body = req.body || {}, { actionId, expectedStartTime, recoverOnly } = body;
    const handle = String(body.handle || 'public').trim().toLowerCase();
    if (typeof actionId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(actionId) || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'refresh_required' });
    const identity = { discordId: accountId, game: gameId, actionId };
    const currentRound = () => getRound(handle, body);
    const send = async purchase => {
      if (purchase.ok && purchase.deliveryStatus === 'pending') throw Error('Provisional reveal is not deliverable');
      if (purchase.handle !== handle) return res.status(409).json({ ok: false, error: 'hint_action_conflict' });
      if (purchase.ok && purchase.deliveryStatus === 'delivered') await onDelivered(purchase, identity);
      let current;
      try { current = await currentRound(); } catch (_) { current = null; }
      const { debitMonth, ...visible } = purchase;
      if (gameId === 'wikisearchle' && visible.hint) visible.hint = { word: visible.hint.word, position: visible.hint.position };
      const legacyKey = current && gameId === 'wordle' && !purchase.deliveryStatus && crypto.createHmac('sha256', secret).update(JSON.stringify([handle, current.startTime, current.state.word])).digest('hex');
      return res.json({ ...visible, staleRound: !current || current.state.gameOver || current.startTime !== purchase.startTime || (roundKey(handle, current) !== purchase.roundKey && legacyKey !== purchase.roundKey) });
    };
    const finish = async purchase => {
      if (purchase.handle !== handle) return res.status(409).json({ ok: false, error: 'hint_action_conflict' });
      if (!purchase.ok || purchase.deliveryStatus !== 'pending') return await send(purchase);
      // No reveal reaches the browser while its allowance debit is provisional.
      const current = await currentRound();
      const active = current && !current.state.gameOver && current.startTime === purchase.startTime && roundKey(handle, current) === purchase.roundKey;
      const fresh = active && candidateBuilder(current.state).some(hint => hint.position === purchase.hint.position && JSON.stringify(hint) === JSON.stringify(purchase.hint));
      if (fresh) await beforeDelivery(purchase, identity);
      return await send(await relay('/api/hints/reveal/settle', { ...identity, disposition: fresh ? 'deliver' : 'cancel', reason: active ? 'nothing_to_reveal' : 'round_changed' }));
    };
    try {
      const receipt = await relay('/api/hints/reveal/receipt', identity);
      if (!receipt.ok) throw Error('Receipt lookup failed');
      if (receipt.found) return await finish(receipt.purchase);
      if (recoverOnly) return res.json({ ok: false, reason: 'hint_receipt_missing', remaining: null });
      const close = reason => relay('/api/hints/reveal/close', { ...identity, handle, startTime: expectedStartTime, reason });
      let round = await currentRound();
      if (!round || round.state.gameOver || typeof expectedStartTime !== 'string' || expectedStartTime !== round.startTime) return await send(await close('round_changed'));
      let candidates = candidateBuilder(round.state);
      if (!candidates.length) return await send(await close('nothing_to_reveal'));
      const key = roundKey(handle, round);
      // Entitlement work completes before the final game snapshot and debit.
      const preparation = await relay('/api/hints/reveal/prepare', { ...identity, handle, startTime: round.startTime, roundKey: key, candidates });
      if (!preparation.ok) throw Error('Hint preparation unavailable');
      if (preparation.purchase) return await finish(preparation.purchase);
      round = await currentRound();
      if (!round || round.state.gameOver || round.startTime !== expectedStartTime || roundKey(handle, round) !== key) return await send(await close('round_changed'));
      candidates = candidateBuilder(round.state);
      if (!candidates.length) return await send(await close('nothing_to_reveal'));
      const purchase = await relay('/api/hints/reveal', { ...identity, handle, startTime: round.startTime, roundKey: key, candidates, preparedToken: preparation.preparedToken });
      return await finish(purchase);
    } catch (_) { return res.status(503).json({ ok: false, error: 'hint_retry_required' }); }
  };
}
Object.assign(module.exports, { createTransactionalHintHandler, candidatesForBetwixt, candidatesForSymbols });
