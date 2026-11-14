# Store launch: dusk bot for iPhone and Android

What it takes to put the phone app (`apps/mobile`, Capacitor 8) on the App Store and Google Play, what is already done,
and the steps only the owner can take. iPhone first, Android second. Written 2026-11-14.

Related: `docs/mobile-readiness.md` (the app's architecture and the earlier App Store pass), `docs/phone-push.md` (APNs
and FCM keys), `docs/store/ios-listing.md` (the first listing draft; this file supersedes its copy where they differ).

## Owner-only steps (need your login)

Apple (developer.apple.com and appstoreconnect.apple.com):

1. Done: App ID `bot.dusk.mobile` with Push Notifications, Sign in with Apple, Associated Domains.
2. Accept the latest agreements in App Store Connect (Business), or the API key and uploads are refused.
3. Done: Users and Access, Integrations, App Store Connect API, Team Keys: a key with the **App Manager** role (Admin if the
   export is refused creating the cloud distribution certificate), `.p8` in `~/.config/duskbot/apple/`,
   `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH` in `~/.config/duskbot/dusk.env`.
4. **Register one device** (the API key authenticates; checked): developer account,
   Certificates, Identifiers & Profiles, Devices, +, your iPhone's name and UDID (Finder, select the iPhone, click the
   line under its name until the UDID shows, or Apple Configurator). Automatic signing archives with a development
   profile first and Apple refuses to make one for a team with no devices ("Your team has no devices from which to
   generate a provisioning profile"). This is a one-time step.
5. Keys (developer account): make an APNs key (.p8) for push and give it to the link service (`docs/phone-push.md`).
6. App Store Connect, Apps, +, New App: iOS, name **dusk bot**, language English (U.S.), bundle ID `bot.dusk.mobile`,
   SKU `dusk-mobile-ios`, full access. The public API cannot create app records, so this one is by hand.
7. In the record: paste the listing below, answer App Privacy and Age Rating from this file, upload `docs/store/ios/6.9`,
   set the privacy, support and marketing URLs, fill Review Notes and the demo account.
8. After the first upload has processed: TestFlight, check the internal group "dusk team" has the build, install it
   with the TestFlight app on your iPhone, test, then attach the build to version 1.0 and Submit for Review.

Google (play.google.com/console):

1. Create the app: name **dusk bot**, default language English (United States), App, Free.
2. Start **closed testing now**: personal accounts made after 13 Nov 2023 need 12 testers opted in for 14 days in a row
   before production access unlocks (section "Android, closed testing").
3. Testing, Closed testing, create track, upload `app-release.aab` from `apps/mobile/scripts/build-android-release.sh`,
   accept Play App Signing (Google holds the app signing key; ours is only the upload key).
4. App content: privacy policy, app access (demo account), ads (none), content rating, target audience (18+), data
   safety, news app (no), government app (no), financial features (none), health (none).
5. Store listing: text and graphics below, from `docs/store/play`.
6. When eligible: Apply for production, then roll out.

## Status at a glance

| Item | State |
|---|---|
| iOS archive, Release config, unsigned | **verified** here: `build-ios-release.sh --unsigned` archives, the release gate passes, `PrivacyInfo.xcprivacy` and the icon catalog are inside |
| iOS signed archive, export, TestFlight upload | **blocked on two owner steps**: register one device (owner step 4) and create the app record (step 6), then `build-ios-release.sh --upload`. Tried here with the API key: the key authenticates, the archive stops at "Your team has no devices" |
| Android signed `.aab` | **verified** here: built and signed with the upload key, target SDK 36 |
| Upload keystore | made, outside the repo (below) |
| Screenshots | made for both stores (`docs/store/ios`, `docs/store/play`); iOS set needs one retake after screen view is hidden on iOS (below) |
| Privacy manifest | present, matches the nutrition label below |
| In-app review fixes (consent, deletion, demo login, report, purchase UI) | **another branch** (src/mobile, cloud service); listed under "Review risks" |

## Mac App Store: not viable for the desktop app

Every Mac App Store app must run in the App Sandbox. The desktop app's core features are things the sandbox forbids or
App Review refuses:

| What the desktop app does | Under the sandbox |
|---|---|
| Computer control through the bundled cua-driver (Accessibility, Screen Recording, synthetic input to other apps) | Accessibility control of other apps is not available to sandboxed apps |
| Spawning docker or podman, adb, ssh to the person's servers, the bundled cloudflared | Child processes inherit the sandbox; they cannot reach the docker socket, other users' files, or arbitrary binaries outside the container |
| A local HTTP server run as `ELECTRON_RUN_AS_NODE`, a headless Chromium | Both are separate executables that would each need signing into the sandbox, and the server's file access would be confined to the container |
| `osascript` Apple Events to other apps | Needs a temporary-exception entitlement per target app, which App Review rarely grants |
| Downloading and running engines and tools after install | Guideline 2.5.2 (no downloaded code that changes features) |

**Verdict: ship the Mac app outside the store, Developer ID signed and notarized** (being set up separately; see
`docs/releasing.md`). A Mac App Store "lite" build would have to drop computer use, local containers, ssh and remote
servers, the tunnel, Apple Events automation and Android control, which leaves a chat client for bots running
elsewhere. That is what the iPhone app already is, so it is not worth a second Mac build now.

## iOS

### Identity and build settings

| Setting | Value |
|---|---|
| Bundle ID | `bot.dusk.mobile` |
| Team | `APPLE_TEAM_ID` in dusk.env (Individual account) |
| Version | 1.0 (`MARKETING_VERSION`) |
| Build | `DUSK_IOS_BUILD_NUMBER`, default a UTC timestamp `yymmddHHMM`, so every upload is higher |
| Devices | **iPhone only** (`TARGETED_DEVICE_FAMILY = 1`). Chosen on purpose: the phone layout is a single portrait column and has not been designed or tested for iPad; iPhone-only means no iPad screenshots and no review on iPad layouts. The app still runs on iPad in iPhone compatibility mode, which Apple accepts |
| Minimum iOS | 17.0 (the relay needs X25519 in WebCrypto) |
| Orientation | portrait |
| Entitlements | `aps-environment`, `com.apple.developer.applesignin` (Default), `com.apple.developer.associated-domains` (`applinks:dusk.bot`) |
| Push environment | the source file says `development`; Xcode writes `production` when it exports for App Store Connect. `build-ios-release.sh` checks the exported app and fails if it is not production. Do not hardcode `production`: Debug and archive builds are signed with development profiles first and would fail |
| Background modes | none |

### Signing

Automatic signing through an App Store Connect API key: `xcodebuild -allowProvisioningUpdates` with
`-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID` creates the Apple Distribution certificate and
the App Store profile in the cloud, so nothing is clicked in Xcode. The fallback is an Apple Distribution certificate
installed in the login keychain plus Xcode signed in to the account.

```sh
apps/mobile/scripts/build-ios-release.sh --check      # which pieces are present (prints present/missing, never values)
apps/mobile/scripts/build-ios-release.sh --unsigned   # proves the project archives (cannot be uploaded)
apps/mobile/scripts/build-ios-release.sh              # signed archive + .ipa in apps/mobile/ios/App/build/export
apps/mobile/scripts/build-ios-release.sh --upload     # signed archive, uploaded straight to App Store Connect
node apps/mobile/scripts/asc.mjs status               # the app record and its builds' processing state
node apps/mobile/scripts/asc.mjs testflight you@x.com # internal TestFlight group "dusk team" (all builds) + testers
```

The script builds the web bundle, runs the release gate, `cap sync ios`, `xcodebuild archive` (scheme `App`,
`generic/platform=iOS`), writes `ExportOptions.plist` (method `app-store-connect`, `signingStyle` automatic, your team id,
`destination` export or upload) and runs `xcodebuild -exportArchive`. Internal testers must already be users of the App
Store Connect team; `ITSAppUsesNonExemptEncryption = false` means TestFlight asks no export question per build. If the
key's role cannot make a distribution certificate, the archive step says so; use an Admin key or install the
certificate. Transporter (Mac app) can upload the exported `.ipa` instead.

### Icons and launch screen

- App icon: one 1024 x 1024 PNG, no alpha (checked), `Assets.xcassets/AppIcon.appiconset`. Xcode makes the other sizes.
- Launch screen: `LaunchScreen.storyboard` with light and dark 2732 x 2732 images (`Splash.imageset`).
- Redraw both from `build/icon.svg` with `node apps/mobile/scripts/make-icons.mjs`.

### Privacy manifest

`apps/mobile/ios/App/App/PrivacyInfo.xcprivacy`, in the App target's Copy Bundle Resources (checked: it is inside the
archived `App.app`).

