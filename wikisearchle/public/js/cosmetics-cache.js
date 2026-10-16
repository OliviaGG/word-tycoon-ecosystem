// cosmetics-cache.js - Client-side equipped-cosmetics fetch + cache.
// Adapted from Sproutle's cosmetics-cache.js. Plain script (not module) so
// main.js / streamer.js can use window.cosmeticsCache.

(function () {
  const cache = new Map();
  const TTL = 60 * 1000; // 1 minute

  function invalidatePlayer(platform, platformUserId, equipped) {
    const key = `${platform}:${platformUserId}`;
    if (equipped) {
      cache.set(key, { data: equipped, expiresAt: Date.now() + TTL });
    } else {
      cache.delete(key);
    }
  }

  async function getPlayerCosmetics(platform, userId) {
    if (!platform || !userId) return {};
    const key = `${platform}:${userId}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    try {
      const res = await fetch(`/api/cosmetics/${encodeURIComponent(platform)}/${encodeURIComponent(userId)}`);
      const data = res.ok ? (await res.json()).equipped || {} : {};
      cache.set(key, { data, expiresAt: Date.now() + TTL });
      return data;
    } catch {
      return cached ? cached.data : {};
    }
  }

  // ── Perks (Super Donor / Super Fan / Donor Class / Fan Club) ─────────
  //
  // 🔴 WHY THIS EXISTS. server.js (~2163) reads only 'fan-club' and 'superfan'
  // out of msg.user.badges — it never reads 'donor' or 'super-donor', even
  // though Chat Relay stamps both (chat-relay/src/relay.js:969,976). So a
  // Super Donor arrived here indistinguishable from a Super Fan, and a Donor
  // Class holder looked like nobody at all.
  //
  // The hub's /api/public/perks is public, CORS-open to this origin, and
  // returns the derived class directly, so the right badge needs NO server
  // change and no restart of this game.
  const HUB = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
    ? 'http://localhost:3000' : 'https://wordtycoon.live';
  const perkCache = new Map();
  const PERK_TTL_HIT = 5 * 60 * 1000;
  // 🔴 A negative answer gets a SHORT ttl on purpose: /api/public/perks fails
  // OPEN to all-false while Word Tycoon is restarting and caches THAT for 60s
  // server-side. Holding a false for five minutes would turn a blip into a
  // visibly wrong badge for the rest of the round.
  const PERK_TTL_MISS = 45 * 1000;

  // 🔴 The endpoint keys on `discordId` ONLY. There is no platform/id form,
  // and an unrecognised query returns all-false rather than an error — so a
  // wrong param name is indistinguishable from "this player has no perks".
  //
  // On this game a linked player arrives ALREADY folded to platform:'web' with
  // platformUserId = their Discord id (server.js canonicalPlatform), and
  // linkedDiscord comes through null. Everything else — gh_/go_/tt_ prefixed
  // hub accounts, raw chat ids — is not a Discord id and must not be sent.
  // The SAME person reaches this page under several id shapes, all seen live:
  //   1461954840245698662          bare (DayU, linked -> folded to platform 'web')
  //   discord_683055417060098229   hub account id (Olivia, also platform 'web')
  //   discord:683055417060098229   session-manager identityKey form
  // Only a *discord* prefix is ever stripped. gh_ / go_ / tt_ mark GitHub,
  // Google and TikTok hub accounts — those are NOT Discord ids and sending one
  // as discordId returns a confident all-false.
  function toDiscordId(v) {
    const raw = String(v || '');
    const explicit = /^discord[:_]/i.test(raw);
    const s = raw.replace(/^discord[:_]/i, '');
    if (!/^\d{5,}$/.test(s)) return null;
    return { id: s, explicit };
  }
  function discordIdOf(user) {
    if (!user) return null;
    const linked = toDiscordId(user.linkedDiscord);
    if (linked) return linked.id;
    const cand = toDiscordId(user.platformUserId);
    if (!cand) return null;
    // An explicit discord: / discord_ prefix is unambiguous whatever the
    // platform field says. A BARE number is only a Discord id on the surfaces
    // that fold a linked identity into 'web' — a raw TikTok chat id is also
    // all digits and must not be mistaken for one.
    if (cand.explicit) return cand.id;
    const p = String(user.platform || '').toLowerCase();
    return (p === 'web' || p === 'discord') ? cand.id : null;
  }

  async function getPlayerPerks(user) {
    const EMPTY = { superfan: false, donor: false, fanClub: false, superDonor: false };
    const id = discordIdOf(user);
    if (!id) return EMPTY;
    const cached = perkCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    try {
      const res = await fetch(`${HUB}/api/public/perks?discordId=${encodeURIComponent(id)}`,
                             { credentials: 'omit' });
      if (!res.ok) throw new Error('http ' + res.status);
      const j = await res.json();
      const data = {
        superfan: !!j.superfan,
        donor: !!j.donor,
        fanClub: !!j.fanClub,
        // Derived, not stored — mirror PerkBadges.readPerks so an older
        // response shape without the field still resolves the top tier.
        superDonor: !!j.superDonor || (!!j.superfan && !!j.donor),
      };
      const any = data.superfan || data.donor || data.fanClub || data.superDonor;
      perkCache.set(id, { data, expiresAt: Date.now() + (any ? PERK_TTL_HIT : PERK_TTL_MISS) });
      return data;
    } catch {
      // Never cache a network failure — the next render should retry.
      return cached ? cached.data : EMPTY;
    }
  }

  window.cosmeticsCache = { getPlayerCosmetics, invalidatePlayer, getPlayerPerks, discordIdOf };
})();
