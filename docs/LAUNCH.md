# Launch checklist: Dusk Bot on dusk.bot

What the launch branch (`w15/launch`) did, and what needs the owner's accounts, keys or decisions. Each owner step is
written to be done in order. **Done** means committed and checked; **Owner** means it needs you.

## At a glance

| Area | Done in code | Owner |
|---|---|---|
| Release pipeline | CI and release workflows, signed update manifest, update notice, download publishing script | Apple and GitHub secrets, public downloads repo, first release |
| Hosted services | Health check, data export, CSP, proxy-safe rate limits, config template, backup, log rotation, uptime checks | Deploy with real keys, install backup and monitor, staging |
| Observability | Scrubbing error reporter in the account service, its page, desktop, server and phone app (all off without a DSN) | Pick and create the error tracker, set the DSN, desktop Settings toggle |
| Legal and trust | Terms, Privacy, License, Security drafts (Markdown in `docs/legal`, HTML on dusk.bot), security.txt, account export | Legal review, fill the placeholders, privacy@ and security@ mailboxes |
| Product polish | No-AI screen copy, dashboard offline and error states, landing site, installer docs | The items under "Polish not done" |
| Security | Rate-limit bypass, workspace claim takeover, installer https pinning, link service bind, dependency advisories, history secret scan | Redeploy the link service, the CI reds listed below |

## 1. Release pipeline

### Done

- `.github/workflows/`: `ci.yml` (on pushes to main and PRs: CI selection tests, locales, lint, source guards,
  typecheck, Electron syntax, account dashboard and phone typecheck and page tests, UI build, Linux test shards,
  packaged-server smoke; macOS and Windows shards weekly and on demand to save private-repo minutes),
  `release.yml` (macOS arm64 and x64 signed with the Developer ID certificate, notarized and stapled through the App
  Store Connect API key; Windows x64 NSIS; Ubuntu deb and AppImage; every artifact verified; a draft release),
  `prepare-release.yml` (version bump PR, which starts the release when merged), `package-linux.yml`,
  `package-win.yml`, `windows-defender-check.yml`, `ci-stop-closed.yml`. Secrets are read only from GitHub Actions
  secrets. `scripts/ci-workflow.test.ts`, `ci-scope.test.ts` and `release-ci.test.ts` pass against them.
- Versioning: `package.json` version, bumped by **Actions > Prepare next release**. Changelog: GitHub's generated
  release notes from PR titles (docs/releasing.md).
- Update strategy: the desktop server reads `https://dusk.bot/releases/latest.json` (at most hourly; the app asks
  daily), accepts it only when a pinned Ed25519 release key signed a `desktop` manifest, and offers a newer version
  with a link to dusk.bot/download: once per version as a notification, and in the profile menu. Nothing is
  downloaded or installed for the person. The release job writes `SHA256SUMS` and the signed `latest.json` (artifact
  `dusk-site`); `scripts/publish-downloads.sh v<version>` verifies and publishes them.
- Download page: https://dusk.bot/download (links to the public downloads repo's `/releases/latest/download/`).

### Owner

1. **Apple Developer Program** (if not already): a Developer ID Application certificate for bundle id
   `bot.dusk.app`. Export it from Keychain as .p12 with a strong password.
2. **App Store Connect API key** for notarization: Users and Access > Integrations > App Store Connect API >
   Team Key, role Developer. Download the .p8 once; note Key ID and Issuer ID.
3. In **github.com/goatedgrokbotalternative/duskbot > Settings > Secrets and variables > Actions** add:
   `MAC_CERT_P12_BASE64` (`base64 -i DeveloperID.p12 | pbcopy`), `MAC_CERT_PASSWORD`,
   `APPLE_API_KEY_P8_BASE64` (`base64 -i AuthKey_XXXX.p8 | pbcopy`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`,
   `DUSK_RELEASE_SIGNING_KEY` (the private half of the pinned key `rel-2026-11`; if you no longer have it, make a new
   one with `node apps/cloud-service/scripts/keygen.mjs rel-2026-12 ~/.config/duskbot/keys`, pin the printed public
   key in `apps/cloud-service/src/release-signing.ts` and `server/update-check.ts`, then set the secret).
   Optional: `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit) to let main pushes deploy the Composio broker.
