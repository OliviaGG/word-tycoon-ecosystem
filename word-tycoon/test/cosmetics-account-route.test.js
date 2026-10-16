'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerCosmeticsRoutes } = require('../src/routes/cosmetics');

const accountId = 'go_paid';
const discordAlias = '666284476954837003';
const equipped = Object.fromEntries(['hero_badge','name_color','name_glow','profile_border',
  'profile_glow','title','word_color','win_effect','word_glow'].map(category => [category, { __setId: 'donor_class' }]));

function fixture() {
  const routes = new Map();
  const app = { get(path, ...handlers) { routes.set(path, handlers.at(-1)); }, post() {}, delete() {} };
  const db = {
    getDiscordUserForPlatform(platform, id) {
      return platform === 'discord' && id === discordAlias ? accountId : null;
    },
    queryOne(sql, [id]) { return id === accountId ? { preferred_display_name: 'Tprimmz' } : null; },
    resolveAccountProfileImage(id) { return id === accountId ? { profilePic: '/avatar.png' } : {}; },
    // Reproduce the live ordering: the first linked identity has no player row.
    getLinkedAccounts() { return [
      { platform: 'discord', platform_user_id: discordAlias },
      { platform: 'google', platform_user_id: accountId },
      { platform: 'tiktok', platform_user_id: 't.primmz' }
    ]; }
  };
  const calls = [];
  registerCosmeticsRoutes(app, { db, gameEngine: {
    getPlayerCosmeticsForAPI(platform, id) {
      calls.push([platform, id]);
      return platform === 'discord' && id === accountId ? equipped : {};
    }
  }});
  const call = id => {
    let body;
    routes.get('/api/cosmetics/discord/:discordId')({ params: { discordId: id } }, { json(value) { body = value; } });
    return body;
  };
  return { call, calls };
}

for (const id of [accountId, discordAlias]) {
  test(`account cosmetics use the paid player's set for ${id}`, () => {
    const { call, calls } = fixture();
    const result = call(id);
    assert.deepEqual(result.equipped, equipped);
    assert.equal(result.preferredDisplayName, 'Tprimmz');
    assert.equal(result.profilePic, '/avatar.png');
    assert.deepEqual(calls, [['discord', accountId]]);
  });
}

test('an unrelated identity does not receive the paid account cosmetics or profile', () => {
  const { call } = fixture();
  const result = call('unrelated');
  assert.deepEqual(result.equipped, {});
  assert.equal(result.preferredDisplayName, null);
  assert.equal(result.profilePic, null);
});
