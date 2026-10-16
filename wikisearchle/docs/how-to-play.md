# WikiContexto How to Play — October 4, 2026

`/about` is the How to Play guide. It uses the existing WikiContexto wordmark and navy/cyan/gold theme, explains semantic rank versus article reveals and title progression, and links to the current Solo, Online, Daily, and archive routes. Its static HTML remains usable without JavaScript; the existing theme preference is honored.

The Solo page includes a native modal dialog controlled by `public/js/solo-help.js`, with shared styles in `public/css/how-to-play.css`. The Solo client calls `showFirstTime()` only after successfully loading an article and mounting the guess bar. The prompt therefore covers the first successful single-player game, including Daily or an archive replay, without consuming its preference on a failed load. The header's **?** button can reopen it.

Dismissal, Start guessing, Escape, or the full-guide link stores `wikicontexto-solo-tutorial-v1=seen` in localStorage. This is a browser preference, independent of account and puzzle progress. If localStorage is unavailable, sessionStorage is used; if both are blocked, the preference lasts only for the current page. Do not clear puzzle progress to replay the tutorial. Native modality keeps the background inert and traps focus; the guess handler also ignores submissions while the prompt is open. The dialog lives outside the scaled game canvas, with scrollable instructions and an always-visible footer on small screens.

The shell cache is `wkx-shell-v13-help`; it preloads the new styles/controller and versioned Solo client. API and identity traffic remains uncached. No Android package update is required because the Play TWA loads these live pages.

Validation: the local fixture browser QA covers first play, dismissal/reload, manual reopening, Escape/focus, full-guide links, 320/390/768/1280px layouts, light mode, storage fallback, failed-load retry, navigation, launcher destinations, and offline reconnect. No production guesses, rewards, or provider logins are submitted. All 17 app-shell/archive tests pass. Screenshots/results are in `C:\Word Tycoon\output\wikicontexto-how-to-play-20261004`. Physical phone keyboard/Back behavior remains part of the existing device QA.

Deploy through `/tmp` with canonical preimage guards and backups. Restart `wikisearchle` afterward because the SEO middleware caches HTML in memory; otherwise `/about` and `/solo` can continue serving their old markup.
