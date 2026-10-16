/**
 * Sassie co-host bridge for Triangled.
 * Triggers AI reactions on puzzle completion.
 */

const RUNTIME_URL = (process.env.SASSIE_RUNTIME_URL || 'http://localhost:3036').replace(/\/+$/, '');

let enabled = true;
let lastReactionTime = 0;
const REACTION_COOLDOWN = 15000;

function init() {
  enabled = process.env.SASSIE_ENABLED !== 'false';
  if (!enabled) {
    console.log('[Sassie] Disabled for Triangled');
    return;
  }
  console.log(`[Sassie] Triangled bridge ready (${RUNTIME_URL})`);
}

async function triggerReaction(text, overrides = {}) {
  if (!enabled) return;

  const now = Date.now();
  if (now - lastReactionTime < REACTION_COOLDOWN) return;
  lastReactionTime = now;

  const reply = String(text || '').trim().substring(0, 500);
  if (!reply) return;

  const style = {
    emotion: 'proud',
    motion: 'clap',
    intensity: 0.85,
    priority: 'normal',
    ...overrides
  };

  try {
    const response = await fetch(`${RUNTIME_URL}/api/runtime/sassie-say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: reply,
        emotion: style.emotion,
        motion: style.motion,
        intensity: style.intensity,
        priority: style.priority
      })
    });
    if (!response.ok) {
      console.warn(`[Sassie] triggerReaction ${response.status}`);
    } else {
      console.log(`[Sassie] Reaction triggered: ${reply}`);
    }
  } catch (error) {
    // Sassie runtime may not be running — silently ignore
  }
}

module.exports = { init, triggerReaction };
