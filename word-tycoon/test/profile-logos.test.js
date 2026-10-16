const test = require('node:test');
const assert = require('node:assert/strict');

const profileLogos = require('../src/profile-logos');

test('profile logo catalog exposes free, daily-claim, and season-pass options', () => {
  const catalog = profileLogos.getProfileLogoCatalog();
  assert.equal(catalog.length, 10);
  assert.equal(catalog.filter((logo) => logo.unlockSource === 'free').length, 3);
  assert.equal(catalog.filter((logo) => logo.unlockSource === 'daily_claim').length, 3);
  assert.equal(catalog.filter((logo) => logo.unlockSource === 'season_pass').length, 4);
});

test('daily-claim logo unlocks respect thresholds and already-owned ids', () => {
  assert.deepEqual(
    profileLogos.getDailyClaimUnlocks(0).map((logo) => logo.id),
    []
  );
  assert.deepEqual(
    profileLogos.getDailyClaimUnlocks(1).map((logo) => logo.id),
    ['pl_bronze_builder']
  );
  assert.deepEqual(
    profileLogos.getDailyClaimUnlocks(14, ['pl_bronze_builder']).map((logo) => logo.id),
    ['pl_matrix_mint', 'pl_iron_forge']
  );
});

test('next daily-claim logo points to the next locked milestone', () => {
  const nextEarly = profileLogos.getNextDailyClaimUnlock(0);
  assert.equal(nextEarly.id, 'pl_bronze_builder');
  assert.equal(nextEarly.claimsAway, 1);

  const nextLate = profileLogos.getNextDailyClaimUnlock(7, ['pl_bronze_builder', 'pl_matrix_mint']);
  assert.equal(nextLate.id, 'pl_iron_forge');
  assert.equal(nextLate.claimsAway, 7);

  assert.equal(
    profileLogos.getNextDailyClaimUnlock(14, ['pl_bronze_builder', 'pl_matrix_mint', 'pl_iron_forge']),
    null
  );
});
