// trie.js - CommonJS Trie data structure and dictionary loader

const fs = require('fs');

class TrieNode {
    constructor() {
        this.children = {};
        this.isWord = false;
        this.word = null;
    }
}

class Trie {
    constructor() {
        this.root = new TrieNode();
        this.wordCount = 0;
    }

    insert(word) {
        let node = this.root;
        for (const char of word) {
            if (!node.children[char]) {
                node.children[char] = new TrieNode();
            }
            node = node.children[char];
        }
        if (!node.isWord) {
            node.isWord = true;
            node.word = word;
            this.wordCount++;
        }
    }

    has(word) {
        let node = this.root;
        for (const char of word) {
            if (!node.children[char]) return false;
            node = node.children[char];
        }
        return node.isWord;
    }

    collectWords(node = this.root, out = []) {
        if (node.isWord) out.push(node.word);
        for (const child of Object.values(node.children)) {
            this.collectWords(child, out);
        }
        return out;
    }
}

/**
 * Load words from a file line-by-line into a Trie.
 * If an existing trie is passed, words are inserted into it.
 * Otherwise a new Trie is created and returned.
 * @param {string} filePath - Path to a text file with one word per line
 * @param {Trie} [existingTrie] - Optional existing trie to insert into
 * @returns {Trie}
 */
function loadFromFile(filePath, existingTrie) {
    const trie = existingTrie || new Trie();
    if (!fs.existsSync(filePath)) {
        console.warn(`[Trie] File not found: ${filePath}`);
        return trie;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const line of text.split('\n')) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed.length >= 3 && /^[a-z]+$/.test(trimmed)) {
            trie.insert(trimmed);
        }
    }
    return trie;
}

/**
 * Load an array of words into a Trie.
 * @param {string[]} words - Array of words to insert
 * @param {Trie} [existingTrie] - Optional existing trie to insert into
 * @returns {Trie}
 */
function loadFromWords(words, existingTrie) {
    const trie = existingTrie || new Trie();
    for (const word of words) {
        const trimmed = word.trim().toLowerCase();
        if (trimmed.length >= 3 && /^[a-z]+$/.test(trimmed)) {
            trie.insert(trimmed);
        }
    }
    return trie;
}

module.exports = { Trie, TrieNode, loadFromFile, loadFromWords };
