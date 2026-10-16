(function () {
  function show() {
    if (!window.LoginPrompt?.showModal) return setTimeout(show, 60);
    window.LoginPrompt.showModal({
      authBase: 'https://wordtycoon.live', returnTo: location.href,
      onDismiss() { document.getElementById('wsGuestContinueBtn')?.click(); },
    });
  }
  fetch('/api/me/session', { credentials: 'include' }).then(response => response.json())
    .then(data => { if (!data?.ok || !data.user) show(); }).catch(show);
})();
