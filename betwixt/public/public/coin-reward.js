/**
 * Word Tycoon - Coin Reward Animation
 * Drop this script into any word game overlay to show coin rewards.
 * Listens for 'coin-reward' socket events and displays an animated overlay.
 *
 * Requires: socket.io connection already established as `socket` global
 *           OR pass socket to CoinReward.init(socket)
 */
(function () {
  'use strict';

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    /* ===== COIN REWARD OVERLAY ===== */
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
      color: #ffd700;
      text-shadow: 0 0 20px rgba(255, 215, 0, 0.6), 0 4px 12px rgba(0,0,0,0.8);
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
      text-shadow: 0 0 12px rgba(255,215,0,0.3), 0 2px 6px rgba(0,0,0,0.6);
    }

    /* Floating coin particles */
    .coin-particle {
      position: fixed;
      font-size: 24px;
      pointer-events: none;
      z-index: 100000;
      opacity: 0;
    }

    /* Suck animation: coin flies from scattered position to balance */
    @keyframes crCoinFloat {
      0% {
        opacity: 1;
        transform: scale(1) translate(var(--cx), var(--cy));
      }
      60% {
        opacity: 1;
        transform: scale(1.2) translate(var(--cx), var(--cy)) rotate(180deg);
      }
      100% {
        opacity: 0;
        transform: scale(0.3) translate(var(--tx), var(--ty)) rotate(360deg);
      }
    }

    @keyframes crLabelIn {
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes crAmountPop {
      to { opacity: 1; transform: scale(1); }
    }

    @keyframes crBalanceIn {
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes crBalancePulse {
      0% { transform: scale(1); color: #fff; }
      50% { transform: scale(1.15); color: #ffd700; }
      100% { transform: scale(1); color: #fff; }
    }

    .coin-reward-balance.pulse {
      animation: crBalancePulse 0.4s ease;
    }
  `;
  document.head.appendChild(style);

  // Create overlay container (hidden by default)
  const overlay = document.createElement('div');
  overlay.className = 'coin-reward-overlay';
  overlay.innerHTML = `
    <div class="coin-reward-box">
      <div class="coin-reward-label"></div>
      <div class="coin-reward-amount"></div>
      <div class="coin-reward-balance-row">
        <span class="coin-reward-balance-label">New Balance:</span>
        <span class="coin-reward-balance"></span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const labelEl = overlay.querySelector('.coin-reward-label');
  const amountEl = overlay.querySelector('.coin-reward-amount');
  const balanceRowEl = overlay.querySelector('.coin-reward-balance-row');
  const balanceEl = overlay.querySelector('.coin-reward-balance');

  let hideTimer = null;

  function formatNumber(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  function showReward(data) {
    const { player, coinsAwarded, newBalance } = data;
    if (!coinsAwarded) return;

    if (hideTimer) clearTimeout(hideTimer);

    // Reset animations by re-creating inner elements
    labelEl.textContent = player || 'Player';
    labelEl.style.animation = 'none';
    amountEl.textContent = '+' + formatNumber(coinsAwarded) + ' coins';
    amountEl.style.animation = 'none';
    balanceRowEl.style.animation = 'none';
    balanceEl.classList.remove('pulse');

    // Force reflow
    void labelEl.offsetWidth;

    labelEl.style.animation = '';
    amountEl.style.animation = '';
    balanceRowEl.style.animation = '';

    // Show balance with count-up
    if (newBalance && newBalance > 0) {
      balanceRowEl.style.display = 'flex';
      const startBal = Math.max(0, newBalance - coinsAwarded);
      balanceEl.textContent = formatNumber(startBal);

      // Count up from old to new balance after coins "arrive"
      setTimeout(() => {
        countUp(balanceEl, startBal, newBalance, 600);
      }, 2000);
    } else {
      balanceRowEl.style.display = 'none';
    }

    overlay.classList.add('visible');

    // Spawn coin particles
    spawnCoins(coinsAwarded);

    // Hide after duration
    hideTimer = setTimeout(() => {
      overlay.classList.remove('visible');
    }, 4000);
  }

  function countUp(el, from, to, duration) {
    const start = performance.now();
    const diff = to - from;
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      // Ease out
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + diff * eased);
      el.textContent = formatNumber(current);
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = formatNumber(to);
        el.classList.add('pulse');
      }
    }
    requestAnimationFrame(tick);
  }

  function spawnCoins(amount) {
    // Determine coin count based on reward size (min 6, max 20)
    const count = Math.min(20, Math.max(6, Math.floor(amount / 100)));
    const vp = window.__gameViewport || { width: window.innerWidth, height: window.innerHeight };
    const centerX = vp.width / 2;
    const centerY = vp.height / 2;

    // Target: where the balance text is
    const balRect = balanceEl.getBoundingClientRect();
    const targetX = balRect.left + balRect.width / 2;
    const targetY = balRect.top + balRect.height / 2;

    for (let i = 0; i < count; i++) {
      const coin = document.createElement('div');
      coin.className = 'coin-particle';
      coin.textContent = '🪙';

      // Random scatter position around center
      const scatterX = (Math.random() - 0.5) * 300;
      const scatterY = (Math.random() - 0.5) * 200;
      const startX = centerX + scatterX;
      const startY = centerY - 40 + scatterY;

      coin.style.left = startX + 'px';
      coin.style.top = startY + 'px';

      // Direction to target
      const tx = targetX - startX;
      const ty = targetY - startY;
      coin.style.setProperty('--cx', '0px');
      coin.style.setProperty('--cy', '0px');
      coin.style.setProperty('--tx', tx + 'px');
      coin.style.setProperty('--ty', ty + 'px');

      const delay = 0.8 + i * 0.08; // stagger from 0.8s
      coin.style.animation = `crCoinFloat 0.8s ${delay}s cubic-bezier(0.4, 0, 0.2, 1) forwards`;

      document.body.appendChild(coin);

      // Clean up
      setTimeout(() => {
        if (coin.parentNode) coin.parentNode.removeChild(coin);
      }, (delay + 1) * 1000);
    }
  }

  // Public API
  window.CoinReward = {
    show: showReward,
    init: function (socket) {
      if (socket) {
        socket.on('coin-reward', showReward);
      }
    }
  };

  // Auto-init if global socket exists
  if (typeof socket !== 'undefined' && socket && socket.on) {
    socket.on('coin-reward', showReward);
  }
})();
