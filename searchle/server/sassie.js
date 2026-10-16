/**
 * Sassie co-host bridge for Searchle.
 * Replaces the retired external co-host integration with local Sassie runtime calls.
 */

const RUNTIME_URL = (process.env.SASSIE_RUNTIME_URL || 'http://localhost:3036').replace(/\/+$/, '');

let enabled = true;
let lastReactionTime = 0;
let lastContextNoticeTime = 0;

const REACTION_COOLDOWN = 15000;
const CONTEXT_NOTICE_COOLDOWN = 5 * 60 * 1000;

function init() {
    enabled = process.env.SASSIE_ENABLED !== 'false';
    if (!enabled) {
        console.log('[Sassie] Disabled for Searchle');
        return;
    }
    console.log(`[Sassie] Searchle bridge ready (${RUNTIME_URL})`);
}

function choosePresentation(text) {
    const upper = String(text || '').toUpperCase();

    if (upper.includes('WON') || upper.includes('COINS')) {
        return { emotion: 'proud', motion: 'clap', intensity: 0.9, priority: 'high' };
    }
    if (upper.includes('TOP') || upper.includes('CLOSE')) {
        return { emotion: 'impressed', motion: 'lean_in', intensity: 0.76, priority: 'normal' };
    }
    return { emotion: 'excited', motion: 'smile', intensity: 0.72, priority: 'normal' };
}

async function triggerReaction(text, overrides = {}) {
    if (!enabled) return;

    const now = Date.now();
    if (now - lastReactionTime < REACTION_COOLDOWN) return;
    lastReactionTime = now;

    const reply = String(text || '').trim().substring(0, 500);
    if (!reply) return;

    const style = { ...choosePresentation(reply), ...overrides };

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
            console.warn(`[Sassie] triggerReaction ${response.status}: ${await response.text().catch(() => '')}`);
        } else {
            console.log(`[Sassie] Reaction triggered: ${reply}`);
        }
    } catch (error) {
        console.warn('[Sassie] triggerReaction error:', error.message);
    }
}

async function sendContext(text) {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastContextNoticeTime < CONTEXT_NOTICE_COOLDOWN) return;
    lastContextNoticeTime = now;
    console.log(`[Sassie] Context update ignored (legacy provider pattern retired): ${String(text || '').substring(0, 80)}`);
}

module.exports = { init, sendContext, triggerReaction };
