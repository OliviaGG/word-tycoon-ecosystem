'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createSoloRewardProof(secret) {
  if (!secret) throw new Error('Solo reward signing secret required');
  const sign = payload => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update('wiki-solo-progress:' + encoded).digest('base64url');
    return encoded + '.' + signature;
  };
  function read(token, accountId, generation) {
    if (typeof token !== 'string' || token.length > 65536) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const expected = crypto.createHmac('sha256', secret).update('wiki-solo-progress:' + parts[0]).digest('base64url');
    const a = Buffer.from(parts[1]), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      return p.accountId === String(accountId) && p.generation === String(generation) && p.version === 1 ? p : null;
    } catch { return null; }
  }
  function fresh(accountId, generation) {
    return { version: 1, accountId: String(accountId), generation: String(generation), titles: [], reveals: [], score: 0, guessCount: 0 };
  }
  function advance(previous, { revealIds, titleNorm, points }) {
    const p = { ...previous, titles: [...previous.titles], reveals: [...previous.reveals], guessCount: previous.guessCount + 1 };
    const seen = new Set(p.reveals);
    const newIds = revealIds.filter(id => !seen.has(id));
    if (newIds.length) {
      p.reveals.push(...newIds);
      p.score += Math.max(0, Math.floor(points));
      if (titleNorm && !p.titles.includes(titleNorm)) p.titles.push(titleNorm);
    }
    return { progress: p, token: sign(p) };
  }
  return { read, fresh, advance };
}

// Reserve before awaiting the bridge, and keep uncertain deliveries for
// reconciliation instead of awarding again after a service restart.
function createSoloRewardClaims(file) {
  let claims = Object.create(null);
  try { claims = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(claims));
    fs.renameSync(temp, file);
  }
  return {
    get: key => claims[key] || null,
    entries: () => Object.entries(claims),
    reserve(key, score) {
      if (claims[key]) return false;
      claims[key] = { status: 'pending', score, at: Date.now() };
      try { save(); } catch (error) { delete claims[key]; throw error; }
      return true;
    },
    finish(key, status) { claims[key] = { ...claims[key], status }; save(); }
  };
}
module.exports = { createSoloRewardProof, createSoloRewardClaims };
