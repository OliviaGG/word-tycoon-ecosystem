const membership = require('../membership');
const cosmetics = require('../cosmetics');

// Cosmetic sets that come with each paid tier. Mirrors the Stripe activation
// path in membership.js — Pookie Pass is the non-TikTok route to Super Fan
// status, so it carries the Super Fan set ON TOP of Donor Class, and holding
// both is the Super Donor entitlement. Order matters: membership sets
// auto-equip on grant, so the higher tier must be granted last to end up the
// one actually worn.
const TIER_COSMETIC_SETS = {
  donor_class: ['donor_class'],
  pookie_pass: ['donor_class', 'superfan', 'super_donor']
};

function registerMembershipRoutes(app, { db }) {
  const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

  app.get('/api/admin/membership/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    const overview = db.getAccountOverview(discordUserId);
    res.json({
      ok: true,
      membership: membership.getMembershipState(discordUserId),
      tiers: membership.listTierConfigs(),
      primaryPlayer: overview.primaryPlayer ? {
        id: overview.primaryPlayer.id,
        displayName: overview.primaryPlayer.display_name,
        giftCoins: overview.primaryPlayer.gift_coins || 0
      } : null,
      grantHistory: db.getMembershipGrantHistory(discordUserId, 12)
    });
  });

  app.post('/api/admin/membership/:discordUserId/checkout', async (req, res) => {
    const { discordUserId } = req.params;
    const { tier, customerEmail, customerName } = req.body || {};
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    const normalizedTier = membership.normalizeTier(tier);
    if (normalizedTier === 'free') {
      return res.status(400).json({ ok: false, message: 'Free Tier does not require checkout' });
    }

    try {
      const result = await membership.createCheckoutSession({
        discordUserId,
        tier: normalizedTier,
        customerEmail,
        customerName
      });
      return res.json(result);
    } catch (error) {
      // Checkout intentionally hands existing Stripe subscriptions off to the
      // billing portal so members can update payment details without creating
      // a duplicate subscription. Treat a successfully-created portal session
      // as a redirect response, not an error; portal clients only navigate for
      // successful HTTP responses.
      if (error?.code === 'subscription_exists' && hasText(error.portalUrl)) {
        return res.json({
          ok: true,
          code: 'subscription_exists',
          destination: 'billing_portal',
          url: error.portalUrl
        });
      }

      const status = error?.code === 'subscription_exists' ? 409 : 503;
      return res.status(status).json({
        ok: false,
        code: error?.code || 'stripe_checkout_error',
        url: error?.portalUrl || '',
        message: error?.message || `${membership.getTierConfig(normalizedTier)?.displayName || 'Membership'} checkout is not configured yet`
      });
    }
  });

  // Pookie Tok one-time guest checkout (called by Chat Relay via wtFetch).
  // Guarded by the /api/admin requireAdminKey middleware, same as the routes
  // above. All feature logic (tiers, filtering, display) lives in Chat Relay.
  app.post('/api/admin/pookie-tok/checkout', async (req, res) => {
    const { token, amountCents, productName, successUrl, cancelUrl } = req.body || {};
    try {
      const result = await membership.createPookieTokCheckout({ token, amountCents, productName, successUrl, cancelUrl });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ ok: false, message: error?.message || 'Pookie Tok checkout failed' });
    }
  });

  // Hint Recharge one-time checkout (called by Chat Relay portal on behalf of a
  // signed-in user). $1 USD = 10 hints; caps at $100 / 1,000 hints per checkout.
  app.post('/api/admin/hints/recharge/checkout', async (req, res) => {
    const { discordUserId, dollars, successUrl, cancelUrl } = req.body || {};
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    try {
      const result = await membership.createHintRechargeCheckout({
        discordUserId,
        dollars,
        successUrl,
        cancelUrl
      });
      return res.json(result);
    } catch (error) {
      return res.status(error?.code === 'invalid_amount' ? 400 : 503).json({
        ok: false,
        code: error?.code || 'stripe_checkout_error',
        message: error?.message || 'Hint recharge checkout is not configured yet'
      });
    }
  });

  app.get('/api/admin/membership/:discordUserId/manage', async (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    try {
      const result = await membership.createPortalSession({ discordUserId });
      return res.json(result);
    } catch (error) {
      return res.status(404).json({
        ok: false,
        message: error?.message || 'Membership management is not configured yet'
      });
    }
  });

  // ─── Manual (non-Stripe) membership tier ──────────────────────────────
  // Backs the relay Members hub's Donor Class control, so the owner can hand
  // someone a paid tier without a subscription and take it back later.
  //
  // Both directions REFUSE a row that carries a stripe_subscription_id. There
  // is nothing useful a local flip could do to a real subscription: granting
  // is redundant, and revoking would neither stop the billing nor survive the
  // next `customer.subscription.updated` webhook, which rewrites this row from
  // Stripe. Cancelling a paying member is a Stripe-dashboard action.
  //
  // Grants are additive on the cosmetics side only — revoking clears the tier
  // but leaves already-granted set items owned, which is exactly what happens
  // today when a Stripe subscription lapses (no revoke path exists).
  app.post('/api/admin/membership/:discordUserId/manual-tier', (req, res) => {
    const { discordUserId } = req.params;
    const { tier } = req.body || {};
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const normalizedTier = membership.normalizeTier(tier);
    if (!TIER_COSMETIC_SETS[normalizedTier]) {
      return res.status(400).json({ ok: false, message: `Cannot grant tier: ${tier}` });
    }

    const existing = db.getMembership(discordUserId) || {};
    if (hasText(existing.stripe_subscription_id)) {
      return res.status(409).json({
        ok: false,
        code: 'stripe_backed',
        message: 'This account has a live Stripe subscription — manage it in Stripe.'
      });
    }

    const result = db.upsertMembership(discordUserId, {
      tier: normalizedTier,
      status: 'active',
      stripe_subscription_id: null,
      current_period_start: null,
      // No period end: a manual grant does not lapse on its own, and
      // getMembershipState reads `status`, never the dates.
      current_period_end: null,
      cancel_at_period_end: 0
    });
    if (!result.ok) return res.status(500).json(result);

    // Same grants the Stripe activation path performs (membership.js
    // syncMembershipFromStripeEvent) — idempotent via player_cosmetic_grants.
    const grantedSets = [];
    try {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (player && player.id) {
        for (const setKey of TIER_COSMETIC_SETS[normalizedTier]) {
          const grant = cosmetics.grantSetToPlayer(db, player.id, setKey, 'admin:manual');
          if (grant.ok && !grant.alreadyGranted) grantedSets.push(setKey);
        }
      }
    } catch (error) {
      console.warn('[Membership] manual-tier set grant failed:', error?.message || error);
    }

    res.json({
      ok: true,
      manual: true,
      grantedSets,
      membership: membership.getMembershipState(discordUserId)
    });
  });

  app.delete('/api/admin/membership/:discordUserId/manual-tier', (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    const existing = db.getMembership(discordUserId) || {};
    if (hasText(existing.stripe_subscription_id)) {
      return res.status(409).json({
        ok: false,
        code: 'stripe_backed',
        message: 'This account has a live Stripe subscription — cancel it in Stripe.'
      });
    }
    if (membership.normalizeTier(existing.tier) === 'free') {
      return res.json({ ok: true, alreadyFree: true, membership: membership.getMembershipState(discordUserId) });
    }

    const result = db.upsertMembership(discordUserId, { tier: 'free', status: 'inactive' });
    if (!result.ok) return res.status(500).json(result);
    res.json({ ok: true, membership: membership.getMembershipState(discordUserId) });
  });

  app.post('/api/admin/membership/grant-monthly', async (req, res) => {
    const { discordUserId, periodKey } = req.body || {};
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const result = await membership.grantMonthlyBenefits(discordUserId, { periodKey });
    res.json(result);
  });

  app.post('/api/stripe/webhook', async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'];
      const event = membership.constructStripeWebhookEvent(req.rawBody, signature);
      await membership.handleStripeWebhookEvent(event);
      res.json({ received: true });
    } catch (error) {
      const status = String(error?.message || '').toLowerCase().includes('signature') ? 400 : 500;
      console.error('[Membership] Stripe webhook failed:', error);
      res.status(status).json({ ok: false, message: error?.message || 'Webhook handling failed' });
    }
  });
}

module.exports = { registerMembershipRoutes };
