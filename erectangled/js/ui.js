// ui.js - DOM rendering, animations, grid display

const AVATAR_FALLBACK = '/portal/img/logo.png';
function isLogoUrl(url) { return !!url && (url.indexOf('logo.png') !== -1 || url.indexOf('/profile-logos/') !== -1); }
function resolveAvatar(url) {
    if (!url) return AVATAR_FALLBACK;
    if (url.indexOf('cdn.discordapp.com/embed/avatars/') !== -1) return AVATAR_FALLBACK;
    return url;
}

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
        this.maxIncorrectTags = 20;
        this._allPlayers = [];
        this.wordAnnounceEl = document.getElementById('word-announce');
        this.wordAnnounceAvatarEl = document.getElementById('word-announce-avatar');
        this.wordAnnounceAvatarFallbackEl = document.getElementById('word-announce-avatar-fallback');
        this.wordAnnounceNameEl = document.getElementById('word-announce-name');
        this.wordAnnounceWordEl = document.getElementById('word-announce-word');
        this.wordAnnounceScoreEl = document.getElementById('word-announce-score');
        this.wordAnnounceBadgeEl = document.getElementById('word-announce-badge');
        this.wordAnnounceRarityEl = document.getElementById('word-announce-rarity');
        this.wordAnnounceEarnedEl = document.getElementById('word-announce-earned');
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

    renderGrid(grid, activeCells, revealedCells) {
        const rows = grid.length;
        const cols = grid[0].length;
        this.cols = cols;
        this._revealedCells = revealedCells || null;

        // Set grid columns on both the grid container and game board
        this.gridContainer.style.setProperty('--grid-cols', cols);
        this.gridContainer.style.setProperty('--grid-rows', rows);
        this.gameBoard.style.setProperty('--grid-cols', cols);
        this.gridContainer.innerHTML = '';
        this.cells = [];

        const revealed = revealedCells ? new Set(revealedCells) : null;

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

                // Ring mechanic: unrevealed cells are dark/hidden
                if (revealed && !revealed.has(idx)) {
                    cell.classList.add('unrevealed');
                } else if (!activeCells.has(idx)) {
                    cell.classList.add('greyed');
                }

                this.gridContainer.appendChild(cell);
                this.cells.push(cell);
            }
        }
    }

    // Lightweight update — toggle greyed/unrevealed class without full DOM rebuild
    updateActiveCells(activeCells, revealedCells) {
        const revealed = revealedCells ? new Set(revealedCells) : this._revealedCells ? new Set(this._revealedCells) : null;
        if (revealedCells) this._revealedCells = revealedCells;

        for (let i = 0; i < this.cells.length; i++) {
            const cell = this.cells[i];
            if (!cell) continue;

            if (revealed && !revealed.has(i)) {
                cell.classList.add('unrevealed');
                cell.classList.remove('greyed');
            } else {
                cell.classList.remove('unrevealed');
                cell.classList.toggle('greyed', !activeCells.has(i));
            }
        }
    }

    // Animate newly revealed cells (ring expansion)
    revealRingCells(newCells) {
        if (!newCells || newCells.length === 0) return;
        for (const idx of newCells) {
            const cell = this.cells[idx];
            if (!cell) continue;
            cell.classList.remove('unrevealed');
            cell.classList.add('ring-reveal');
            // Remove animation class after it completes
            setTimeout(() => cell.classList.remove('ring-reveal'), 600);
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

    handleGuessResult(result, game, { showBanner = true } = {}) {
        switch (result.result) {
            case 'correct':
                this.onCorrectGuess(result, game, showBanner);
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
        var avatarSrc = resolveAvatar(profileImage);
        this.wordAnnounceAvatarEl.src = avatarSrc;
        this.wordAnnounceAvatarEl.style.display = '';
        this.wordAnnounceAvatarEl.classList.toggle('avatar-is-logo', isLogoUrl(avatarSrc));
        this.wordAnnounceAvatarEl.onerror = function() { this.onerror = null; this.src = AVATAR_FALLBACK; this.classList.add('avatar-is-logo'); };
        this.wordAnnounceAvatarFallbackEl.style.display = 'none';
        this.wordAnnounceAvatarFallbackEl.textContent = '';

        // Reset cosmetics on name + badge (including any title span)
        const _existTitle = this.wordAnnounceEl ? this.wordAnnounceEl.querySelector('.cosmetic-title') : null;
        if (_existTitle) _existTitle.remove();
        this.wordAnnounceNameEl.style.cssText = '';
        this.wordAnnounceNameEl.textContent = result.username || 'Anonymous';
        if (this.wordAnnounceBadgeEl) {
            this.wordAnnounceBadgeEl.style.cssText = 'display:none';
        }

        // Word with rarity class — set in one operation to avoid white flash
        this.wordAnnounceWordEl.textContent = result.word.toUpperCase();
        const wordRarityClass = result.isThreeLetter ? 'three-letter' : (result.isRare || result.isHidden ? 'rare' : '');
        this.wordAnnounceWordEl.className = 'word-announce-word' + (wordRarityClass ? ' ' + wordRarityClass : '');

        // Rarity label + earned points
        const basePts = result.isThreeLetter ? 100 : (result.isHidden ? 1500 : (result.isRare ? 1000 : 500));
        const wordPts = basePts + (result.letterRarityBonus || 0) + (result.wordLengthBonus || 0);
        if (this.wordAnnounceRarityEl) {
            let rarityText, rarityClass;
            if (result.isThreeLetter) {
                rarityText = '3-Letter'; rarityClass = 'rarity-three-letter';
            } else if (result.isHidden) {
                rarityText = 'Ultra Rare'; rarityClass = 'rarity-hidden';
            } else if (result.isRare) {
                rarityText = 'Rare'; rarityClass = 'rarity-rare';
            } else {
                rarityText = 'Common'; rarityClass = 'rarity-common';
            }
            this.wordAnnounceRarityEl.className = `word-announce-rarity ${rarityClass}`;
            this.wordAnnounceRarityEl.textContent = rarityText;
            this.wordAnnounceRarityEl.style.display = '';
        }
        if (this.wordAnnounceEarnedEl) {
            this.wordAnnounceEarnedEl.textContent = `+${wordPts.toLocaleString()}`;
            this.wordAnnounceEarnedEl.style.display = '';
        }

        // Track for score count-up animation
        this._lastFoundUsername = result.username || null;
        this._lastDisplayedScore = score !== null ? score : 0;

        // Score (shows current total; animates up when game-state fires with updated score)
        this.wordAnnounceScoreEl.textContent = score !== null ? `${score} pts` : '';

        // Persist for refresh recovery
        try {
            localStorage.setItem('rt_last_found', JSON.stringify({
                username: result.username || null,
                profilePic: profileImage || null,
                word: result.word,
                isThreeLetter: result.isThreeLetter || false,
                isRare: result.isRare || false,
                isHidden: result.isHidden || false
            }));
        } catch(e) {}

        // Show persistently — stays visible until next word or game reset
        this.wordAnnounceEl.classList.remove('hidden', 'fading');
        void this.wordAnnounceEl.offsetWidth; // reflow to restart slide-in animation
    }

    // Called after loadServerGame — restores last found card if word is still in current game
    restoreLastFound(foundWords) {
        try {
            const stored = localStorage.getItem('rt_last_found');
            if (!stored) return;
            const data = JSON.parse(stored);
            if (data && data.word && foundWords && foundWords.has(data.word)) {
                this.showWordAnnounce(data);
            }
        } catch(e) {}
    }

    applyAnnounceCosmetics(cos) {
        if (!this.wordAnnounceEl || this.wordAnnounceEl.classList.contains('hidden')) return;
        // Reset avatar cosmetics from any prior word
        if (this.wordAnnounceAvatarEl) {
            this.wordAnnounceAvatarEl.style.border = '';
            this.wordAnnounceAvatarEl.style.boxShadow = '';
            this.wordAnnounceAvatarEl.style.animation = '';
        }
        // Name color / glow
        if (cos.name_color && this.wordAnnounceNameEl) {
            if (cos.name_color.color) this.wordAnnounceNameEl.style.color = cos.name_color.color;
            if (cos.name_color.animation) this.wordAnnounceNameEl.style.animation = cos.name_color.animation;
        }
        if (cos.name_glow && this.wordAnnounceNameEl) {
            if (cos.name_glow.textShadow) this.wordAnnounceNameEl.style.textShadow = cos.name_glow.textShadow;
        }
        // Title
        if (cos.title && cos.title.title && this.wordAnnounceNameEl) {
            const existingTitle = this.wordAnnounceEl ? this.wordAnnounceEl.querySelector('.cosmetic-title') : null;
            if (existingTitle) existingTitle.remove();
            const titleSpan = document.createElement('span');
            titleSpan.className = 'cosmetic-title';
            titleSpan.textContent = ' [' + cos.title.title + ']';
            if (cos.title.titleColor) titleSpan.style.color = cos.title.titleColor;
            if (cos.title.titleGlow) titleSpan.style.textShadow = cos.title.titleGlow;
            if (cos.title.animation) titleSpan.style.animation = cos.title.animation;
            this.wordAnnounceNameEl.after(titleSpan);
        }
        // Profile border + glow — applied to avatar img.
        // The word-announce-avatar gets avatar-is-logo class for WT logo users,
        // and overlay.css has no border-color:transparent rule blocking inline styles.
        // For logo avatars the img has transform:scale(1.3) so the border appears
        // at the scaled visual edge, which hugs the logo medallion closely enough.
        if (cos.profile_border && this.wordAnnounceAvatarEl) {
            if (cos.profile_border.border) this.wordAnnounceAvatarEl.style.border = cos.profile_border.border;
            if (cos.profile_border.boxShadow) this.wordAnnounceAvatarEl.style.boxShadow = cos.profile_border.boxShadow;
            if (cos.profile_border.animation) this.wordAnnounceAvatarEl.style.animation = cos.profile_border.animation;
        }
        if (cos.profile_glow && this.wordAnnounceAvatarEl) {
            const existingBs = this.wordAnnounceAvatarEl.style.boxShadow;
            const glowBs = cos.profile_glow.boxShadow || '';
            if (glowBs) {
                this.wordAnnounceAvatarEl.style.boxShadow = existingBs ? existingBs + ', ' + glowBs : glowBs;
            }
            if (cos.profile_glow.animation && !this.wordAnnounceAvatarEl.style.animation) {
                this.wordAnnounceAvatarEl.style.animation = cos.profile_glow.animation;
            }
        }
        // Hero badge
        if (cos.hero_badge && this.wordAnnounceBadgeEl) {
            const badge = cos.hero_badge;
            if (badge.background) {
                this.wordAnnounceBadgeEl.style.background = badge.background;
                if (badge.backgroundSize) this.wordAnnounceBadgeEl.style.backgroundSize = badge.backgroundSize;
                this.wordAnnounceBadgeEl.style.display = '';
            }
        }
    }

    // Apply word_color / word_glow to cells still in their highlight phase.
    // Called async after cosmetics fetch — cells may already be lit (most common).
    // Phase 3 cleanup in onCorrectGuess always clears letter styles.
    applyWordPathCosmetics(cellList, cos) {
        const wColor = cos.word_color;
        const wGlow  = cos.word_glow;
        if (!wColor && !wGlow) return;
        const HIGHLIGHT = ['found-highlight', 'rare-highlight', 'hidden-highlight', 'three-letter-highlight'];
        for (const cellIdx of cellList) {
            const cell = this.cells[cellIdx];
            if (!cell || !HIGHLIGHT.some(c => cell.classList.contains(c))) continue;
            const letterEl = cell.querySelector('.cell-letter');
            if (!letterEl) continue;
            if (wColor && wColor.color)      letterEl.style.color      = wColor.color;
            if (wColor && wColor.textShadow) letterEl.style.textShadow = wColor.textShadow;
            if (wGlow  && wGlow.textShadow)  letterEl.style.textShadow = (letterEl.style.textShadow ? letterEl.style.textShadow + ', ' : '') + wGlow.textShadow;
        }
    }

    onCorrectGuess(result, game, showBanner = true) {
        // Update word count
        this.updateWordCount(result.foundCount, result.totalCount);

        // Show word announcement banner with finder's PFP + score
        if (showBanner) this.showWordAnnounce(result);

        // Highlight the cells that form this word — stagger on, hold, then fade off
        if (result.cells) {
            const cellList = [...result.cells];
            const stagger = 300; // ms between each cell in the path
            const holdTime = 1500; // ms to hold all cells lit after last one lights up

            const highlightCls = result.isThreeLetter ? 'three-letter-highlight'
                               : result.isHidden      ? 'hidden-highlight'
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
                // Clean up fadeout class and any word cosmetics after transition
                setTimeout(() => {
                    cellList.forEach((cellIdx) => {
                        const cell = this.cells[cellIdx];
                        if (!cell) return;
                        cell.classList.remove('found-fadeout');
                        const letterEl = cell.querySelector('.cell-letter');
                        if (letterEl) { letterEl.style.color = ''; letterEl.style.textShadow = ''; }
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

    // Remove oldest tags (leftmost) when too many
    _trimIncorrectArea() {
        while (this.incorrectArea.children.length >= this.maxIncorrectTags) {
            const oldest = this.incorrectArea.firstChild;
            if (oldest) oldest.remove();
        }
    }

    _addTag(className, text) {
        this._trimIncorrectArea();
        const tag = document.createElement('span');
        tag.className = className;
        tag.textContent = text;
        // Append — newest always spawns at the right end, pushing older ones left
        this.incorrectArea.appendChild(tag);
    }

    onIncorrectGuess(word) {
        this._addTag('incorrect-word', word);
    }

    onAlreadyFound(word) {
        this._addTag('already-found-tag', `${word} ✓`);
    }

    showComplete(game) {
        const progress = game.getProgress();
        this.completeStats.textContent = `All ${progress.total} words found!`;

        const players = this._allPlayers.filter(p => p.score > 0).sort((a, b) => b.score - a.score);
        const winEl = document.getElementById('win-top-players');
        if (winEl) {
            winEl.innerHTML = '';
            const medals = ['🥇', '🥈', '🥉', '4th', '5th'];
            const top5 = players.slice(0, 5);
            const rest = players.slice(5);

            // Top 5 hero cards
            top5.forEach((p, i) => {
                const name = p.displayName || p.name || 'Anonymous';
                const pic = p.profileImage;
                const avatarHtml = pic
                    ? `<span class="win-player-avatar-wrap"><img class="win-player-avatar" src="${pic}" alt=""></span>`
                    : `<span class="win-player-avatar-wrap"><div class="win-player-avatar-fallback">${name.charAt(0).toUpperCase()}</div></span>`;
                const row = document.createElement('div');
                row.className = 'win-player';
                row.style.animationDelay = `${0.2 + i * 0.15}s`;
                row.innerHTML = `<span class="win-player-crown">${medals[i]}</span>${avatarHtml}<span class="win-player-name">${name}</span><span class="win-player-score">${p.score.toLocaleString()} pts</span>`;
                winEl.appendChild(row);
            });
            if (typeof TopPlayerCards !== 'undefined') {
                TopPlayerCards.hydrateWinPlayerCards(winEl, top5);
            }

            // Scrolling list of remaining players
            if (rest.length > 0) {
                const scrollWrap = document.createElement('div');
                scrollWrap.className = 'win-scroll-list';
                rest.forEach((p, i) => {
                    const name = p.displayName || p.name || 'Anonymous';
                    const row = document.createElement('div');
                    row.className = 'win-scroll-player';
                    row.style.animationDelay = `${0.8 + i * 0.08}s`;
                    row.innerHTML = `<span class="win-scroll-rank">#${i + 6}</span><span class="win-scroll-name">${name}</span><span class="win-scroll-score">${p.score.toLocaleString()}</span>`;
                    scrollWrap.appendChild(row);
                });
                winEl.appendChild(scrollWrap);
            }
        }

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