4. **Settings > Actions > General**: allow GitHub Actions to create pull requests (for Prepare next release).
5. **Billing check**: private repos get 2,000 free Actions minutes a month; macOS minutes count 10x, Windows 2x. A
   release costs roughly 300 to 600 counted minutes. Set a spending limit you are comfortable with, or the release
   stops when the quota runs out. Note: `ubuntu-24.04-arm` (one weekly job) may need paid larger runners on a private
   repo; delete that job if it does not start.
6. **Windows signing** (decision): builds are unsigned, so SmartScreen warns "unknown publisher". Options: Azure
   Trusted Signing (about USD 10 a month, needs a verified organization) or an OV/EV certificate. Wire it into
   `release.yml`'s Windows job when chosen.
7. **Public downloads repo**: `gh repo create goatedgrokbotalternative/duskbot-releases --public --description "Dusk Bot downloads"`.
8. **First release**: Actions > Prepare next release > patch; merge the PR; when the draft is ready, review and
   publish it; then on the Mac `DRY_RUN=1 scripts/publish-downloads.sh v<version>` and without `DRY_RUN`. Then
   remove the "Downloads open with the first public release" line from
   `~/Desktop/code/deployd/sites/dusk/pages/download.html` and run `sites/dusk/deploy.sh landing`.
9. **Store listings** (only if wanted): Mac App Store and Microsoft Store are not set up (the app is distributed
   directly); the phone app (Capacitor, `apps/mobile`) needs an App Store Connect app record for its bundle id, a
   Google Play developer account (one-time USD 25), screenshots, the privacy nutrition label (use
   https://dusk.bot/privacy and `docs/ios-privacy.md`), and push credentials (APNs key, FCM service account).

## 2. Hosted services (app.dusk.bot, dev.dusk.bot)

### Done

- `GET /v1/health` on the account service (200 while its data folder is writable).
- Rate limits now use the proxy's own `X-Forwarded-For` entry (was the client's, so every per-IP limit could be
  skipped). Cookies: session HttpOnly, SameSite=Lax, Secure on https; CSRF header per session; JSON and same Origin on
  every mutation. A strict CSP on the page (own scripts plus the theme script by hash, `connect-src 'self'`,
  `frame-ancestors 'none'`), Permissions-Policy and COOP.
- `deploy/account/production.env.example`: every setting the service reads, what it does, no values (a test keeps it
  complete).
- `deploy/account/backup.sh` + `dusk-account-backup.{service,timer}`: daily copy of the data folder, encrypted to an
  age public key, sent to any rclone destination, pruned after 30 days.
- `deploy/account/logrotate.conf` for the dusk apps' logs.

### Owner: deploy the account service

Nothing here was deployed with real keys. app.dusk.bot and dev.dusk.bot still serve the placeholder pages.

1. On the VPS check `node --version` is 24 or later for the account service (it runs TypeScript directly) and that
   `pnpm` is installed for root (`corepack enable`).
2. Fill a copy of `deploy/account/production.env.example` outside the repo (`chmod 600`), at least:
   `DUSK_DASHBOARD_PUBLIC_URL=https://app.dusk.bot`, `DUSK_DASHBOARD_DATA=/var/lib/dusk-account`,
   `DUSK_TRUST_PROXY=1`, `DUSK_ENVIRONMENT=production`, `DUSK_MAIL_PROVIDER=brevo`, `DUSK_BREVO_API_KEY`,
   `DUSK_MAIL_FROM`, `DUSK_OPS_ALERT_EMAIL`, `DUSK_ERROR_DSN`, and for billing `DUSK_BILLING_PROVIDER=dodo`,
   `DUSK_DODO_MODE=live`, `DUSK_DODO_API_KEY`, `DUSK_DODO_WEBHOOK_SECRET`, `DUSK_DODO_PRODUCTS`,
   `DUSK_ENTITLEMENT_SIGNING_KEY`. Add the cloud desktop names only when Dusk Cloud opens.
3. Deploy from GitHub with deployd (it auto-pulls new commits; `--force` is needed because `dusk-app` holds the
   domain, which only you should approve):
   ```sh
   deploy --repo git@github.com:goatedgrokbotalternative/duskbot.git --name dusk-account --domain app.dusk.bot \
     --env-file ~/secure/dusk-account.env \
     --install "pnpm install --frozen-lockfile --ignore-scripts && pnpm build:dashboard" \
     --cmd 'set -a; . ./.env; set +a; mkdir -p "$DUSK_DASHBOARD_DATA"; DUSK_DASHBOARD_PORT=$PORT exec node apps/dashboard/server/main.ts'
   deploy rm dusk-app      # the placeholder, once app.dusk.bot answers from dusk-account
   curl -4 -fsS https://app.dusk.bot/v1/health
   ```
   The deploy key must be able to read the private repo (a read-only deploy key on the repo).