- Tracking: false, no tracking domains.
- Required-reason APIs: `UserDefaults`, reason `CA92.1`, from `@capacitor/preferences`, which ships no manifest of its
  own. Checked every plugin's iOS source in the Swift package graph for UserDefaults, file timestamps, system boot time,
  disk space and active keyboards: Preferences is the only user. The Capacitor and Cordova frameworks and keychain-swift
  ship their own manifests. ML Kit is Android-only (not in the iOS package).
- Collected data types: exactly the four rows of the nutrition label below. Keep the two in step.

After the first signed archive: Xcode Organizer, right-click the archive, Generate Privacy Report, and compare it with
this section.

### App Privacy (nutrition label)

Tracking: **No**. Every type below is **linked to the person**, used for **App Functionality** only, never for tracking.

| Data type | When | What it is |
|---|---|---|
| Contact Info: Email Address | when the person signs in | the account email |
| Identifiers: User ID | when the person signs in | the account id |
| Identifiers: Device ID | when notifications are allowed | the APNs device token, so a notification can be sent |
| User Content: Other User Content | when the bot runs on our servers (a hosted computer or the review demo bot) | messages and files sent to that bot |

Not collected: location, contacts, photos or videos (an attached photo goes to the person's own workspace), audio,
browsing or search history, purchases, financial, health, usage data, diagnostics.

Two switches that would change these answers, both off in the store build today:

- **Crash reports** go out only when a build sets `DUSK_ERROR_DSN`; the store scripts do not. Turning it on adds
  Diagnostics: Crash Data.
- **Product analytics** (`src/lib/product-analytics.ts`) is opt-in and the phone app has no switch for it, so it never
  sends. Adding the switch adds Usage Data: Product Interaction.

If the in-app branch adds "report this response" (guideline 1.2), the reported message is Other User Content, already
declared. If it adds a name field to the account, add Contact Info: Name.

### Export compliance

`ITSAppUsesNonExemptEncryption = false` in Info.plist. The app uses HTTPS through the system and seals relay traffic
with X25519 and AES-GCM through WebKit's WebCrypto: encryption provided by the operating system, which is the exempt
case. It ships no cryptographic library of its own. This is a self-classification made in your name; App Store Connect
asks nothing per upload while the key is false.

### Age rating

Answer the current questionnaire (the newer descriptors such as Dating and Relationships become mandatory by
2027-01-12):

| Question | Answer |
|---|---|
| Violence, sexual content, nudity, profanity, horror, drugs, alcohol, tobacco, gambling, contests, medical | None |
| Unrestricted web access | **Yes**: links in replies open in the in-app browser |
| User-generated content / messaging | Yes, chat with AI; no person-to-person chat, no public content |
| AI chatbot / generated content | Yes |
| Advertising | No |
| Dating and relationships, virtual companion with romantic or sexual content | No (bots are task assistants; do not present them as companions) |
| Shared location | No |
| Parental controls, age assurance | No |
| In-app purchases | No |

Expect 13+ to 18+ from the web access and AI answers. That is honest; do not lower answers to get a younger rating.

### Screenshots

`docs/store/ios/6.9` (1320 x 2868) is the one required set; `docs/store/ios/6.5` (1284 x 2778) is optional. Six shots:
your team, text them, they do the work, say yes from anywhere, routines (dark), group chats. They are the app's real
screens against an isolated fixture (no real people, businesses or accounts), framed with headlines.

Left out of the iOS set on purpose: dusk cloud (a paid service sold on the web, 3.1.1), connected apps (other
companies' marks, 5.2.1), choosing an AI model (names a third-party AI, 2.3.7, and bring-your-own sign-in is hidden on
iOS v1), and the pairing screen (it names dusk cloud).

**Retake before submitting**: the chat headers still show the screen view button, which iOS v1 hides (4.2.7). Once
that change is on main, rerun with the iOS layout and check no chat header shows it:

```sh
node --experimental-strip-types apps/mobile/store/capture.ts /tmp/dusk-store/raw
node --experimental-strip-types apps/mobile/store/compose.ts /tmp/dusk-store /tmp/dusk-store/sheet.png
cp -R /tmp/dusk-store/ios/6.9 /tmp/dusk-store/ios/6.5 docs/store/ios/ && cp -R /tmp/dusk-store/play/* docs/store/play/
```

(`STORE_ONLY='^chat-'` retakes only matching screens.)

### Listing (App Store Connect)

Name: **dusk bot** (8). App Store names are unique; nothing called "dusk bot" is public today, but an unreleased
reservation would not show. Fallbacks in order: "dusk bot: your ai team" (22), "dusk bot app" (12). The store shows the
name exactly as typed, so lowercase is fine.

| Field | Text |
|---|---|
| Subtitle (30) | Text your team of AI bots (25) |
| Primary / secondary category | Productivity / Utilities |
| Keywords (100) | `ai,agents,assistant,automation,remote,tasks,routines,approvals,chat,team,productivity,companion` (95) |
| Support URL | https://dusk.bot/docs (live). `/support` and `/contact` currently fall through to the waitlist page; add a real support page with an email before submitting |
| Marketing URL | https://dusk.bot |
| Privacy Policy URL | https://dusk.bot/privacy (live; covers the phone app, push, AI providers) |
| Copyright | 2026 [your legal name, as on the developer account] |
| Promotional text (170) | Your AI bots keep working on your computer while you are out. Text them, approve what matters, and get a ping when the work is done. (132) |

Description:

```text
dusk bot is your own team of AI bots, and this app puts them in your pocket.

Your bots run on your computer or server, where they do real work: read and answer email, book things, keep an eye on
your site, run your routines. This app is how you stay in touch with them when you are away from your desk.

WHAT YOU CAN DO
- Text any bot like a teammate and read its reply the moment it lands
- Put a few bots in one room and let them split the work
- Say yes or no when a bot asks before it does something that matters
- Get a notification when a bot finishes or needs you
- See your routines and switch them on or off
- Keep writing with no signal: messages wait and send once you are back
- Start a new bot from your phone

HOW IT WORKS
Pair the app once by scanning the code dusk bot shows on your computer, or sign in to your dusk bot account. From then on
your phone talks to your bots directly, or through an end-to-end encrypted link when you are away.

PRIVATE BY DESIGN
- No ads, no tracking, no analytics
- Your chats stay with your bots, not on our servers
- Your pairing is kept in the iPhone Keychain

You choose which AI your bots use, on your computer. Before anything you write goes to an AI provider, the app tells you
who receives it and asks you first.
```

The last paragraph must match what the in-app consent screen actually does (5.1.2(i)); adjust it once that screen is
final. The copy names no other platform, no price or plan, and no third-party AI brand.

What's New: "The first release of dusk bot for iPhone."

### Review Notes (draft)

```text
dusk bot for iPhone is the remote control for a person's own AI bots. The bots run on the person's own computer or
server, where they do the work; the phone sends messages, shows replies, and lets the person approve actions. Nothing
runs on the phone except the interface, which is bundled in the app.

DEMO ACCOUNT
[DEMO CREDENTIALS: drafted by the in-app branch. A free-plan account with an always-on demo bot on our servers, signed
in without an email code. Keep it running for the whole review.]

STEPS
1. Launch the app. Tap "log in" and use the demo account above.
2. Before the first message, the app shows who receives what you write and asks for permission. Tap Allow.
3. The home screen lists the bots. Tap a bot to open its chat and send a message; the reply arrives within seconds.
4. Open a room (group chat) from the home screen to see several bots working together.
5. When a bot asks before acting, an approval card appears in the chat: tap "Allow once" or "Deny".
6. Tap the profile button (top left) for Settings: routines, appearance, notifications, privacy policy, terms.
7. Report a reply: long-press a bot's message and tap Report.
8. Delete the account: Settings, Account, Delete account. This deletes the account and revokes Sign in with Apple.

NATIVE FEATURES
Camera QR pairing (custom AVFoundation scanner), Keychain storage of the pairing, push notifications for replies and
approvals, haptics, the system share sheet, offline outbox that sends when the connection returns, local network
connection to the person's own computer on the same Wi-Fi.

NOTES
- Purchases: the app sells nothing and shows no prices or links to buy.
- Camera: only for the pairing code and photos the person attaches. Microphone: only for dictation and voice notes.
  Local network: only to reach the person's own computer.
- AI: replies come from the AI provider the person connected on their own computer. The app asks before sending.
- Chats are private to the person; there is no public or person-to-person content.
```

Steps 2, 7 and 8 describe the in-app branch's work; check each against the build before pasting.

## Android

### Identity and build

| Setting | Value |
|---|---|
| Package name | `bot.dusk.mobile` |
| versionCode / versionName | `DUSK_ANDROID_VERSION_CODE` (default 1; raise it for every upload) / `DUSK_ANDROID_VERSION_NAME` (default 1.0) |
| minSdk / compileSdk / targetSdk | 24 / 36 / 36. Play requires new apps and updates to target API 36 (Android 16) since 31 Aug 2026; 36 passes. Expect API 37 to be required from Aug 2027 |
| Permissions (merged manifest) | INTERNET, ACCESS_NETWORK_STATE, CAMERA, VIBRATE, POST_NOTIFICATIONS, WAKE_LOCK, c2dm RECEIVE (push) |

### Upload key and Play App Signing

The upload key is at `~/.config/duskbot/android/dusk-upload.p12` (PKCS12, RSA 4096, alias `dusk-upload`, valid to
2056-11-06; directory mode 700, file mode 600). Its passwords are `ANDROID_UPLOAD_STORE_PASSWORD` and
`ANDROID_UPLOAD_KEY_PASSWORD` in dusk.env (the same value: PKCS12 keeps one password). **Back the file and the password
up together** (the encrypted backup you use for dusk.env); if the upload key is lost, Play support can reset it, which
takes days.

Upload certificate fingerprints (public, for Play or Firebase forms):

```text
SHA-256: 21:82:1A:2F:54:24:66:66:3A:91:FC:5E:F6:6E:74:81:EE:FA:87:50:F5:CA:0D:D6:C3:B3:5C:62:18:68:D6:34
SHA-1:   F2:C8:FB:2A:A4:AD:BC:91:A6:DD:46:AD:8F:40:48:8F:2F:AD:5D:39
```

With Play App Signing, Google signs what users install with its own app signing key. Firebase and Android App Links
want **that** key's SHA-256, from Play Console, Test and release, App integrity, after the first upload.

`apps/mobile/android/app/build.gradle` reads `ANDROID_UPLOAD_KEYSTORE_PATH`, `ANDROID_UPLOAD_KEY_ALIAS`,
`ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_PASSWORD` from the environment or `~/.gradle/gradle.properties`.
Without all four the release build is unsigned (Play refuses it). Nothing secret is in the repo.

```sh
apps/mobile/scripts/build-android-release.sh
DUSK_ANDROID_VERSION_CODE=2 DUSK_ANDROID_VERSION_NAME=1.0.1 apps/mobile/scripts/build-android-release.sh
# -> apps/mobile/android/app/build/outputs/bundle/release/app-release.aab, and the signing fingerprint
```

### Closed testing (start now)

Personal developer accounts created after 13 November 2023 must run a closed test with **at least 12 testers opted in
for 14 days in a row** before they can apply for production. The clock starts when the 12th tester opts in, and it
resets if the count drops below 12.

1. Upload the first `.aab` to a closed track (Testing, Closed testing) and send it for review (usually hours to a few
   days).
2. Testers: add a Google Group or an email list of 15 to 20 people (spare ones in case some opt out). Each opens the
   opt-in link, taps "Become a tester", and installs from Play. Ask them to keep it installed and open it a few times;
   Google looks at engagement when you apply.
3. After 14 days with 12 or more: Dashboard, Apply for production, answer the questions about the test.

### Data safety form

Data is encrypted in transit: **Yes**. People can request deletion: **Yes** (in the app, and at a web address Play
requires: the account deletion page on dusk.bot; it must work without the app installed).

| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Personal info: Email address | yes, when signed in | no | App functionality, Account management | yes |
| Personal info: User IDs | yes, when signed in | no | App functionality, Account management | yes |
| Device or other IDs | yes (push token; ML Kit, see below) | no | App functionality; Analytics (ML Kit) | no |
| Messages: Other in-app messages | yes, when the bot runs on our servers | no | App functionality | yes |
| App info and performance: Diagnostics | yes (ML Kit, see below) | no | Analytics | no |

The Android QR scanner is Google's ML Kit (bundled `com.google.mlkit:barcode-scanning` plus
`play-services-code-scanner`), which sends usage and diagnostics to Google. Check its current disclosure at
https://developers.google.com/ml-kit/android-data-disclosure and copy its rows. Push on Android needs FCM
(`google-services.json`, `docs/phone-push.md`), not set up yet; until it is, push does not work on Android.

