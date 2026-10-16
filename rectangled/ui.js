// ui.js - DOM rendering, animations, grid display

export class UI {
    constructor() {
        this.gridContainer = document.getElementById('grid-container');
        this.gameBoard = document.getElementById('game-board');
        this.topPlayersEl = document.getElementById('top-players');
        this.foundCountEl = document.getElementById('found-count');
        this.totalCountEl = document.getElementById('total-count');
        this.progressBar = document.getElementById('progress-bar');
        this.incorrectArea = document.getElementById('incorrect-area');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.loadingText = document.getElementById('loading-text');
        this.completeOverlay = document.getElementById('complete-overlay');
        this.completeStats = document.getElementById('complete-stats');
        this.wsStatusEl = null;
        this.wsLabelEl = null;
        this.cells = [];
        this.cols = 4;
        this.maxIncorrectTags = 5;
        this._allPlayers = [];
        this.wordAnnounceEl = document.getElementById('word-announce');
        this.wordAnnounceAvatarEl = document.getElementById('word-announce-avatar');
        this.wordAnnounceAvatarFallbackEl = document.getElementById('word-announce-avatar-fallback');
        this.wordAnnounceNameEl = document.getElementById('word-announce-name');
        this.wordAnnounceWordEl = document.getElementById('word-announce-word');
        this.wordAnnounceScoreEl = document.getElementById('word-announce-score');
        // word-announce-badge element removed; hero_badge applied to container via TopPlayerCards
        this._announceTimer = null;
        this._lastFoundUsername = null;
        this._lastDisplayedScore = 0;
    }

