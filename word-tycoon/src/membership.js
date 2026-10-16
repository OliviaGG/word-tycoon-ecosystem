const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');
const db = require('./database');
const profileLogos = require('./profile-logos');
const cosmetics = require('./cosmetics');
const { DATA_DIR } = require('./paths');

const TIERS_PATH = path.join(DATA_DIR, 'membership-tiers.json');
const STRIPE_API_VERSION = '2026-02-25.clover';
const STRIPE_MANAGED_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete']);

const TIER_ALIASES = {
  free: 'free',
  donor: 'donor_class',
  donor_class: 'donor_class',
  donorclass: 'donor_class',
  pookie: 'pookie_pass',
  pookie_pass: 'pookie_pass',
  pookiepass: 'pookie_pass'
};

const TIER_RANK = {
  free: 0,
  donor_class: 1,
  pookie_pass: 2
};

let cachedConfig = null;
let stripeClient = null;
let stripeClientSecret = null;

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function trimToEmpty(value) {
  return hasText(value) ? value.trim() : '';
}

function cleanObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function toStripeMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
      .map(([key, value]) => [key, String(value).trim()])
  );
}

function getPublicSiteUrl() {
  const configured = trimToEmpty(process.env.PUBLIC_SITE_URL || process.env.CHAT_RELAY_PUBLIC_URL || process.env.APP_BASE_URL);
  return (configured || 'https://wordtycoon.live').replace(/\/+$/, '');
}

