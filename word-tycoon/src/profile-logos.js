const PROFILE_LOGOS = [
  {
    id: 'pl_classic_gold',
    name: 'Classic Gold',
    assetPath: '/portal/assets/profile-logos/classic-gold.png',
    unlockSource: 'free',
    sort: 1
  },
  {
    id: 'pl_neon_arcade',
    name: 'Neon Arcade',
    assetPath: '/portal/assets/profile-logos/neon-arcade.png',
    unlockSource: 'free',
    sort: 2
  },
  {
    id: 'pl_pride_spectrum',
    name: 'Pride Spectrum',
    assetPath: '/portal/assets/profile-logos/pride-spectrum.png',
    unlockSource: 'free',
    sort: 3
  },
  {
    id: 'pl_bronze_builder',
    name: 'Bronze Builder',
    assetPath: '/portal/assets/profile-logos/bronze-builder.png',
    unlockSource: 'daily_claim',
    dailyClaim: { totalClaims: 1 },
    sort: 10
  },
  {
    id: 'pl_matrix_mint',
    name: 'Matrix Mint',
    assetPath: '/portal/assets/profile-logos/matrix-mint.png',
    unlockSource: 'daily_claim',
    dailyClaim: { totalClaims: 7 },
    sort: 11
  },
  {
    id: 'pl_iron_forge',
    name: 'Iron Forge',
    assetPath: '/portal/assets/profile-logos/iron-forge.png',
    unlockSource: 'daily_claim',
    dailyClaim: { totalClaims: 14 },
    sort: 12
  },
  {
    id: 'pl_vault_venture',
    name: 'Vault Venture',
    assetPath: '/portal/assets/profile-logos/vault-venture.png',
    unlockSource: 'daily_claim',
    dailyClaim: { totalClaims: 30 },
    sort: 13
  },
  {
    id: 'pl_void_rune',
    name: 'Void Rune',
    assetPath: '/portal/assets/profile-logos/void-rune.png',
    unlockSource: 'membership',
    membership: { tier: 'donor_class' },
    sort: 21
  },
  {
    id: 'pl_pearl_court',
    name: 'Pearl Court',
    assetPath: '/portal/assets/profile-logos/pearl-court.png',
    unlockSource: 'membership',
    membership: { tier: 'donor_class' },
    sort: 22
  },
  {
    id: 'pl_holo_warden',
    name: 'Holo Warden',
    assetPath: '/portal/assets/profile-logos/holo-warden.png',
    unlockSource: 'membership',
    membership: { tier: 'donor_class' },
    sort: 23
  }
];

const PROFILE_LOGO_MAP = new Map(PROFILE_LOGOS.map((logo) => [logo.id, logo]));
const FREE_PROFILE_LOGO_IDS = new Set(
  PROFILE_LOGOS.filter((logo) => logo.unlockSource === 'free').map((logo) => logo.id)
);
const DAILY_CLAIM_LOGOS = PROFILE_LOGOS
  .filter((logo) => logo.unlockSource === 'daily_claim')
  .sort((a, b) => (a.dailyClaim?.totalClaims || 0) - (b.dailyClaim?.totalClaims || 0));
const MEMBERSHIP_LOGOS = PROFILE_LOGOS.filter((logo) => logo.unlockSource === 'membership');

function cloneLogo(logo) {
  if (!logo) return null;
  return {
    ...logo,
    dailyClaim: logo.dailyClaim ? { ...logo.dailyClaim } : null,
    membership: logo.membership ? { ...logo.membership } : null
  };
}

function getProfileLogoCatalog() {
  return PROFILE_LOGOS.map(cloneLogo);
}

function getProfileLogoById(id) {
  return cloneLogo(PROFILE_LOGO_MAP.get(String(id || '').trim()));
}

function isFreeProfileLogo(id) {
  return FREE_PROFILE_LOGO_IDS.has(String(id || '').trim());
}

function getFreeProfileLogoIds() {
  return [...FREE_PROFILE_LOGO_IDS];
}

function getDailyClaimUnlocks(totalClaims, ownedLogoIds = []) {
  const owned = new Set(Array.isArray(ownedLogoIds) ? ownedLogoIds : []);
  const completedClaims = Math.max(0, Math.floor(Number(totalClaims) || 0));
  return DAILY_CLAIM_LOGOS
    .filter((logo) => completedClaims >= (logo.dailyClaim?.totalClaims || 0) && !owned.has(logo.id))
    .map(cloneLogo);
}

function getNextDailyClaimUnlock(totalClaims, ownedLogoIds = []) {
  const owned = new Set(Array.isArray(ownedLogoIds) ? ownedLogoIds : []);
  const completedClaims = Math.max(0, Math.floor(Number(totalClaims) || 0));
  const nextLogo = DAILY_CLAIM_LOGOS.find((logo) => !owned.has(logo.id) && completedClaims < (logo.dailyClaim?.totalClaims || 0));
  if (!nextLogo) return null;
  return {
    ...cloneLogo(nextLogo),
    claimsAway: Math.max(0, (nextLogo.dailyClaim?.totalClaims || 0) - completedClaims)
  };
}

function getMembershipLogos() {
  return MEMBERSHIP_LOGOS.map(cloneLogo);
}

module.exports = {
  PROFILE_LOGOS,
  getProfileLogoCatalog,
  getProfileLogoById,
  getFreeProfileLogoIds,
  getDailyClaimUnlocks,
  getNextDailyClaimUnlock,
  getMembershipLogos,
  isFreeProfileLogo
};
