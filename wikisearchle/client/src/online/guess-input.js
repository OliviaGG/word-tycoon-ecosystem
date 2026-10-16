Promise.resolve(window.__wikisearchleAuthReady).finally(() => {
    const auth = window.WikiSearchleAuth;
    if (auth && typeof auth.initUi === 'function') auth.initUi();

    WikiWordGuessBar.mount({
      nicknameKey: 'wikisearchle_nickname',
      placeholder: 'Type a word to guess…',
      guestChipLabel: auth && auth.isAuthenticated && !auth.isAuthenticated() ? 'Login' : '',
      guestChipTitle: 'Login with Discord or GitHub',
      guestSubmitNickname: '',
      onGuestChipClick: () => {
        if (auth && typeof auth.showPrompt === 'function') auth.showPrompt();
      },
      onSubmit: (word, nickname) => {
        if (window.WikiContextoLoading && window.WikiContextoLoading.isPending()) return;
        if (window._wsSocket && window._wsSocket.connected) {
          const identity = auth && typeof auth.buildGuessPayload === 'function'
            ? auth.buildGuessPayload(nickname)
            : { guestId: null, nickname, profilePic: window._wtUserPicUrl || null };
          window._wsSocket.emit('submit-guess', {
            word,
            nickname: identity.nickname,
            guestId: identity.guestId,
            profilePic: identity.profilePic,
            platform: identity.platform,
            platformUserId: identity.platformUserId,
            username: identity.username,
          });
        }
      },
    });
    if (window.WikiContextoOnlineReady) window.WikiContextoOnlineReady();
  });
