// wordlist.js - Word Bank integration for RecTangled (CommonJS)

const path = require('path');
const { Trie } = require('./trie');

const WORD_BANK_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const GAME_WORD_POLICY_ID = process.env.GAME_WORD_POLICY_ID || 'rectangled';

let gameWordPolicy = { isWordAllowedForGame: () => true };
try {
    gameWordPolicy = require(path.join(RELAY_DIR, 'src', 'game-word-policy.js'));
} catch (error) {
    console.warn('[WordList] Word policy unavailable:', error.message);
}

let trie = null;
let targetSet = new Set();
let frequencyMap = new Map(); // word -> Zipf score

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let refreshTimer = null;

// Fetch the full bank into fresh structures; returns null on failure (any length fetch fails
// or the bank is empty) so callers can decide whether to swap or keep current data.
async function fetchAll() {
    const newTrie = new Trie();
    const newTargetSet = new Set();
    const newFrequencyMap = new Map();

    for (let len = 3; len <= 15; len++) {
        const res = await fetch(`${WORD_BANK_URL}/api/word-bank/dictionary/${len}`);
        const words = await res.json();
        if (!Array.isArray(words)) throw new Error(`dictionary/${len} returned non-array`);
        words.forEach(w => newTrie.insert(w.toLowerCase()));
    }
    if (newTrie.wordCount === 0) throw new Error('dictionary empty after fetch');

    const targetsRes = await fetch(`${WORD_BANK_URL}/api/word-bank/targets`);
    const targetsData = await targetsRes.json();
    if (targetsData && typeof targetsData === 'object') {
        for (const lengthKey of Object.keys(targetsData)) {
            const words = targetsData[lengthKey];
            if (Array.isArray(words)) {
                words.forEach(w => {
                    const normalized = w.toLowerCase();
                    if (gameWordPolicy.isWordAllowedForGame(GAME_WORD_POLICY_ID, 'target', normalized)) {
                        newTargetSet.add(normalized);
                    }
                });
            }
        }
    }

    const freqRes = await fetch(`${WORD_BANK_URL}/api/word-bank/frequency`);
    if (freqRes.ok) {
        const freqData = await freqRes.json();
        for (const [word, score] of Object.entries(freqData)) {
            newFrequencyMap.set(word.toLowerCase(), score);
        }
    }

    return { trie: newTrie, targetSet: newTargetSet, frequencyMap: newFrequencyMap };
}

/**
 * Initialize the word list from the Word Bank API (5 retries, 3s delay).
 * Throws if the bank cannot be reached or returns no words — RecTangled is
 * unplayable without a dictionary, so we want a loud boot failure rather
 * than a server that silently rejects every guess.
 */
async function init() {
    let lastErr = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            console.log(`[WordList] Fetching from Word Bank (attempt ${attempt}/5)...`);
            const fresh = await fetchAll();
            trie = fresh.trie;
            targetSet = fresh.targetSet;
            frequencyMap = fresh.frequencyMap;
            console.log(`[WordList] Loaded ${trie.wordCount} dictionary words, ${targetSet.size} targets, ${frequencyMap.size} frequencies`);
            scheduleRefresh();
            return;
        } catch (err) {
            lastErr = err;
            console.log(`[WordList] Word Bank fetch failed (attempt ${attempt}/5): ${err.message}`);
            if (attempt < 5) {
                console.log('[WordList] Retrying in 3s...');
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
    throw new Error(`[WordList] Could not load from Word Bank after 5 attempts: ${lastErr && lastErr.message}`);
}

function scheduleRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
        try {
            const fresh = await fetchAll();
            trie = fresh.trie;
            targetSet = fresh.targetSet;
            frequencyMap = fresh.frequencyMap;
            console.log(`[WordList] Refreshed from Word Bank (${trie.wordCount} dict, ${targetSet.size} targets, ${frequencyMap.size} freq)`);
        } catch (err) {
            console.warn(`[WordList] Refresh failed, keeping previous data: ${err.message}`);
        }
    }, REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
}

/**
 * Get the initialized Trie.
 */
function getTrie() {
    return trie;
}

/**
 * Check if a word is valid (exists in the dictionary).
 */
function isValidWord(word) {
    return trie ? trie.has(word.toLowerCase()) : false;
}

/**
 * Check if a word is a curated target (common word).
 */
function isTarget(word) {
    return targetSet.has(word.toLowerCase());
}

/**
 * Get the target word Set (for common/rare splitting in Game).
 */
function getTargetSet() {
    return targetSet;
}

/**
 * Get an array of all target words.
 */
function getTargetWords() {
    return [...targetSet];
}

/**
 * Get the total word count in the dictionary.
 */
function getWordCount() {
    return trie ? trie.wordCount : 0;
}

/**
 * Collect all words from the trie (for the SP dictionary endpoint).
 */
function getAllWords() {
    const words = [];
    function collect(node) {
        if (node.isWord) words.push(node.word);
        for (const child of Object.values(node.children)) {
            collect(child);
        }
    }
    if (trie) collect(trie.root);
    return words;
}

/**
 * Get the frequency Map (word -> Zipf score). Used by Game for rarity-based capping.
 */
function getFrequencyMap() {
    return frequencyMap;
}

/**
 * Check if a word has frequency data.
 * Words WITH freq data are "rare" (visible bonus). Words WITHOUT are "hidden" (valid but not shown).
 */
function hasFrequency(word) {
    return frequencyMap.has(word.toLowerCase());
}

module.exports = { init, getTrie, isValidWord, isTarget, getTargetSet, getTargetWords, getWordCount, getAllWords, getFrequencyMap, hasFrequency };
