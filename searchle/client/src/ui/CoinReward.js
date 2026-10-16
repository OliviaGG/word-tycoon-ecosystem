// ===== Coin Reward =====
// Overlay for displaying coin reward animations.

export class CoinReward {
  constructor() {
    this._injectStyles();
    this._createOverlay();
    this.hideTimer = null;
  }

  init(socket) {
    socket.on('coin-reward', (data) => this.show(data));
  }

  _injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .coin-reward-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .coin-reward-overlay.visible { opacity: 1; }

      .coin-reward-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }

      .coin-reward-label {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 18px;
        font-weight: 700;
        color: #fff;
        text-shadow: 0 2px 8px rgba(0,0,0,0.7);
        opacity: 0;
        transform: translateY(10px);
        animation: crLabelIn 0.5s 0.1s ease forwards;
      }

      .coin-reward-amount {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 52px;
        font-weight: 900;
        color: #39ff14;
        text-shadow: 0 0 20px rgba(57, 255, 20, 0.6), 0 4px 12px rgba(0,0,0,0.8);
        opacity: 0;
        transform: scale(0.3);
        animation: crAmountPop 0.6s 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      .coin-reward-balance-row {
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transform: translateY(20px);
        animation: crBalanceIn 0.5s 1.6s ease forwards;
      }

      .coin-reward-balance-label {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: rgba(255,255,255,0.7);
        text-shadow: 0 1px 4px rgba(0,0,0,0.5);
      }

      .coin-reward-balance {
        font-family: 'Inter', 'Segoe UI', sans-serif;
        font-size: 28px;
        font-weight: 800;
        color: #fff;
        text-shadow: 0 0 12px rgba(57,255,20,0.3), 0 2px 6px rgba(0,0,0,0.6);
      }

      .coin-particle {
        position: fixed;
        font-size: 24px;
        pointer-events: none;
        z-index: 100000;
        opacity: 0;
      }

      @keyframes crCoinFloat {
        0% { opacity: 1; transform: scale(1) translate(var(--cx), var(--cy)); }
        60% { opacity: 1; transform: scale(1.2) translate(var(--cx), var(--cy)) rotate(180deg); }
        100% { opacity: 0; transform: scale(0.3) translate(var(--tx), var(--ty)) rotate(360deg); }
      }

      @keyframes crLabelIn { to { opacity: 1; transform: translateY(0); } }
      @keyframes crAmountPop { to { opacity: 1; transform: scale(1); } }
      @keyframes crBalanceIn { to { opacity: 1; transform: translateY(0); } }
      @keyframes crBalancePulse {
        0% { transform: scale(1); color: #fff; }
        50% { transform: scale(1.15); color: #39ff14; }
        100% { transform: scale(1); color: #fff; }
      }
      .coin-reward-balance.pulse { animation: crBalancePulse 0.4s ease; }
    `;
    document.head.appendChild(style);
  }

  _createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'coin-reward-overlay';
    this.overlay.innerHTML = `
      <div class="coin-reward-box">
        <div class="coin-reward-label"></div>
        <div class="coin-reward-amount"></div>
        <div class="coin-reward-balance-row">
          <span class="coin-reward-balance-label">New Balance:</span>
          <span class="coin-reward-balance"></span>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.labelEl = this.overlay.querySelector('.coin-reward-label');
    this.amountEl = this.overlay.querySelector('.coin-reward-amount');
    this.balanceRowEl = this.overlay.querySelector('.coin-reward-balance-row');
    this.balanceEl = this.overlay.querySelector('.coin-reward-balance');
  }

  _formatNumber(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  show(data) {
    const { player, coinsAwarded, newBalance } = data;
    if (!coinsAwarded) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);

    this.labelEl.textContent = player || 'Player';
    this.labelEl.style.animation = 'none';
    this.amountEl.textContent = '+' + this._formatNumber(coinsAwarded) + ' XP';
    this.amountEl.style.animation = 'none';
    this.balanceRowEl.style.animation = 'none';
    this.balanceEl.classList.remove('pulse');
    void this.labelEl.offsetWidth;
    this.labelEl.style.animation = '';
    this.amountEl.style.animation = '';
    this.balanceRowEl.style.animation = '';

    if (newBalance && newBalance > 0) {
      this.balanceRowEl.style.display = 'flex';
      const startBal = Math.max(0, newBalance - coinsAwarded);
      this.balanceEl.textContent = this._formatNumber(startBal);
      setTimeout(() => this._countUp(startBal, newBalance, 600), 2000);
    } else {
      this.balanceRowEl.style.display = 'none';
    }

    this.overlay.classList.add('visible');
    this.hideTimer = setTimeout(() => this.overlay.classList.remove('visible'), 4000);
  }

  _countUp(from, to, duration) {
    const start = performance.now();
    const diff = to - from;
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.balanceEl.textContent = this._formatNumber(Math.round(from + diff * eased));
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        this.balanceEl.textContent = this._formatNumber(to);
        this.balanceEl.classList.add('pulse');
      }
    };
    requestAnimationFrame(tick);
  }
}