4. **Brevo**: add and authenticate the domain dusk.bot (its Brevo code, DKIM and a DMARC record
   `v=DMARC1; p=quarantine; rua=mailto:hello@dusk.bot`) in DNS, create an API key.
5. **Dodo Payments**: live mode products for each plan id in `shared/billing-api.ts`; webhook
   `https://app.dusk.bot/v1/billing/webhooks/dodo` with its secret; business verification and payout details
   (payment details are yours to enter).
6. **Sign in with Google / Apple / X** (optional): register the callbacks
   `https://app.dusk.bot/v1/auth/oauth/{google,apple,x}/callback` and set the client names in the env file.
7. **Mailboxes**: hello@, privacy@ and security@dusk.bot must receive mail (Spaceship email forwarding or a mail host;
   MX records).
8. **Backups**: `apt install age rclone`; create an age key pair on your Mac (`age-keygen -o ~/secure/dusk-backup.key`;
   keep it off the server and in your password manager), configure an rclone remote off the box (free option: Oracle
   Object Storage on the existing Oracle account, 20 GB Always Free; or Backblaze B2), then:
   ```sh
   install -D -m 0755 deploy/account/backup.sh /opt/dusk-account/backup.sh
   install -D -m 0600 /dev/null /etc/dusk-account/backup.env   # DUSK_DASHBOARD_DATA, DUSK_BACKUP_RECIPIENT=age1..., DUSK_BACKUP_DEST=remote:bucket/account
   cp deploy/account/dusk-account-backup.{service,timer} /etc/systemd/system/ && systemctl enable --now dusk-account-backup.timer
   systemctl start dusk-account-backup.service && journalctl -u dusk-account-backup -n 5
   ```
   Test a restore once: `rclone copy remote:bucket/account/<file> . && age -d -i ~/secure/dusk-backup.key <file> | tar -tz`.
9. **Log rotation**: `cp deploy/account/logrotate.conf /etc/logrotate.d/dusk && logrotate -d /etc/logrotate.d/dusk`.
10. **Rate limits at the edge** (optional, defence in depth): a `limit_req` zone on `/v1/auth/` in deployd's nginx
    template; the service already limits sign-in starts (20 an hour per IP, 6 per email), code checks (60/h),
    enrolls (30/h) and page error reports (60/h).
11. **Staging on dev.dusk.bot**: the same deploy as `dusk-account-dev` with `--domain dev.dusk.bot`,
    `DUSK_DASHBOARD_PUBLIC_URL=https://dev.dusk.bot`, `DUSK_DASHBOARD_DATA=/var/lib/dusk-account-dev`,
    `DUSK_ENVIRONMENT=staging`, `DUSK_DODO_MODE=test` with test keys, `DUSK_AUTH_SIGNUP_OPEN=0` and your own account,
    its own Resend sender and no `DUSK_MANAGED`. The desktop app's staging Cloud already points at dev.dusk.bot.
12. **Link service**: redeploy `link.dusk.bot` from this branch so it serves the https-pinned installer and listens on
    127.0.0.1 (`HOST` env to override). The live link service still serves the older installer at `/i/<code>`.

## 3. Observability

### Done

- `electron/error-report.mjs`: one scrubbing reporter for a Sentry-compatible endpoint (sentry.io or self-hosted
  GlitchTip). An event holds the error type, a scrubbed message (no secrets, emails, URLs, quoted text, IPs, long ids
  or home paths), app-relative stack frames, component, release and environment; never bodies, users, breadcrumbs,
  headers or env. Hourly dedupe per error, 10 events a minute at most, fatal crashes spooled and sent on next start.
- Wired: account service (process crashes and every 500, `component: dashboard`), its page (`POST /v1/client-error`,
  same origin, rate limited, forwarded through the same scrubber), the desktop app (main process, page and child
  process crashes), the bundled server (inherits the DSN only while the person keeps reports on), the phone app
  (`DUSK_ERROR_DSN` at build time). Without a DSN every one of them sends nothing.
- `deploy/monitor/uptime-check.sh` + `dusk-uptime.{service,timer}`: every minute checks https://dusk.bot/,
  /install.sh, https://app.dusk.bot/v1/health and https://link.dusk.bot/healthz; mails the operator through Resend
  after three misses and again on recovery.

