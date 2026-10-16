const DEFAULT_VIEWER_VISIBILITY = Object.freeze({ word_color: false, word_glow: false });
let viewerVisibility = { ...DEFAULT_VIEWER_VISIBILITY };

function getHubApiBase() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:3000';
    }
    return 'https://wordtycoon.live';
}

export function setViewerVisibility(vis) {
    viewerVisibility = vis && typeof vis === 'object'
        ? { ...DEFAULT_VIEWER_VISIBILITY, ...vis }
        : { ...DEFAULT_VIEWER_VISIBILITY };
    return viewerVisibility;
}

export function getViewerVisibility() {
    return { ...viewerVisibility };
}

export function filterWordCosmetics(cos) {
    if (!cos || typeof cos !== 'object') return cos;
    const next = { ...cos };
    for (const [category, enabled] of Object.entries(viewerVisibility)) {
        if (enabled === false) delete next[category];
    }
    return next;
}

export async function loadViewerVisibility() {
    try {
        const res = await fetch(`${getHubApiBase()}/api/me/visibility`, { credentials: 'include' });
        if (!res.ok) return getViewerVisibility();
        const data = await res.json();
        return setViewerVisibility(data && typeof data.visibility === 'object' ? data.visibility : null);
    } catch {
        return getViewerVisibility();
    }
}
