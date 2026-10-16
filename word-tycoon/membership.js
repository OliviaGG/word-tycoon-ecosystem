const membership = require('../membership');
const seasonPass = require('../season-pass');

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

  app.get('/api/admin/pass/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    const state = seasonPass.getSeasonState(discordUserId);
    res.json(state);
  });

  app.post('/api/admin/pass/:discordUserId/claim', (req, res) => {
    const { discordUserId } = req.params;
    const { lane, tierNumber } = req.body || {};
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    const result = seasonPass.claimReward(discordUserId, lane, tierNumber);
    res.json(result);
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
      const status = error?.code === 'subscription_exists' ? 409 : 503;
      return res.status(status).json({
        ok: false,
        code: error?.code || 'stripe_checkout_error',
        url: error?.portalUrl || '',
        message: error?.message || `${membership.getTierConfig(normalizedTier)?.displayName || 'Membership'} checkout is not configured yet`
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

  app.post('/api/admin/membership/grant-monthly', async (req, res) => {
    const { discordUserId, periodKey } = req.body || {};
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const result = await membership.grantMonthlyBenefits(discordUserId, { periodKey });
    res.json(result);
  });

  app.post('/api/admin/membership/seed-season', (req, res) => {
    const season = seasonPass.ensureConfiguredSeason();
    res.json({ ok: true, season });
  });

  app.post('/api/admin/pass/:discordUserId/award-xp', (req, res) => {
    const { discordUserId } = req.params;
    const { source, amount } = req.body || {};
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const result = seasonPass.awardPassXp(discordUserId, source, amount);
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