### Owner

1. **Error tracker** (pick one): self-hosted GlitchTip on the Oracle box (free; Docker Compose with Postgres and
   Redis, about 1 GB of memory; put it behind a subdomain such as errors.dusk.bot) or sentry.io's free Developer plan
   (5,000 errors a month, one user). Create one project per component or one shared project; copy its DSN.
2. Set `DUSK_ERROR_DSN` in the account service env (and staging's, with `DUSK_ENVIRONMENT=staging`). Turn on the
   tracker's email alerts to your operator address for new issues.
3. Desktop builds: before baking a DSN into release builds, add a Settings switch for the existing `errorReports`
   preference (electron/desktop-prefs.mjs; it defaults to on and is read at launch), then add a release step that
   writes `"duskbot": { "errorDsn": "<dsn>" }` into package.json before packaging. Until then desktop builds send
   nothing.
4. Phone builds: build with `DUSK_ERROR_DSN=<dsn> pnpm mobile:build` once the privacy label says so.
5. **Uptime**: on the Oracle VPS (it watches the Contabo box from outside):
   `install -D -m 0755 deploy/monitor/uptime-check.sh /opt/dusk-uptime/uptime-check.sh`, write `/etc/dusk-uptime.env`
   (0600: `DUSK_RESEND_API_KEY`, `DUSK_ALERT_TO`, `DUSK_ALERT_FROM`), copy the two units to `/etc/systemd/system/`,
   `systemctl enable --now dusk-uptime.timer`. Needs `node` and `curl` there. Or use UptimeRobot's free plan with
   the same four URLs.

## 4. Legal and trust

### Done

- Drafts in `docs/legal/{terms,privacy,license,security}.md`, each opening with "Draft for legal review", published as
  https://dusk.bot/terms, /privacy, /license and /security (built from the Markdown by
  `deployd/sites/dusk/build-pages.mjs`). The privacy policy lists the sub-processors: Contabo, Cloudflare, Boat, Dodo
  Payments, Resend, Composio, Apple APNs, Google FCM, Spaceship, Let's Encrypt and the error tracker; AI model
  providers are the user's own relationship.
- https://dusk.bot/.well-known/security.txt (expires 2027-11-10).
- Data export: **Download your data** on the dashboard's Account page (`GET /v1/account/export`: account, sign-ins,
  sessions, workspaces with their latest report, plans, payments, cloud desktops; no tokens, hashes or keys). Deletion
  already existed (Account > Delete account; cloud desktop data on its own page with a 7-day hold).
- Cookie notice: not needed. app.dusk.bot sets only strictly necessary cookies (session, CSRF, OAuth state) and a theme
  value in local storage; dusk.bot sets none.

### Owner

1. Lawyer review of all four documents; fill every `[placeholder]`: legal entity and address, governing law and
   courts, effective date, refund policy, retention periods (cloud desktop after a plan ends, access logs), minimum
   age, data center region, each provider's processing locations and transfer mechanism, error tracker choice.
