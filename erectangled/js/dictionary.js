// dictionary.js - Trie data structure and dictionary loader

class TrieNode {
    constructor() {
        this.children = {};
        this.isWord = false;
        this.word = null;
    }
}

export class Trie {
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
}

export async function loadDictionary(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load dictionary: ${response.statusText}`);
    }
    const text = await response.text();
    const trie = new Trie();
    const words = text.split('\n');
    for (const word of words) {
        const trimmed = word.trim().toLowerCase();
        if (trimmed.length >= 3 && /^[a-z]+$/.test(trimmed)) {
            trie.insert(trimmed);
        }
    }
    console.log(`Dictionary loaded: ${trie.wordCount} words`);
    return trie;
}