    showLoading(text) {
        this.loadingText.textContent = text;
        this.loadingOverlay.classList.remove('hidden');
    }

    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }

    renderGrid(grid, activeCells) {
        const rows = grid.length;
        const cols = grid[0].length;
        this.cols = cols;

        // Set grid columns on both the grid container and game board
        this.gridContainer.style.setProperty('--grid-cols', cols);
        this.gridContainer.style.setProperty('--grid-rows', rows);
        this.gameBoard.style.setProperty('--grid-cols', cols);
        this.gridContainer.innerHTML = '';
        this.cells = [];

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.index = idx;
                cell.dataset.letter = grid[r][c];

                const letterSpan = document.createElement('span');
                letterSpan.className = 'cell-letter';
                letterSpan.textContent = grid[r][c];

                const startsSpan = document.createElement('span');
                startsSpan.className = 'cell-starts';
                startsSpan.textContent = '';

                const usesSpan = document.createElement('span');
                usesSpan.className = 'cell-uses';
                usesSpan.textContent = '';

                cell.appendChild(letterSpan);
                cell.appendChild(startsSpan);
                cell.appendChild(usesSpan);

                if (!activeCells.has(idx)) {
                    cell.classList.add('greyed');
                }

                this.gridContainer.appendChild(cell);
                this.cells.push(cell);
            }
        }
    }

    updateWordCount(found, total) {
        this.foundCountEl.textContent = found;
        this.totalCountEl.textContent = total;
        const pct = total > 0 ? (found / total) * 100 : 0;
        this.progressBar.style.width = pct + '%';
    }

    updateTopPlayers(players) {
        if (!players || players.length === 0) {
            this._allPlayers = [];
            return;
        }
        this._allPlayers = players;

        // If a last-found player is displayed, animate their score to the new value
        if (this._lastFoundUsername && this.wordAnnounceEl && !this.wordAnnounceEl.classList.contains('hidden')) {
            const updated = players.find(p => (p.displayName || p.name) === this._lastFoundUsername);
            if (updated && updated.score !== this._lastDisplayedScore) {
                this._animateScoreCountUp(this.wordAnnounceScoreEl, this._lastDisplayedScore, updated.score);
                this._lastDisplayedScore = updated.score;
            }
        }
    }

    _animateScoreCountUp(element, from, to, duration = 800) {
        if (!element) return;
        const start = performance.now();
        const step = (now) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            const current = Math.round(from + (to - from) * eased);
            element.textContent = `${current} pts`;
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    updateRareCounts(state) {
        if (!state) return;
        const rareCountEl = document.getElementById('rare-count');
        const ultraRareCountEl = document.getElementById('ultra-rare-count');

        const fr = state.foundRareCount || 0;
        const tr = state.rareCount || 0;
        const fh = state.foundHiddenCount || 0;
        const th = state.hiddenCount || 0;

        if (rareCountEl) {
            if (tr > 0 && fr > 0) {
                rareCountEl.textContent = `+${fr} rare`;
                rareCountEl.style.display = '';
            } else {
                rareCountEl.style.display = 'none';
            }
        }
        if (ultraRareCountEl) {
            if (th > 0 && fh > 0) {
                ultraRareCountEl.textContent = `+${fh} ultra rare`;
                ultraRareCountEl.style.display = '';
            } else {
                ultraRareCountEl.style.display = 'none';
            }
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    handleGuessResult(result, game) {
        switch (result.result) {
            case 'correct':
                this.onCorrectGuess(result, game);
                break;
            case 'incorrect':
                this.onIncorrectGuess(result.word);
                break;
            case 'already_found':
                this.onAlreadyFound(result.word);
                break;
            case 'too_short':
                break;
        }
    }

    showWordAnnounce(result) {
        if (!this.wordAnnounceEl) return;
        clearTimeout(this._announceTimer);

        // Profile image: prefer direct profilePic from SSE event, fallback to server player list
        const serverPlayer = this._allPlayers.find(p => (p.displayName || p.name) === result.username);
        const profileImage = result.profilePic || (serverPlayer ? serverPlayer.profileImage : null);

        // Score from server player list
        const score = serverPlayer ? serverPlayer.score : null;

        // Avatar
        if (profileImage) {
            this.wordAnnounceAvatarEl.src = profileImage;
            this.wordAnnounceAvatarEl.style.display = '';
            this.wordAnnounceAvatarFallbackEl.style.display = 'none';
            this.wordAnnounceAvatarFallbackEl.textContent = '';
        } else {
            this.wordAnnounceAvatarEl.style.display = 'none';
            this.wordAnnounceAvatarFallbackEl.style.display = 'flex';
            this.wordAnnounceAvatarFallbackEl.textContent =
                result.username ? result.username.charAt(0).toUpperCase() : '?';
        }

        // Reset cosmetics on name + banner
        this.wordAnnounceNameEl.style.cssText = '';
        this.wordAnnounceNameEl.textContent = result.username || 'Anonymous';
        TopPlayerCards.clearHeroBadge(this.wordAnnounceEl);

        // Word with rarity class
        this.wordAnnounceWordEl.textContent = result.word.toUpperCase();
        this.wordAnnounceWordEl.className = 'word-announce-word';
        if (result.isThreeLetter) this.wordAnnounceWordEl.classList.add('three-letter');
        else if (result.isRare || result.isHidden) this.wordAnnounceWordEl.classList.add('rare');

        // Track for score count-up animation
        this._lastFoundUsername = result.username || null;
        this._lastDisplayedScore = score !== null ? score : 0;

        // Score (shows current total; animates up when game-state fires with updated score)
        this.wordAnnounceScoreEl.textContent = score !== null ? `${score} pts` : '';

        // Show persistently — stays visible until next word or game reset
        this.wordAnnounceEl.classList.remove('hidden', 'fading');
        void this.wordAnnounceEl.offsetWidth; // reflow to restart slide-in animation
    }

    applyAnnounceCosmetics(cos) {
        if (!this.wordAnnounceEl || this.wordAnnounceEl.classList.contains('hidden')) return;
        // Name color / glow
        if (cos.name_color && this.wordAnnounceNameEl) {
            if (cos.name_color.color) this.wordAnnounceNameEl.style.color = cos.name_color.color;
            if (cos.name_color.animation) this.wordAnnounceNameEl.style.animation = cos.name_color.animation;
        }
        if (cos.name_glow && this.wordAnnounceNameEl) {
            if (cos.name_glow.textShadow) this.wordAnnounceNameEl.style.textShadow = cos.name_glow.textShadow;
        }
        // Hero badge
        TopPlayerCards.applyHeroBadge(this.wordAnnounceEl, cos);
    }

    onCorrectGuess(result, game) {
        // Update word count
        this.updateWordCount(result.foundCount, result.totalCount);

        // Show word announcement banner with finder's PFP + score
        this.showWordAnnounce(result);

        // Highlight the cells that form this word — stagger on, hold, then fade off
        if (result.cells) {
            const cellList = [...result.cells];
            const stagger = 300; // ms between each cell in the path
            const holdTime = 1500; // ms to hold all cells lit after last one lights up

            const highlightCls = result.isThreeLetter ? 'three-letter-highlight'
                               : result.isHidden      ? 'rare-highlight'
                               : result.isRare        ? 'rare-highlight'
                               :                        'found-highlight';

            // Phase 1: stagger-light each cell along the path
            cellList.forEach((cellIdx, i) => {
                const cell = this.cells[cellIdx];
                if (cell) {
                    setTimeout(() => {
                        cell.classList.remove('found-fadeout');
                        cell.classList.add(highlightCls);
                    }, i * stagger);
                }
            });

            // Phase 2: after all lit + hold, fade them all off together
            const allLitTime = cellList.length * stagger;
            setTimeout(() => {
                cellList.forEach((cellIdx) => {
                    const cell = this.cells[cellIdx];
                    if (cell) {
                        cell.classList.add('found-fadeout');
                        cell.classList.remove(highlightCls);
                    }
                });
                // Clean up fadeout class after transition
                setTimeout(() => {
                    cellList.forEach((cellIdx) => {
                        const cell = this.cells[cellIdx];
                        if (cell) cell.classList.remove('found-fadeout');
                    });
                }, 1000);
            }, allLitTime + holdTime);

            const totalAnimTime = allLitTime + holdTime + 1000;

            // Grey out newly inactive cells after path animation finishes
            for (const cellIdx of result.newlyGreyedCells) {
                const cell = this.cells[cellIdx];
                if (cell) {
                    setTimeout(() => {
                        cell.classList.add('greyed');
                    }, totalAnimTime);
                }
            }

            // Check completion
            if (result.isComplete) {
                setTimeout(() => this.showComplete(game), totalAnimTime + 200);
            }
        }
    }

    // Fade out the oldest tag in the incorrect area to make room
    _trimIncorrectArea() {
        const children = this.incorrectArea.children;
        if (children.length >= this.maxIncorrectTags) {
            const oldest = children[0];
            oldest.classList.add('fading');
            oldest.addEventListener('animationend', () => oldest.remove(), { once: true });
            setTimeout(() => { if (oldest.parentNode) oldest.remove(); }, 600);
        }
    }

    onIncorrectGuess(word) {
        this._trimIncorrectArea();

        const tag = document.createElement('span');
        tag.className = 'incorrect-word';
        tag.textContent = word;
        this.incorrectArea.appendChild(tag);

        // Auto-remove after delay
        setTimeout(() => {
            if (tag.parentNode) {
                tag.classList.add('fading');
                tag.addEventListener('animationend', () => tag.remove(), { once: true });
                setTimeout(() => { if (tag.parentNode) tag.remove(); }, 600);
            }
        }, 4000);
    }

    onAlreadyFound(word) {
        this._trimIncorrectArea();

        const tag = document.createElement('span');
        tag.className = 'already-found-tag';
        tag.textContent = `${word} (found)`;
        this.incorrectArea.appendChild(tag);

        // Auto-remove after delay
        setTimeout(() => {
            if (tag.parentNode) {
                tag.classList.add('fading');
                tag.addEventListener('animationend', () => tag.remove(), { once: true });
                setTimeout(() => { if (tag.parentNode) tag.remove(); }, 600);
            }
        }, 3000);
    }

    showComplete(game) {
        const progress = game.getProgress();
        const topPlayer = game.getTopPlayer();
        let statsText = `All ${progress.total} words found!`;
        if (topPlayer && topPlayer.name !== 'local') {
            statsText += ` Top player: ${topPlayer.name} with ${topPlayer.score} words!`;
        }
        this.completeStats.textContent = statsText;
        this.completeOverlay.classList.remove('hidden');
    }

    hideComplete() {
        this.completeOverlay.classList.add('hidden');
    }

    // hintPct = foundCommon / totalCommon (0.0–1.0)
    // Matches SP page reveal rules: grey usage at 25%+, blue starts at 50%+
    updateLetterStats(stats, hintPct = 0) {
        const cellUsage = stats.cellUsage || {};
        const cellStartsWith = stats.cellStartsWith || {};
        const showUses = hintPct >= 0.25;
        const showStarts = hintPct >= 0.50;
        for (const cell of this.cells) {
            const idx = parseInt(cell.dataset.index, 10);
            const isActive = !cell.classList.contains('greyed');
            const startsEl = cell.querySelector('.cell-starts');
            const usesEl = cell.querySelector('.cell-uses');
            // Left corner (blue): words starting at THIS specific cell — revealed at 50%+
            if (startsEl) {
                const count = cellStartsWith[idx] || 0;
                startsEl.textContent = (count > 0 && isActive && showStarts) ? (count >= 10 ? '+' : count) : '';
            }
            // Right corner (grey): words passing through this specific cell — revealed at 25%+
            if (usesEl) {
                const count = cellUsage[idx] || 0;
                usesEl.textContent = (count > 0 && isActive && showUses) ? (count >= 10 ? '+' : count) : '';
            }
        }
    }

    updateConnectionStatus(connected) {
        if (connected) {
            this.wsStatusEl.classList.remove('disconnected');
            this.wsStatusEl.classList.add('connected');
            this.wsLabelEl.textContent = 'Connected';
            this.wsStatusEl.title = 'WebSocket connected';
        } else {
            this.wsStatusEl.classList.remove('connected');
            this.wsStatusEl.classList.add('disconnected');
            this.wsLabelEl.textContent = 'Disconnected';
            this.wsStatusEl.title = 'WebSocket disconnected';
        }
    }

    applyTopPlayerCosmetics(username, cos) {
        if (!cos) return;
        const escapedName = this.escapeHtml(username);
        const card = this.topPlayersEl.querySelector(`.top-player-card[data-player="${escapedName}"]`);
        if (!card) return;

        const nameEl = card.querySelector('.top-player-name');
        const avatarEl = card.querySelector('.top-player-avatar') || card.querySelector('.top-player-avatar-fallback');
        const avatarWrap = card.querySelector('.top-player-avatar-wrap');

        if (cos.name_color && nameEl) {
            if (cos.name_color.color) nameEl.style.color = cos.name_color.color;
            if (cos.name_color.animation) nameEl.style.animation = cos.name_color.animation;
        }
        if (cos.name_glow && nameEl) {
            if (cos.name_glow.textShadow) nameEl.style.textShadow = cos.name_glow.textShadow;
            if (cos.name_glow.animation && !nameEl.style.animation) nameEl.style.animation = cos.name_glow.animation;
        }
        if (cos.profile_border && avatarEl) {
            if (cos.profile_border.border) avatarEl.style.border = cos.profile_border.border;
            if (cos.profile_border.boxShadow) avatarEl.style.boxShadow = cos.profile_border.boxShadow;
            if (cos.profile_border.animation) avatarEl.style.animation = cos.profile_border.animation;
        }
        if (cos.profile_glow && (avatarWrap || avatarEl)) {
            const target = avatarWrap || avatarEl;
            if (cos.profile_glow.boxShadow) target.style.boxShadow = cos.profile_glow.boxShadow;
            if (cos.profile_glow.animation) target.style.animation = cos.profile_glow.animation;
        }
        if (cos.title && cos.title.title && nameEl) {
            // Remove existing cosmetic title if any
            const existing = card.querySelector('.cosmetic-title');
            if (existing) existing.remove();
            const titleSpan = document.createElement('span');
            titleSpan.className = 'cosmetic-title';
            titleSpan.textContent = ' [' + cos.title.title + ']';
            if (cos.title.titleColor) titleSpan.style.color = cos.title.titleColor;
            if (cos.title.titleGlow) titleSpan.style.textShadow = cos.title.titleGlow;
            if (cos.title.animation) titleSpan.style.animation = cos.title.animation;
            nameEl.after(titleSpan);
        }
    }

    reset() {
        this.gridContainer.innerHTML = '';
        this.cells = [];
        this.incorrectArea.innerHTML = '';
        this._allPlayers = [];
        this._lastFoundUsername = null;
        this._lastDisplayedScore = 0;
        if (this.wordAnnounceEl) this.wordAnnounceEl.classList.add('hidden');
        this.updateWordCount(0, 0);
        this.hideComplete();
    }
}
