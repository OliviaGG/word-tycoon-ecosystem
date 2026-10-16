// Use the shared stream-widget card on Subtextle game pages.
export class WinOverlay {
  static _ready = null;

  static load() {
    if (window.WinCard) return Promise.resolve(window.WinCard);
    if (!WinOverlay._ready) {
      WinOverlay._ready = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://wordtycoon.live/js/win-card.js?v=result-announcement-20261003';
        script.onload = () => window.WinCard ? resolve(window.WinCard) : reject(new Error('WinCard unavailable'));
        script.onerror = () => { script.remove(); reject(new Error('Could not load shared win card')); };
        document.head.appendChild(script);
      }).catch(error => { WinOverlay._ready = null; throw error; });
    }
    return WinOverlay._ready;
  }

  constructor(domRenderer) {
    this.domRenderer = domRenderer;
    this._generation = 0;
    this._key = null;
    // Existing solo Share controls are appended here, including while loading.
    this.element = document.createElement('div');
    this.element.className = 'subtextle-win-actions';
    if (!document.getElementById('subtextle-win-card-layout')) {
      const style = document.createElement('style');
      style.id = 'subtextle-win-card-layout';
      // Reserve space for the widget avatar's deliberate 48px corner spill.
      style.textContent = '@media(max-width:560px){#wt-win-card.subtextle-win-card{margin-left:24px}#wt-win-card.subtextle-win-card .win-card{width:calc(100vw - 76px);max-width:calc(100vw - 76px)}}';
      document.head.appendChild(style);
    }
    this.object3D = {
      position: { x: 0, y: 0, z: 0, set() {} },
      rotation: { x: 0, y: 0, z: 0 },
      get visible() { return true; },
      set visible(value) {},
    };
    WinOverlay.load().catch(() => {});
  }

  async show(word, user, pot, guessCount, ctx = {}) {
    const params = new URLSearchParams(location.search);
    // The surrounding stream dashboard already owns its win-card widget.
    if (window.__WT_STREAM_WIDGET || params.get('stream_widget') === '1'
      || (window.self !== window.top && params.has('obs'))) return;
    if (!user) return;
    const key = JSON.stringify([word, user.platform, user.platformUserId || user.displayName, guessCount]);
    if (this._key === key) return;
    this._key = key;
    const generation = ++this._generation;
    this.element.replaceChildren();
    try {
      const card = await WinOverlay.load();
      if (generation !== this._generation) return;
      const previousForce = window.WIN_CARD_FORCE;
      // A standalone game page may use OBS styling without a parent widget.
      window.WIN_CARD_FORCE = true;
      try {
        const show = window.__SP_MODE ? card.showSolo : card.showMp;
        show({
          game: 'subtextle', gameName: 'Subtextle', word,
          winner: user, jackpot: pot, guessCount,
          targetFinder: ctx.targetFinder,
          topPlayers: ctx.topPlayers || ctx.podium || [],
          autoHideMs: 10000,
        });
        document.getElementById('wt-win-card')?.classList.add('subtextle-win-card');
        document.querySelector('#wt-win-card .wc-actions')?.appendChild(this.element);
      } finally {
        window.WIN_CARD_FORCE = previousForce;
      }
    } catch (error) {
      if (generation === this._generation) this._key = null;
      console.error('[Subtextle win card]', error);
    }
  }

  hide() {
    ++this._generation;
    this._key = null;
    this.element.replaceChildren();
    window.WinCard?.hide();
  }
}