function getBillingConfig() {
  const siteUrl = getPublicSiteUrl();
  return {
    provider: 'stripe',
    apiVersion: STRIPE_API_VERSION,
    siteUrl,
    checkoutSuccessUrl: trimToEmpty(process.env.STRIPE_CHECKOUT_SUCCESS_URL) || `${siteUrl}/me?tab=pass&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    checkoutCancelUrl: trimToEmpty(process.env.STRIPE_CHECKOUT_CANCEL_URL) || `${siteUrl}/me?tab=pass&checkout=cancelled`,
    membershipPortalUrl: trimToEmpty(process.env.STRIPE_PORTAL_RETURN_URL) || `${siteUrl}/me?tab=pass`,
    webhookConfigured: hasText(process.env.STRIPE_WEBHOOK_SECRET),
    donorClassPriceId: trimToEmpty(process.env.STRIPE_PRICE_DONOR_CLASS),
    pookiePassPriceId: trimToEmpty(process.env.STRIPE_PRICE_POOKIE_PASS)
  };
}

function loadTierConfig() {
  if (cachedConfig) return cachedConfig;
  const raw = JSON.parse(fs.readFileSync(TIERS_PATH, 'utf8'));
  const tiers = Array.isArray(raw.tiers) ? raw.tiers : [];
  const byId = Object.fromEntries(tiers.map((tier) => [tier.id, tier]));
  cachedConfig = { tiers, byId };
  return cachedConfig;
}

function normalizeTier(tier) {
  const normalized = String(tier || 'free').trim().toLowerCase();
  return TIER_ALIASES[normalized] || 'free';
}

function getTierRank(tier) {
  return TIER_RANK[normalizeTier(tier)] || 0;
}

function getTierConfig(tier) {
  const config = loadTierConfig();
  return config.byId[normalizeTier(tier)] || config.byId.free;
}

function listTierConfigs() {
  return loadTierConfig().tiers.map((tier) => ({ ...tier }));
}

function getStripePriceIdForTier(tier) {
  const normalizedTier = normalizeTier(tier);
  const billing = getBillingConfig();
  if (normalizedTier === 'donor_class') return billing.donorClassPriceId;
  if (normalizedTier === 'pookie_pass') return billing.pookiePassPriceId;
  return '';
}

function getTierForStripePriceId(priceId) {
  if (!hasText(priceId)) return 'free';
  const normalizedPriceId = priceId.trim();
  for (const tier of loadTierConfig().tiers) {
    if (tier.id !== 'free' && getStripePriceIdForTier(tier.id) === normalizedPriceId) {
      return tier.id;
    }
  }
  return 'free';
}

function isPremiumUnlocked(tier) {
  return !!getTierConfig(tier)?.premiumPassUnlocked;
}

function getCurrentPeriodKey(input = null) {
  const date = input ? new Date(input) : new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getMembershipState(discordUserId) {
  const membership = db.getMembership(discordUserId);
  const tier = normalizeTier(membership?.tier);
  const tierConfig = getTierConfig(tier);
  const status = String(membership?.status || 'inactive').toLowerCase();
  const active = tier !== 'free' && (status === 'active' || status === 'trialing');
  if (active && getTierRank(tier) >= TIER_RANK.donor_class) {
    // Membership-perk profile logos: granted lazily so existing subscribers
    // pick them up without a backfill. Once granted they are kept.
    try {
      for (const logo of profileLogos.getMembershipLogos()) {
        db.grantProfileLogo(discordUserId, logo.id, 'membership');
      }
    } catch (err) {
      console.error('[Membership] membership logo grant failed:', err?.message || err);
    }
    // Checkout may happen before a player is linked. Recover the missing sets
    // on the next membership read; recorded grants never re-equip a styled set.
    try {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (player?.id) {
        const setKeys = tier === 'pookie_pass'
          ? ['donor_class', 'superfan', 'super_donor'] : ['donor_class'];
        for (const setKey of setKeys) {
          cosmetics.grantSetToPlayer(db, player.id, setKey, 'membership:reconcile');
        }
      }
    } catch (err) {
      console.error('[Membership] membership set reconciliation failed:', err?.message || err);
    }
  }
  return {
    ...membership,
    tier,
    status,
    active,
    tierRank: getTierRank(tier),
    premiumPassUnlocked: active && isPremiumUnlocked(tier),
    monthlyGiftCoins: 0,
    tierConfig
  };
}

function requireStripeClient() {
  const secretKey = trimToEmpty(process.env.STRIPE_SECRET_KEY);
  if (!secretKey) {
    throw new Error('Stripe secret key is not configured');
  }

  if (!stripeClient || stripeClientSecret !== secretKey) {
    stripeClient = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
    stripeClientSecret = secretKey;
  }

  return stripeClient;
}

function toIsoTimestamp(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function getSubscriptionItemPeriodValue(subscription, field) {
  const item = Array.isArray(subscription?.items?.data) ? subscription.items.data[0] : null;
  return item && Object.prototype.hasOwnProperty.call(item, field) ? item[field] : null;
}

function getInvoiceSubscriptionId(invoice) {
  if (hasText(invoice?.subscription)) return invoice.subscription.trim();

  const parentSubscription = invoice?.parent?.subscription_details?.subscription;
  if (hasText(parentSubscription)) return parentSubscription.trim();

  const lineSubscription = invoice?.lines?.data?.find((line) => {
    return hasText(line?.subscription) || hasText(line?.parent?.subscription_item_details?.subscription);
  });
  if (!lineSubscription) return '';

  return trimToEmpty(lineSubscription.subscription || lineSubscription.parent?.subscription_item_details?.subscription);
}

function getInvoiceLinePriceId(line) {
  return trimToEmpty(
    line?.price?.id
    || line?.pricing?.price_details?.price
  );
}

function getMetadataValue(metadata, keys) {
  if (!metadata || typeof metadata !== 'object') return '';
  for (const key of keys) {
    if (hasText(metadata[key])) return metadata[key].trim();
  }
  return '';
}

function extractDiscordUserId(object) {
  if (!object || typeof object !== 'object') return '';
  return getMetadataValue(object.metadata, ['discordUserId', 'discord_user_id'])
    || (hasText(object.client_reference_id) ? object.client_reference_id.trim() : '');
}

function extractTier(object) {
  if (!object || typeof object !== 'object') return 'free';

  const fromMetadata = getMetadataValue(object.metadata, ['tier', 'membershipTier', 'membership_tier']);
  if (fromMetadata) return normalizeTier(fromMetadata);

  const subscriptionPriceId = object.items?.data?.[0]?.price?.id;
  if (hasText(subscriptionPriceId)) return getTierForStripePriceId(subscriptionPriceId);

  const lineItemPriceId = object.lines?.data?.find((line) => hasText(line?.price?.id))?.price?.id;
  if (hasText(lineItemPriceId)) return getTierForStripePriceId(lineItemPriceId);

  return 'free';
}

async function ensureStripeCustomer({ discordUserId, email, name }) {
  const stripe = requireStripeClient();
  const membership = db.getMembership(discordUserId);
  const customerMetadata = toStripeMetadata({ discordUserId });
  const trimmedEmail = trimToEmpty(email);
  const trimmedName = trimToEmpty(name);

  if (hasText(membership?.stripe_customer_id)) {
    try {
      const existingCustomer = await stripe.customers.retrieve(membership.stripe_customer_id);
      if (!existingCustomer.deleted) {
        const updates = {};
        if (trimmedEmail && existingCustomer.email !== trimmedEmail) updates.email = trimmedEmail;
        if (trimmedName && existingCustomer.name !== trimmedName) updates.name = trimmedName;
        if (getMetadataValue(existingCustomer.metadata, ['discordUserId', 'discord_user_id']) !== discordUserId) {
          updates.metadata = customerMetadata;
        }
        if (Object.keys(updates).length > 0) {
          return stripe.customers.update(existingCustomer.id, cleanObject(updates));
        }
        return existingCustomer;
      }
    } catch (error) {
      console.warn(`[Membership] Failed to reuse Stripe customer ${membership.stripe_customer_id}: ${error.message}`);
    }
  }

  const createdCustomer = await stripe.customers.create(cleanObject({
    email: trimmedEmail || undefined,
    name: trimmedName || undefined,
    metadata: customerMetadata
  }));

  db.upsertMembership(discordUserId, {
    tier: membership?.tier || 'free',
    status: membership?.status || 'inactive',
    stripe_customer_id: createdCustomer.id
  });

  return createdCustomer;
}

async function createCheckoutSession({ discordUserId, tier, customerEmail, customerName }) {
  const normalizedTier = normalizeTier(tier);
  if (normalizedTier === 'free') {
    throw new Error('Free Tier does not require checkout');
  }

  // Retired memberships (e.g. Pookie Pass, retired 2026-07-12) can no longer be
  // purchased. Existing subscribers keep their benefits; only NEW checkout is
  // blocked. Data-driven via the `retired` flag in membership-tiers.json.
  if (getTierConfig(normalizedTier) && getTierConfig(normalizedTier).retired) {
    const error = new Error(`${getTierConfig(normalizedTier).displayName || 'This membership'} is no longer available for purchase.`);
    error.code = 'tier_retired';
    throw error;
  }

  const billing = getBillingConfig();
  const priceId = getStripePriceIdForTier(normalizedTier);
  if (!priceId) {
    throw new Error(`${getTierConfig(normalizedTier)?.displayName || 'Membership'} Stripe price is not configured`);
  }

  const membership = getMembershipState(discordUserId);
  if (membership.stripe_subscription_id && STRIPE_MANAGED_STATUSES.has(membership.status)) {
    const error = new Error('Existing Stripe subscription must be managed in the billing portal');
    error.code = 'subscription_exists';
    try {
      const portal = await createPortalSession({ discordUserId });
      error.portalUrl = portal.url;
    } catch {
      error.portalUrl = '';
    }
    throw error;
  }

  const stripe = requireStripeClient();
  const customer = await ensureStripeCustomer({
    discordUserId,
    email: customerEmail,
    name: customerName
  });

  if (!hasText(billing.checkoutSuccessUrl) || !hasText(billing.checkoutCancelUrl)) {
    throw new Error('Stripe Checkout return URLs are not configured');
  }

  const metadata = toStripeMetadata({
    discordUserId,
    tier: normalizedTier
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    client_reference_id: discordUserId,
    allow_promotion_codes: true,
    success_url: billing.checkoutSuccessUrl,
    cancel_url: billing.checkoutCancelUrl,
    // Optional TikTok handle collected on the Stripe-hosted page. The
    // checkout.session.completed webhook auto-links it (tiktok:<handle> →
    // this account) so chat perks reach the buyer's TikTok identity.
    custom_fields: [{
      key: 'tiktok_username',
      label: { type: 'custom', custom: 'TikTok username (unlocks chat perks)' },
      type: 'text',
      optional: true,
      text: { maximum_length: 60 }
    }],
    line_items: [{
      price: priceId,
      quantity: 1
    }],
    customer_update: {
      name: 'auto',
      address: 'auto'
    },
    metadata,
    subscription_data: {
      metadata,
      billing_mode: { type: 'flexible' }
    }
  });

  db.upsertMembership(discordUserId, {
    tier: membership.tier || normalizedTier,
    status: membership.status || 'inactive',
    stripe_customer_id: customer.id
  });

  return {
    ok: true,
    tier: normalizedTier,
    url: session.url,
    sessionId: session.id
  };
}

// ── Pookie Tok (one-time guest checkout for a stream message) ──────────
// Chat Relay owns all the feature logic; WT just mints a one-time Stripe
// Checkout carrying an opaque token, and (on payment) hands that token back to
// Chat Relay. No account, no subscription, no pre-created Price ID.
async function createPookieTokCheckout({ token, amountCents, productName, successUrl, cancelUrl }) {
  const amount = Math.round(Number(amountCents));
  if (!hasText(token)) throw new Error('Missing token');
  if (!Number.isFinite(amount) || amount < 50) throw new Error('Invalid amount (Stripe minimum is 50 cents)');
  if (!hasText(successUrl) || !hasText(cancelUrl)) throw new Error('Missing return URLs');

  const stripe = requireStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amount,
        product_data: { name: (hasText(productName) ? String(productName) : 'Pookie Tok message').slice(0, 250) }
      }
    }],
    metadata: { type: 'pookie_tok', token: String(token) }
  });
  return { ok: true, url: session.url, sessionId: session.id };
}

// Fire-and-forget notify to Chat Relay's internal endpoint on completed payment.
async function notifyPookieTokPaid(object) {
  const token = object?.metadata?.token;
  if (!hasText(token)) return;
  const base = trimToEmpty(process.env.CHAT_RELAY_URL) || 'http://localhost:3000';
  const secret = process.env.GAME_API_SECRET;
  try {
    const r = await fetch(`${base}/api/internal/pookie-tok/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': secret },
      body: JSON.stringify({ token, stripeSessionId: object.id })
    });
    if (!r.ok) console.error(`[PookieTok] Chat Relay returned HTTP ${r.status} for token ${token}`);
  } catch (err) {
    console.error('[PookieTok] Failed to notify Chat Relay:', err.message);
  }
}

