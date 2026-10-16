// cosmetics-cache.js - Client-side equipped-cosmetics fetch + cache.
// Adapted from Sproutle's cosmetics-cache.js. Plain script (not module) so
// main.js / streamer.js can use window.cosmeticsCache.

(function () {
  const cache = new Map();
  const TTL = 60 * 1000; // 1 minute

  function invalidatePlayer(platform, platformUserId, equipped) {
    // Same normalisation as the read path, or this writes under a key that
    // getPlayerCosmetics will never look up.
    const key = `${platform}:${bareId(platform, platformUserId)}`;
    if (equipped) {
      cache.set(key, { data: equipped, expiresAt: Date.now() + TTL });
    } else {
      cache.delete(key);
    }
  }

  async function getPlayerCosmetics(platform, userId) {
    if (!platform || !userId) return {};
    // The game passes the IDENTITY KEY ("discord:<id>"); this endpoint wants the
    // bare id and answers a prefixed one with an empty set rather than an error.
    const id = bareId(platform, userId);
    const key = `${platform}:${id}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    try {
      const res = await fetch(`/api/cosmetics/${encodeURIComponent(platform)}/${encodeURIComponent(id)}`);
      const data = res.ok ? (await res.json()).equipped || {} : {};
      cache.set(key, { data, expiresAt: Date.now() + TTL });
      return data;
    } catch {
      return cached ? cached.data : {};
    }
  }

  // ── Perks (Super Donor / Super Fan / Donor Class / Fan Club) ─────────
  //
  // 🔴 WHY THIS EXISTS. The game server never learns anything but Fan Club:
  // relay-client.js only pulls 'fan-club' out of user.badges, and
  // session-manager.resolveWebSession() has no perk fields at all. game.js and
  // round-runner.js faithfully forward `session.isSuperfan` / `session.isDonor`
  // — which nothing ever assigns — so every payload says false and PerkBadges
  // draws the Fan Club heart for a Super Donor.
  //
  // The hub's /api/public/perks is public, CORS-open to this origin, and
  // returns the derived class directly, so the correct badge needs NO server
  // change. Resolved client-side and merged over whatever the socket sent.
  const HUB = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
    ? 'http://localhost:3000' : 'https://wordtycoon.live';
  const perkCache = new Map();
  const PERK_TTL_HIT = 5 * 60 * 1000;
  // 🔴 A negative answer gets a SHORT ttl on purpose: /api/public/perks fails
  // OPEN to all-false while Word Tycoon is restarting and caches that for 60s
  // server-side. Holding a false for five minutes would turn a blip into a
  // visibly wrong badge for the rest of the round.
  const PERK_TTL_MISS = 45 * 1000;

  // platformUserId arrives as the game's identityKey ("discord:179..."), but a
  // hub account id can carry a "discord_" prefix instead (seen live on
  // WikiContexto's podium), and sometimes it is already bare. Peel either
  // discord prefix; never peel gh_ / go_ / tt_, which mark GitHub, Google and
  // TikTok hub accounts and are NOT Discord ids.
  function bareId(platform, userId) {
    const pfx = String(platform || '') + ':';
    let s = String(userId || '');
    if (s.indexOf(pfx) === 0) s = s.slice(pfx.length);
    return s.replace(/^discord[:_]/i, '');
  }

  async function getPlayerPerks(platform, userId) {
    const EMPTY = { superfan: false, donor: false, fanClub: false, superDonor: false };
    if (!platform || !userId) return EMPTY;
    // 🔴 The endpoint keys on `discordId` ONLY — it has no platform/id form,
    // and an unrecognised query silently returns all-false rather than an
    // error, so a wrong param name looks exactly like "this player has no
    // perks". Skip non-Discord identities entirely and keep whatever the
    // socket payload said. session-manager already canonicalises a LINKED
    // chat player to discord:<id>, so linked TikTok/YouTube players still
    // resolve here; unlinked ones keep their relay-supplied Fan Club flag.
    if (String(platform).toLowerCase() !== 'discord') return EMPTY;
    const id = bareId(platform, userId);
    if (!/^\d{5,}$/.test(id)) return EMPTY;
    const key = `discord:${id}`;
    const cached = perkCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    try {
      const res = await fetch(
        `${HUB}/api/public/perks?discordId=${encodeURIComponent(id)}`,
        { credentials: 'omit' }
      );
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
      perkCache.set(key, { data, expiresAt: Date.now() + (any ? PERK_TTL_HIT : PERK_TTL_MISS) });
      return data;
    } catch {
      // Never cache a network failure — the next render should retry.
      return cached ? cached.data : EMPTY;
    }
  }

  window.cosmeticsCache = { getPlayerCosmetics, invalidatePlayer, getPlayerPerks, bareId };
})();