2. Sign the processors' DPAs (Contabo, Cloudflare, Resend, Dodo, Composio, Boat, the error tracker).
3. Decide whether naming Boat publicly on /privacy is fine now (apps/cloud-service/README.md planned it for "once
   there are EU customers"; the privacy page names it today).
4. After review: replace the drafts in `docs/legal`, run `sites/dusk/deploy.sh landing`, and bump security.txt's
   Expires yearly.

## 5. Product polish

### Done

- No-AI first run: "Connect an AI to get started" (was "Install a model provider"), no "AI CLI" jargon, remote-host
  copy translated (16 locales).
- Account dashboard: only a 401 signs the page out (offline no longer drops you to sign-in); failed account,
  workspace, cloud, billing and usage loads show a message with Retry instead of endless skeletons; plain fallback
  error text.
- dusk.bot: home, download, docs (getting started, VPS install with `curl -fsSL https://dusk.bot/install.sh | sh -s <code>`
  and a read-first variant with `install.sh.sha256`), pricing (no invented prices; links to the account's Plans
  page), footer with legal links; strict CSP and HSTS. `www.dusk.bot` does not resolve yet.

### Polish not done (owner or a follow-up)

- Renderer settings screens still show raw transport text ("Failed to fetch", "502 Bad Gateway") from `src/state/api.ts`
  in EnginesSettings, KeyPanels, VoiceSettings, LocalComputerSection and AccessSection; route them through
  `src/lib/plain-error.ts` (a change to `api()` itself would alter the chat failure cards another track owns).
- Engine install failures on first run show npm's log tail (`EngineSetup.tsx` with `server/engine-install.ts`); one
  sentence plus "Show details" would read better.
- Before the AI list loads, a fresh window can show "No bots yet / New bot" (`App.tsx`), and a connection that fails
  before first load shows "Connecting to your bots..." with no retry (`BootCover.tsx`).
- Add `www.dusk.bot` (DNS A record at Spaceship, then `deploy aliases dusk-landing www.dusk.bot`).

## 6. Security review

### Fixed

- **Rate limits bypassable** (blocker): the account service read the first `X-Forwarded-For` entry, which the client
  writes; a new value per request skipped every per-IP limit (sign-in mail, code checks, enroll, claims). Now the
  proxy's own last entry (`apps/dashboard/server/client-ip.ts`), with a regression test.
- **Workspace claim takeover**: an unsigned `/v1/enroll` could rotate the claim link of any workspace whose public key
  the caller knew. Workspaces now sign every enroll; unsigned enrolls can only create a new workspace.
- **Installer transport**: a non-https `LINK_BASE` now stops the installer before it sends the server token or fetches
  root-run code; every request to the link service pins `--proto =https --proto-redir =https`. Packages and kits were
  already sha256-verified; the script is functions-only with `main "$@"` last, so a partial download runs nothing.
  dusk.bot serves `install.sh.sha256` beside it.
- **Link service** listened on 0.0.0.0; it now binds 127.0.0.1 by default (it is only reached through nginx, which
  sets `X-Real-IP` itself).
- **Dependencies**: `pnpm audit --prod` had 9 findings (4 high: undici TLS validation bypass and DoS, the Electron
  intermediate certificate fix); now 1 low (katex, needs a 0.16 to 0.18 upgrade). Dev-only findings remain in
  electron-builder's dependencies (xmldom, brace-expansion, js-yaml, minimatch) and wrangler (sharp); they do not ship.
- **Dashboard CSP**: full policy on the page, not only `frame-ancestors`.

### Checked and sound

Session cookies, CSRF, CORS on app routes, OAuth state and PKCE, email code limits, the Dodo webhook signature
(raw body, 5-minute window, constant-time compare, replay ids kept 30 days), the ops token, workspace report
signatures, static file serving, cloud-service claims and release signatures, link token hashing, the Slack callback.
History secret scan over every commit on every ref: no live keys (all matches were redaction code, PEM format checks
and identifiers); `.env*`, `.dev.vars.*` are ignored.

### Owner or follow-up

- Sign the link agent and docker gate (`agent.mjs.sig` is already served at `/v1/release`) and have the installer
  verify them with the pinned release key; today they rely on TLS to link.dusk.bot.
- App sessions renew for 90 days on each use with no absolute cap; consider a one-year cap.
- Account deletion needs a session, CSRF and the typed email, not a fresh sign-in (cloud data deletion does).
- katex 0.18 upgrade (low).

## CI on main today

A local dry run of `ci.yml`'s static job on this branch passes: CI selection tests, locales, typecheck, Electron
syntax, dashboard and phone checks, UI build and dashboard build. This branch also fixed reds that were already on
`main` (about 38 lint warnings, 13 stale Electron node tests, the clipboard guard). Still red on `main` and on this
branch alike, so the first CI run will fail until they are fixed:

- `pnpm lint`: two warnings in `src/components/chat-bubble.ts` (a chat file the chat track owns; use `\u` escapes in
  its emoji character class).
- Source guards: `src/lib/random-uuid.test.ts` (`apps/mobile`'s `src/mobile/connection/pair.ts` calls
  `crypto.randomUUID()` without the fallback), `src/locales/vocabulary.test.ts` and `scripts/testing/analytics-docs.test.ts`
  (read the removed `apps/docs`).
- Linux shards: UI e2e tests whose clicks land on a fixed full-screen layer (`control-omb-ui`, `presets-ui`,
  `sidebar-scroll-ui` and others), `ConnectAppsWindow.dom.test.ts`, `local-computer`, `setup-import`, `github-refs`,
  `scripts/packaged-native-modules.test.mjs` (docs/LICENSING.md and the removed `deploy/podman`), the file-size
  ratchet (main.mjs, codex.ts and three more files over their listed sizes), and slow `server/*.e2e.test.ts` timeouts.
  Each was compared against `main` on the same machine: none is new on this branch.
