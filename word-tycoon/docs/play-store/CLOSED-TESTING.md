# Word Tycoon closed-testing release

Prepared October 4 and updated October 6, 2026 (America/Edmonton). **The closed-test submission is confirmed in Play Console: Changes in review.** All 16 changes were sent using the existing Subtextle tester group. Google's automated quick checks are still running; the changes enter review when those checks complete successfully. The release is not yet approved, published, or available to testers. Reviewer access, content ratings, target audience, and Data safety are complete. Physical-device testing is deferred at the user's request.

## Release and audience

- Package: `live.wordtycoon.app`; Play Console app: `4976094648068383160`.
- Closed track: Alpha, `4699290636178657594`.
- The existing shared **Subtextle Testers** email list is selected and saved: **42 members**, unchanged. No tester email addresses are exported or stored in this repository.
- All 178 countries/regions are selected, matching Subtextle's closed track.
- Feedback and store support email: `Wordtycoon67@gmail.com`; website: `https://wordtycoon.live`.
- Release name: **1.2.0 — Word Tycoon closed test**.
- Signed Android App Bundle: **version 1.2.0, code 4**, target API 36, minimum API 21.
- Bundle SHA-256: `476f8c22b86fc4f0a4b9ab944fc14d562d8cd39ce19fc1e3e75b1a184b2cd286`.
- Local bundle: `C:\Word Tycoon\output\word-tycoon-play-closed-20261004\WordTycoon-1.2.0-code4-closed.aab`.
- Existing suite upload keystore and alias were reused. No signing secrets are committed.
- Code 3 was uploaded before Google's target API 36 requirement was shown, then removed from this release. It is superseded; do not use it.

The tester opt-in URL is `https://play.google.com/apps/testing/live.wordtycoon.app`. It becomes usable after the release is reviewed and published. The Word Tycoon test has not started, and Subtextle's opted-in days do not count as Word Tycoon testing.

## Saved Play Console setup

- Default English listing with copy below, existing `android/store_icon.png`, 1024 × 500 feature graphic, and two actual 360 × 640 screenshots in `play-store-assets/`. Included in the confirmed review submission.
- Category: Game / Word.
- Privacy policy: `https://wordtycoon.live/privacy`.
- No ads, no advertising ID, no government affiliation, no financial-service features, no health features.
- IARC consent accepted after the user's confirmation on October 5. The completed questionnaire and regional ratings are saved for review: Australia General, Brazil 14+, ESRB Everyone, South Korea All ages, Taiwan General Public, Saudi Arabia 3, PEGI 3, Germany All ages, and IARC/Russia 3+.
- Ratings disclose digital goods purchases and user interaction, including user/content muting and moderated chat. The existing hub widget does not expose a user-report control or a friends-only setting; neither was claimed. No real-money convertible rewards, NFTs, paid randomized items, or real-money item trading were declared. Free gameplay cosmetic drops are not paid loot boxes. The canonical relay word-bank policy blocks excluded words for targets, board words, and guesses.
- Target audience saved as **13–15, 16–17, and 18 and over**, consistent with the privacy policy's exclusion of under-13 users and subject to the regional ratings above.
- Data safety questionnaire completed, **saved as a final declaration**, and included in the review submission. The prior draft export remains `data-safety-draft.csv` in this directory; its answers were preserved.

Data safety includes account names, email addresses, user IDs, purchase history, approximate location, hub chat, profile images, diagnostics, app interactions, saved user content, gameplay actions, and device/browser identifiers. Optional account, purchase, chat, image and gameplay collection reflects guest access. Essential technical/security collection is required. Data is encrypted in transit. The account deletion resource is `https://wordtycoon.live/account-deletion.html`; a separate partial-data deletion mechanism is not claimed. Service-provider processing and expected user-initiated transfers use Google's sharing exemptions. Sources: the live privacy policy, account deletion policy, verified Discord OAuth module, economy/account/IP routes, and [Google's Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

## Submission status

1. **Reviewer access saved:** at the user's request, a dedicated Google account named **Word Tycoon Reviewer** has been created. The owner completed password creation and Google's terms, then entered the existing password directly in Play Console. Sign in details now confirms the saved reviewer record includes a username, password, and instructions. Google sign-in to the live phone app was verified, and a manual Pookie Pass grant is active, including premium game modes, without a Stripe subscription or trial. No password was retrieved from browser storage or recorded in release documentation. Do not commit credentials or paste them into release notes. Google reviewers cannot create their own account or rely on a trial. The declaration correctly marks functionality restricted.

   Reviewer sign-in route: `https://wordtycoon.live/auth/google?returnTo=%2Fapp%2F%23profile`. This uses the existing Google OAuth integration and returns to the phone home; the home's general Sign in button currently uses Discord. Membership access is confirmed at `/membership`. The reviewer begins with an empty account; no puzzle wins, XP, or business progress were fabricated.
2. **Declarations complete:** Target audience was saved after Sign in details, and the existing Data safety draft was finalized without changing its answers. Both prior submission blockers are resolved.
3. **Submission confirmed October 6:** all 16 changes were sent through Publishing overview and its confirmation dialog. The resulting heading is **Changes in review**, with automated quick checks still running and no outstanding declaration errors. Managed publishing is off, so approved changes publish automatically. The Alpha release preview previously passed with code 4 / target API 36. Check the review outcome and actual tester availability before calling the test live. No tester invitations were sent.

Google Play Games is **disabled in this build**. Eleven achievements and their real resource IDs already exist as drafts; Android OAuth credentials and publishing remain pending. Do not create duplicate achievements or enable Games Services until the Android credential setup is approved and complete. See `../play-games/SETUP.md`.

## Build validation

`:app:bundleRelease` succeeds and `jarsigner -verify` verifies the uploaded bundle. `:app:lintRelease` has **0 errors and 21 warnings**. No physical phone testing was performed. The prior web release passed 50 app checks; its published assets and routing were previously verified. This release changes native version/target API and listing assets, not the live web app.

Build with JDK 17 and the existing Android SDK using `android/gradlew.bat :app:bundleRelease`. Omit `-PplayGamesAppId` for this release. Sign using the existing keystore and password-file options; never print the password. Android packaging source and store assets are mirrored to Hetzner for record keeping and do not require restarting the economy service.

## Store listing copy

### Short description

Play word games, collect words, and grow your own little empire.

### Full description

Little words. Big possibilities.

Word Tycoon brings your word-game adventures together in one growing kingdom. Discover puzzles, collect the words you find, and follow your progress across the Word Tycoon universe.

YOUR WORD KINGDOM
Explore a colorful 3D home and jump into your next daily puzzle. Browse the game library to find word, deduction, and grid challenges.

BUILD YOUR EMPIRE
Earn XP through connected games, view your businesses, and follow your progression. Open your business pages to manage upgrades and growth.

MAKE IT YOURS
Browse cosmetic styles, check your wardrobe, and discover the looks that make your profile yours.

COLLECT AND COMPETE
Search your word collection and explore leaderboards for XP, ELO, wins, streaks, and more.

Sign in with Discord to connect your existing Word Tycoon account. An internet connection is required. This closed-testing release introduces the new home experience; Google Play achievement unlocking is planned for a later update.

### Release notes

```text
<en-US>
Welcome to Word Tycoon closed testing!
Explore the new 3D home, your word collection, cosmetic catalog, businesses, leaderboards, and game library. Sign in to view your existing Word Tycoon account.
Google Play achievement unlocking will be enabled in a later test update.
</en-US>
```
