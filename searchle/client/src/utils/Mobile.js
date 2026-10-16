// ===== Mobile Detection =====
// Detects mobile devices and exports performance tier flags.
// Used by rendering components to scale quality automatically.

const ua = navigator.userAgent || '';
// Room embeds explicitly select the phone UI even in a desktop browser.
export const isMobile = (new URLSearchParams(window.location.search).get('mobile') === '1'
  || /Mobi|Android|iPhone|iPad|iPod/i.test(ua)) && !/OBS/i.test(ua);
// Treat any of three signals as OBS-mode: real OBS user-agent, legacy
// ?transparent flag, or ?obs=1 (used by chat-relay's stream-game URL
// builder so the goals overlay iframe and stream-view embeds get the
// transparent / glass treatment in any browser, not just OBS).
const _obsQs = new URLSearchParams(window.location.search);
export const isOBS = /OBS/i.test(ua) || _obsQs.has('transparent') || _obsQs.get('obs') === '1';

// Rough performance tier: 'high' (desktop), 'medium' (modern phone), 'low' (old phone)
// For now, desktop = high, mobile = medium. Can refine later with GPU benchmarking.
export const perfTier = isMobile ? 'medium' : 'high';