### Content rating (IARC questionnaire)

Category: utility, productivity, communication, or other. Answer no to violence, sexuality, language, controlled
substances, gambling. Users interact (chat with AI): yes; shares location: no; unrestricted internet access: yes;
generative AI: yes. Target audience: 18 and over (keeps the Families policy out of scope).

### Listing (Play Console)

| Field | Text |
|---|---|
| App name (30) | dusk bot (8); fallback "dusk bot: your ai team" (22). Play does not require unique names |
| Short description (80) | Text the AI bots on your own computer. Approve what matters, from anywhere. (75) |
| Full description | the iOS description, with "iPhone Keychain" changed to "Android Keystore" |
| Category | Productivity |
| Contact email | a real support address (required, shown publicly) |
| Privacy policy | https://dusk.bot/privacy |
| App icon | `docs/store/play/icon-512.png` (512 x 512) |
| Feature graphic | `docs/store/play/feature-graphic.png` (1024 x 500) |
| Phone screenshots | `docs/store/play/phone/*.png` (1080 x 1920, eight) |

The Play set keeps "plugged into your apps" (shows other companies' app marks) and "on 24/7 with dusk cloud". Play
allows both, but drop the apps shot if a reviewer cites impersonation or trademark.

### Android gaps (decide before production)

- No `RECORD_AUDIO`: dictation, voice notes and calls cannot work on Android. Add the permission (with
  `MODIFY_AUDIO_SETTINGS`) or hide voice on Android.
- Cleartext http to a computer on the same Wi-Fi is blocked from Android 9; pairing over the local network needs a
  network security config that allows private addresses, as iOS has. Pairing through the encrypted link is unaffected.
- No push until FCM is set up.

## Review risks and where they are handled

From the rejection research (`~/.claude/research/app-store-rejections-2026.md`), applied to this app:

| Risk | Guideline | Who | State |
|---|---|---|---|
| Remote screen view of a computer over the internet, or of a hosted machine | 4.2.7 | in-app branch | hidden on iOS v1 (owner decision); retake the iOS screenshots after |
| Prices, plan names, buy or upgrade links | 3.1.1 | in-app branch | none on iOS; the store set and copy name no plan. The demo account must be a free plan |
| AI data sent to third parties without consent | 5.1.2(i) | in-app branch | first-run consent naming each recipient, with a decline path; the description, privacy policy and Review Notes must say the same |
| Bring-your-own AI subscription sign-in | 5.2.2 | in-app branch | hidden on iOS v1 |
| Reviewer cannot use the app | 2.1 | in-app branch, owner | demo account with an always-on bot, no email code; keep it up through review |
| Sign in with Apple parity, in-app deletion with token revocation | 4.8, 5.1.1(v) | in-app branch | entitlement is in this build |
| Report a bad AI reply | 1.2 | in-app branch | report action on bot messages; support contact in the listing |
| Minimum functionality | 4.2 | this file | bundled UI, native features listed in Review Notes |
| Other platforms, AI brands in metadata | 2.3.10, 2.3.7 | this file | none in the iOS copy or screenshots |
| Privacy manifest vs label mismatch | 5.1.1, ITMS-91053 | this file | match; regenerate the Xcode privacy report after the first signed archive |
| IPv6-only networks | 2.5.5 | in-app branch | the app connects by hostname; pairing codes that carry an IPv4 literal for the local network fail on NAT64, which is fine for review (the demo uses https by name) |
| iPad review | 2.4.1 | this file | iPhone only |
| Hidden features, downloaded code | 2.5.19, 2.5.2 | this file | none: no live updates, the web bundle is in the binary; computer use runs on the host |
| Copied third-party assets | legal | release gate | gate passes (it now treats the `katex` package's own fonts as licensed) |

Before pressing Submit: install the TestFlight build on a real iPhone, fresh install, cellular, sign in with the demo
account exactly as written, walk every Review Notes step, and screen-record it in case review asks.

## Site work needed

- A support page with a contact email (`/support` falls through to the waitlist page today).
- The account deletion page reachable without the app (Play requires a URL).
- Universal links (optional for 1.0): serve `docs/store/apple-app-site-association.json` at
  `https://dusk.bot/.well-known/apple-app-site-association` with `TEAMID` replaced by your team id, as
  `application/json` with no redirect. Today that path returns the waitlist page; the entitlement is harmless without it.
