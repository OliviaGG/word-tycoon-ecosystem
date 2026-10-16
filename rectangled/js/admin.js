// admin.js - Settings persistence (admin UI is in admin.html)

const DEFAULT_SETTINGS = {
    rows: 10,
    cols: 8,
    minWordLength: 3,
    wsUrl: 'http://localhost:3000',
    showManualInput: true,
    showFoundWords: true,
    lightMode: false,
    letterScale: 0.5,
    numberScale: 0.3
};

export function loadSettings() {
    try {
        const saved = localStorage.getItem('rectangled_settings');
        if (saved) {
            return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Failed to load settings:', e);
    }
    return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings) {
    try {
        localStorage.setItem('rectangled_settings', JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save settings:', e);
    }
}