// ── Hint Recharge (one-time payment: $1 USD = 10 hints) ────────────────
// Buyers must be signed in so we can stamp their Discord id into metadata and
// credit the right account on checkout.session.completed.
const HINT_RECHARGE_MIN_DOLLARS = 1;
const HINT_RECHARGE_MAX_DOLLARS = 100;
const HINTS_PER_DOLLAR = 10;

function validateHintRechargeDollars(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return { ok: false, error: 'Invalid dollar amount' };
  if (n < HINT_RECHARGE_MIN_DOLLARS) return { ok: false, error: `Minimum recharge is $${HINT_RECHARGE_MIN_DOLLARS}` };
  if (n > HINT_RECHARGE_MAX_DOLLARS) return { ok: false, error: `Maximum recharge is $${HINT_RECHARGE_MAX_DOLLARS}` };
  return { ok: true, dollars: Math.floor(n) };
}

async function createHintRechargeCheckout({ discordUserId, dollars, successUrl, cancelUrl }) {
  if (!hasText(discordUserId)) throw new Error('Missing discordUserId');
  const validated = validateHintRechargeDollars(dollars);
  if (!validated.ok) {
    const error = new Error(validated.error);
    error.code = 'invalid_amount';
    throw error;
  }
  if (!hasText(successUrl) || !hasText(cancelUrl)) throw new Error('Missing return URLs');

  const dollarsInt = validated.dollars;
  const hints = dollarsInt * HINTS_PER_DOLLAR;
  const amountCents = dollarsInt * 100;

  const stripe = requireStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: (await ensureStripeCustomer({ discordUserId })).id,
    client_reference_id: discordUserId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: `${hints} Hint Recharge` }
      }
    }],
    metadata: toStripeMetadata({
      type: 'hint_recharge',
      discordUserId,
      dollars: String(dollarsInt),
      hints: String(hints)
    })
  });

  return { ok: true, url: session.url, sessionId: session.id, hints, dollars: dollarsInt };
}

