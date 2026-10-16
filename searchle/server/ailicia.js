/**
 * ai_licia AI Co-Host Integration
 * Sends game events to ai_licia API for live stream reactions.
 *
 * API: https://api.getailicia.com/v1
 * - POST /events          — contextual data (max 700 chars)
 * - POST /events/generations — trigger AI reaction (max 300 chars)
 */

const BASE_URL = 'https://api.getailicia.com/v1';

let _apiKey = null;
let _channelName = null;
let _lastContextTime = 0;
let _lastReactionTime = 0;

const CONTEXT_COOLDOWN  = 30000;  // 30s between context sends
const REACTION_COOLDOWN = 15000;  // 15s between reactions

function init(apiKey, channelName) {
    if (!apiKey) {
        console.log('[ai_licia] No API key — disabled');
        return;
    }
    _apiKey = apiKey;
    _channelName = channelName || process.env.AI_LICIA_CHANNEL || 'sassie969';
    console.log(`[ai_licia] Initialized (channel: ${_channelName})`);
}

/**
 * Build the event payload in the format ai_licia expects.
 */
function _buildEvent(content, ttl) {
    return {
        eventType: 'GAME_EVENT',
        data: {
            channelName: _channelName,
            content,
            ...(ttl !== undefined && { ttl })
        }
    };
}

/**
 * Send contextual game state (background info for ai_licia).
 * Rate-limited to 1 per 30s. Silently drops if too frequent.
 */
async function sendContext(text, ttl) {
    if (!_apiKey) return;
    const now = Date.now();
    if (now - _lastContextTime < CONTEXT_COOLDOWN) return;
    _lastContextTime = now;

    const content = String(text).substring(0, 700);
    try {
        const r = await fetch(`${BASE_URL}/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${_apiKey}`
            },
            body: JSON.stringify(_buildEvent(content, ttl))
        });
        if (!r.ok) console.warn(`[ai_licia] sendContext ${r.status}: ${await r.text().catch(() => '')}`);
    } catch (e) {
        console.warn('[ai_licia] sendContext error:', e.message);
    }
}

/**
 * Trigger an AI reaction (ai_licia speaks in chat).
 * Rate-limited to 1 per 15s. Silently drops if too frequent.
 */
async function triggerReaction(text) {
    if (!_apiKey) return;
    const now = Date.now();
    if (now - _lastReactionTime < REACTION_COOLDOWN) return;
    _lastReactionTime = now;

    const content = String(text).substring(0, 300);
    try {
        const r = await fetch(`${BASE_URL}/events/generations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${_apiKey}`
            },
            body: JSON.stringify(_buildEvent(content))
        });
        if (!r.ok) console.warn(`[ai_licia] triggerReaction ${r.status}: ${await r.text().catch(() => '')}`);
        else console.log(`[ai_licia] Reaction triggered: ${content}`);
    } catch (e) {
        console.warn('[ai_licia] triggerReaction error:', e.message);
    }
}

module.exports = { init, sendContext, triggerReaction };
