// elo.js - Report finished rounds to Word Tycoon's ELO endpoint.
//
// Word Tycoon owns the cross-game ELO ladder; we POST a normalized round
// summary and Word Tycoon returns updated ELO deltas. This is fire-and-forget
// from our perspective — failures are logged but don't block the round.
//
// Disabled when WORD_EMPIRES_URL or GAME_API_SECRET aren't set, so dev
// machines without the Word Tycoon stack don't spam errors every round.
//
// Wire location: server.js endRound(), called once participants are finalized.

const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const GAME_API_SECRET = process.env.GAME_API_SECRET || null;
const GAME_ID = 'wikirectangled';

let lastReportedAt = 0;
let lastReportError = null;

function isEnabled() {
  return !!(WORD_EMPIRES_URL && GAME_API_SECRET);
}

// `participants` is the same shape `db.endRound` uses:
//   { identityKey, displayName, profileImage, platform, score, xp,
//     wordCount, targetCount, titleWordCount, finalRank }
// Plus we need round metadata: { roundId, articleTitle, startedAt }.
async function reportRound({ roundId, articleTitle, startedAt, participants, foundWords = [] }) {
  if (!isEnabled()) {
    console.log('[ELO] skipped — WORD_EMPIRES_URL / GAME_API_SECRET not configured');
    return { skipped: true };
  }
  // ELO only makes sense with two or more rivals — skip solo finishes.
  const ranked = (participants || []).filter((p) => p && p.identityKey && !['web', 'bot', 'system'].includes(p.platform));
  if (ranked.length < 2) return { skipped: true, reason: 'too few participants' };

  // First-hit time per player (ms since round start) — used by ELO for
  // tie-breakers and to weight quick-finds.
  const firstHitByPlayer = new Map();
  for (const f of foundWords) {
    if (!f || !f.identityKey) continue;
    const t = Number(f.foundAt || f.found_at) || 0;
    if (!firstHitByPlayer.has(f.identityKey) || t < firstHitByPlayer.get(f.identityKey)) {
      firstHitByPlayer.set(f.identityKey, t);
    }
  }
  const startMs = Number(startedAt) || Date.now();

  const payload = {
    game: GAME_ID,
    roundId,
    articleTitle: articleTitle || '?',
    participants: ranked.map((p, idx) => {
      const firstHit = firstHitByPlayer.get(p.identityKey);
      return {
        identityKey: p.identityKey,
        displayName: p.displayName,
        platform: p.platform,
        points: p.score || 0,
        rank: p.finalRank || (idx + 1),
        rankOutOf: ranked.length,
        guesses: p.wordCount || 0,
        hits: p.wordCount || 0,
        firstHitMs: firstHit ? (firstHit - startMs) : null,
        wonRound: (p.finalRank || (idx + 1)) === 1,
        foundTarget: (p.targetCount || 0) > 0,
        targetCount: p.targetCount || 0,
        titleWordCount: p.titleWordCount || 0,
        articleTitle: articleTitle || '?',
      };
    }),
  };

  try {
    const res = await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': GAME_API_SECRET },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      lastReportError = `${res.status} ${text}`;
      console.log(`[ELO] report failed for round #${roundId}: ${lastReportError}`);
      return { ok: false, status: res.status, error: text };
    }
    lastReportedAt = Date.now();
    lastReportError = null;
    let body = null;
    try { body = await res.json(); } catch { /* response may be empty */ }
    return { ok: true, body };
  } catch (e) {
    lastReportError = e.message;
    console.log(`[ELO] report error for round #${roundId}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function getStatus() {
  return {
    enabled: isEnabled(),
    target: WORD_EMPIRES_URL,
    gameId: GAME_ID,
    lastReportedAt,
    lastReportError,
  };
}

module.exports = { reportRound, isEnabled, getStatus };