async function notifyHintRechargePaid(object) {
  const discordUserId = extractDiscordUserId(object);
  const hintsRaw = getMetadataValue(object.metadata, ['hints']);
  const hints = Math.max(0, Math.floor(Number(hintsRaw) || 0));
  if (!hasText(discordUserId) || hints <= 0) {
    console.warn('[HintRecharge] webhook missing discordUserId or hints', object?.id, hintsRaw);
    return;
  }
  const base = trimToEmpty(process.env.CHAT_RELAY_URL) || 'http://localhost:3000';
  const secret = process.env.GAME_API_SECRET;
  try {
    const r = await fetch(`${base}/api/internal/hints/recharge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': secret },
      body: JSON.stringify({ discordId: discordUserId, hints, stripeSessionId: object.id })
    });
    if (!r.ok) console.error(`[HintRecharge] Chat Relay returned HTTP ${r.status} for session ${object.id}`);
  } catch (err) {
    console.error('[HintRecharge] Failed to notify Chat Relay:', err.message);
  }
}

async function createPortalSession({ discordUserId }) {
  const billing = getBillingConfig();
  const membership = db.getMembership(discordUserId);
  const customerId = trimToEmpty(membership?.stripe_customer_id);
  if (!customerId) {
    throw new Error('No Stripe customer is associated with this membership yet');
  }
  if (!hasText(billing.membershipPortalUrl)) {
    throw new Error('Stripe billing portal return URL is not configured');
  }

  const stripe = requireStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: billing.membershipPortalUrl
  });

  return {
    ok: true,
    url: session.url
  };
}

async function grantMonthlyBenefits(discordUserId, options = {}) {
  return {
    ok: true,
    granted: false,
    amount: 0,
    reason: 'no_monthly_grant',
    membership: getMembershipState(discordUserId)
  };
}

function buildStripeMembershipEvent(subscription, overrides = {}) {
  const customer = subscription?.customer;
  const customerId = typeof customer === 'string' ? customer : customer?.id;
  const subscriptionTier = overrides.tier || extractTier(subscription);
  const discordUserId = overrides.discordUserId
    || extractDiscordUserId(subscription)
    || (typeof customer === 'object' ? extractDiscordUserId(customer) : '');
  const periodStart = subscription?.current_period_start ?? getSubscriptionItemPeriodValue(subscription, 'current_period_start');
  const periodEnd = subscription?.current_period_end ?? getSubscriptionItemPeriodValue(subscription, 'current_period_end');

  return {
    discordUserId,
    tier: subscriptionTier,
    status: String(overrides.status || subscription?.status || 'inactive').toLowerCase(),
    stripeCustomerId: overrides.stripeCustomerId || customerId || '',
    stripeSubscriptionId: overrides.stripeSubscriptionId || subscription?.id || '',
    currentPeriodStart: overrides.currentPeriodStart || toIsoTimestamp(periodStart),
    currentPeriodEnd: overrides.currentPeriodEnd || toIsoTimestamp(periodEnd),
    cancelAtPeriodEnd: Object.prototype.hasOwnProperty.call(overrides, 'cancelAtPeriodEnd')
      ? !!overrides.cancelAtPeriodEnd
      : !!subscription?.cancel_at_period_end,
    grantBenefits: Object.prototype.hasOwnProperty.call(overrides, 'grantBenefits')
      ? overrides.grantBenefits
      : false
  };
}

async function syncMembershipFromStripeEvent(event = {}) {
  const discordUserId = event.discordUserId || event.discord_user_id;
  if (!discordUserId) {
    return { ok: false, message: 'Missing discordUserId' };
  }

  const normalizedTier = normalizeTier(event.tier);
  const normalizedStatus = String(event.status || 'inactive').toLowerCase();
  const result = db.upsertMembership(discordUserId, {
    tier: normalizedTier,
    status: normalizedStatus,
    stripe_customer_id: event.stripeCustomerId || event.stripe_customer_id,
    stripe_subscription_id: event.stripeSubscriptionId || event.stripe_subscription_id,
    current_period_start: event.currentPeriodStart || event.current_period_start || null,
    current_period_end: event.currentPeriodEnd || event.current_period_end || null,
    cancel_at_period_end: event.cancelAtPeriodEnd || event.cancel_at_period_end ? 1 : 0
  });

  if (!result.ok) return result;

  // Membership cosmetic sets: granted (and auto-equipped) the moment a
  // membership becomes active. Idempotent via player_cosmetic_grants, so
  // renewal events are no-ops.
  //
  // Donor Class set lands at donor_class rank or above. Pookie Pass ALSO gets
  // the Super Fan set on top — it is the non-TikTok route to Super Fan status,
  // so a Pookie holder is entitled to exactly what a TikTok Super Fan gets.
  // Holding both is itself the Super Donor entitlement, so Pookie takes that
  // set too — and it is granted LAST so it is the one left equipped.
  try {
    const state = getMembershipState(discordUserId);
    if (state.active && getTierRank(state.tier) >= TIER_RANK.donor_class) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (player && player.id) {
        const setKeys = ['donor_class'];
        if (getTierRank(state.tier) >= TIER_RANK.pookie_pass) setKeys.push('superfan', 'super_donor');
        for (const setKey of setKeys) {
          const grant = cosmetics.grantSetToPlayer(db, player.id, setKey, `stripe:${normalizedStatus}`);
          if (grant.ok && !grant.alreadyGranted) {
            console.log(`[Membership] Granted ${setKey} set to player ${player.id} (discord ${discordUserId})`);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Membership] membership set grant failed:', err.message);
  }

  return {
    ok: true,
    membership: getMembershipState(discordUserId),
    monthlyGrant: null
  };
}

function constructStripeWebhookEvent(rawBody, signature) {
  const webhookSecret = trimToEmpty(process.env.STRIPE_WEBHOOK_SECRET);
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret is not configured');
  }
  if (!rawBody || !signature) {
    throw new Error('Missing Stripe webhook signature');
  }
  const stripe = requireStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

async function retrieveStripeSubscription(subscriptionId) {
  if (!hasText(subscriptionId)) return null;
  const stripe = requireStripeClient();
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['customer', 'items.data.price']
  });
}

async function syncFromSubscriptionObject(subscription, overrides = {}) {
  let syncEvent = buildStripeMembershipEvent(subscription, overrides);
  if (!syncEvent.discordUserId || syncEvent.tier === 'free') {
    try {
      const expandedSubscription = await retrieveStripeSubscription(subscription.id);
      if (expandedSubscription) {
        syncEvent = buildStripeMembershipEvent(expandedSubscription, overrides);
      }
    } catch (error) {
      console.warn(`[Membership] Failed to expand Stripe subscription ${subscription.id}: ${error.message}`);
    }
  }
  return syncMembershipFromStripeEvent(syncEvent);
}

async function handleStripeInvoicePaid(invoice) {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    return { ok: true, ignored: true };
  }

  const subscription = await retrieveStripeSubscription(subscriptionId);
  if (!subscription) return { ok: true, ignored: true };

  const syncEvent = buildStripeMembershipEvent(subscription, { grantBenefits: false });
  const syncResult = await syncMembershipFromStripeEvent(syncEvent);
  return {
    ok: true,
    syncResult,
    monthlyGrant: null
  };
}

// Pull the TikTok handle typed into the checkout page's custom field and
// normalize it to the chat-identity form (lowercase handle, no @, no URL —
// matches players.platform_user_id / the relay's "tiktok:<handle>" keys).
function extractCheckoutTiktokHandle(session) {
  const fields = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  const field = fields.find((f) => f?.key === 'tiktok_username');
  const raw = trimToEmpty(field?.text?.value).toLowerCase();
  if (!raw) return '';
  const urlMatch = raw.match(/tiktok\.com\/@?([a-z0-9._]+)/);
  const handle = (urlMatch ? urlMatch[1] : raw.replace(/^@+/, '')).replace(/[^a-z0-9._]/g, '');
  if (!handle || handle.length > 25) return '';
  return handle;
}

// Best-effort auto-link after a paid checkout: never touches the membership
// sync result, and never re-points a handle that already belongs to a
// DIFFERENT account (typed text is unverified — first verified/typed claim
// wins, conflicts are logged for manual review).
function autoLinkTiktokFromCheckout(session, discordUserId) {
  const handle = extractCheckoutTiktokHandle(session);
  if (!handle || !hasText(discordUserId)) return;
  try {
    const existing = db.getDiscordUserForPlatform('tiktok', handle);
    if (existing && String(existing) !== String(discordUserId)) {
      console.warn(`[Membership] Checkout TikTok handle @${handle} already linked to ${existing}; NOT relinking to ${discordUserId}`);
      return;
    }
    if (existing) return;
    // Typed text is unverified, and linking auto-MERGES the handle's entire
    // player (coins/stats) into the buyer's account group — so an established
    // player must never be claimable this way (a hostile buyer could type a
    // big unlinked viewer's handle and absorb their progress). Auto-link only
    // brand-new or trivial players; anything real requires /link → /verify,
    // which proves ownership by chatting from the TikTok account itself.
    const tiktokPlayer = db.getPlayer('tiktok', handle);
    const established = tiktokPlayer && (
      Number(tiktokPlayer.coins) > 10000 ||
      Number(tiktokPlayer.xp) > 10000 ||
      Number(tiktokPlayer.total_taps) > 500
    );
    if (established) {
      console.warn(`[Membership] Checkout TikTok handle @${handle} has an established player (coins=${tiktokPlayer.coins}, xp=${tiktokPlayer.xp}, taps=${tiktokPlayer.total_taps}); NOT auto-linking to ${discordUserId} — needs /verify. Flagged for manual review.`);
      return;
    }
    db.createLinkedAccount(discordUserId, discordUserId, 'tiktok', handle);
    db.mergeLinkedAccounts(discordUserId);
    console.log(`[Membership] Auto-linked tiktok:${handle} → ${discordUserId} from checkout`);
  } catch (error) {
    console.warn(`[Membership] TikTok auto-link failed for @${handle}: ${error.message}`);
  }
}

async function handleStripeWebhookEvent(event) {
  if (!event || !hasText(event.type)) {
    return { ok: false, message: 'Missing Stripe event type' };
  }

  const object = event.data?.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      // Pookie Tok one-time payments ride the same webhook. Intercept BEFORE the
      // subscription-only guard and hand the token back to Chat Relay. This never
      // touches the subscription/invoice paths below.
      if (object?.metadata?.type === 'pookie_tok') {
        await notifyPookieTokPaid(object);
        return { ok: true, pookieTok: true };
      }
      if (object?.metadata?.type === 'hint_recharge') {
        await notifyHintRechargePaid(object);
        return { ok: true, hintRecharge: true };
      }
      if (object?.mode !== 'subscription' || !hasText(object?.subscription)) {
        return { ok: true, ignored: true };
      }
      const subscription = await retrieveStripeSubscription(object.subscription);
      if (!subscription) return { ok: true, ignored: true };
      const sessionTier = extractTier(object);
      autoLinkTiktokFromCheckout(object, extractDiscordUserId(object) || extractDiscordUserId(subscription));
      return syncMembershipFromStripeEvent(buildStripeMembershipEvent(subscription, {
        discordUserId: extractDiscordUserId(object),
        tier: sessionTier !== 'free' ? sessionTier : extractTier(subscription),
        stripeCustomerId: object.customer,
        grantBenefits: false
      }));
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return syncFromSubscriptionObject(object, { grantBenefits: false });
    case 'invoice.paid':
      return handleStripeInvoicePaid(object);
    case 'invoice.payment_failed': {
      if (!hasText(object?.subscription)) return { ok: true, ignored: true };
      const subscription = await retrieveStripeSubscription(object.subscription);
      if (!subscription) return { ok: true, ignored: true };
      return syncMembershipFromStripeEvent(buildStripeMembershipEvent(subscription, { grantBenefits: false }));
    }
    default:
      return { ok: true, ignored: true };
  }
}

function canAccessTier(requiredTier, currentTier) {
  if (!requiredTier) return true;
  return getTierRank(currentTier) >= getTierRank(requiredTier);
}

function getCheckoutUrlForTier(tier) {
  return getStripePriceIdForTier(tier);
}

function getManageSubscriptionUrl() {
  return getBillingConfig().membershipPortalUrl;
}

module.exports = {
  normalizeTier,
  getTierRank,
  getTierConfig,
  listTierConfigs,
  getBillingConfig,
  getStripePriceIdForTier,
  getCheckoutUrlForTier,
  getManageSubscriptionUrl,
  isPremiumUnlocked,
  getCurrentPeriodKey,
  getMembershipState,
  grantMonthlyBenefits,
  createCheckoutSession,
  createPookieTokCheckout,
  createHintRechargeCheckout,
  createPortalSession,
  constructStripeWebhookEvent,
  handleStripeWebhookEvent,
  syncMembershipFromStripeEvent,
  canAccessTier
};
