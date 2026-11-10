# Managed cloud service

The managed cloud desktop backend. It runs inside the account service (`apps/dashboard/server`), which attaches it
with `DUSK_MANAGED=1` and talks to it only through `apps/dashboard/server/clouds/managed.ts`. Everything that names the
provider lives here: the provider client (`src/boat.ts`), the lifecycle (`src/lifecycle.ts`), the machine setup
(`src/home.ts`), backups, retention, the stray-machine sweep, the fake provider API for tests, the home package and
template builders, the e2e harness, the home's edge config (`deploy/Caddyfile`), the public edge (`edge/worker.js`) and
the provider notes (`docs/provider.md`).

The app, the home server and the public docs never name the provider. `scripts/provider-names.test.ts` fails the build if
`src`, `electron`, `shared`, `server`, `apps/mobile` or the README does. The provider is named here, in the privacy
policy and DPA as a sub-processor once there are EU customers (required disclosure), and nowhere a user looks.

## How we protect it

The code is in the repo, like OpenBot's. What protects the business is the same as theirs, plus three layers they do not
have: signed releases, opaque public names and offline-verified entitlements.

### Where each secret lives

| Secret | Where | Who uses it |
|---|---|---|
| `BOAT_API_KEY` (runtime key) | account service environment only | `src/boat.ts`, from the reconciler |
| `BOAT_TEMPLATE_API_KEY` (template key) | the release CI environment only, never the account service (it refuses to start if both are the same key) | `scripts/build-template.ts` |
| `DUSK_ENTITLEMENT_SIGNING_KEY` (Ed25519, `kid:<pkcs8>`) | account service environment only | `apps/dashboard/server/entitlements.ts` |
| `DUSK_RELEASE_SIGNING_KEY` (Ed25519) | the release CI environment only | `scripts/sign-release.ts` |
| `DUSK_CLOUD_SEAL_KEY` | account service environment | seals each cloud's bootstrap secret and link key at rest; backups key is derived from it unless `DUSK_MANAGED_BACKUP_KEY` is set |
| `DUSK_MANAGED_BACKUP_KEY` (optional) | account service environment | seals backups; never on a machine |
| `DUSK_MANAGED_EDGE_TOKEN` | account service and the edge Worker (`EDGE_TOKEN`) | the edge's route lookup |
| Payment, email, ops tokens | account service environment | billing, notices |
| A cloud's bootstrap secret and dashboard link key | sealed in the account service's store; on its machine in root-only files | the signed admin requests to that home |

The public halves are pinned in code: entitlement keys in `shared/entitlement.ts` and `electron/entitlement.mjs` (a
parity test keeps them equal), release keys in `src/release-signing.ts`. Generate a new pair with
`node apps/cloud-service/scripts/keygen.mjs <kid> <dir>`: it writes the private key 0600 and prints only the public one.

Provider key scopes. The runtime key needs sandbox create, get, list, update (the lease), stop, resume and delete, plus
commands and file upload on its own sandboxes (package install, start after a held resume, restore) and snapshot file
reads (backups). With a template the install step goes away; restore and start still need commands. The template key
needs sandboxes, commands, files and named snapshots, and lives only in CI. Ask the provider for a key limited to those
scopes; if it offers no scoping, keep the two keys on two accounts so the runtime key cannot touch templates.

### Who can call what

| Route | Caller | Credential |
|---|---|---|
| `/v1/clouds/*`, `/api/cloud/desktop/*` (account service) | the owner's app or browser | the account session (cookie with CSRF, or app bearer) |
| `/v1/clouds/:id/delete-data[/confirm\|/cancel]` | the owner | fresh sign-in (10 minutes), CSRF, emailed one-time link; rate limited; acts only after 7 days through the retention verdict |
| `POST /v1/managed/claims/redeem` | a machine at first boot | the one-time claim; 30 wrong tries per address per 15 minutes (a good one never counts) |
| `GET /v1/managed/edge/route` | the edge Worker | `DUSK_MANAGED_EDGE_TOKEN`; anyone else gets 404 |
| Home `/api/cloud/*` (health, power, sleep, plan, pairing, entitlement) | the account service | HMAC over method, path, body hash, timestamp and nonce with the cloud's bootstrap secret |
| Home API and pairing | the owner's app | a paired session, and only while the home holds a valid entitlement |
| Provider API | the reconciler and the template build only | the provider keys above |

### How a machine proves it is ours, and how the app and the home know a cloud is paid for

1. **Create.** The machine is created with `noEnv` and a boot file holding only its cloud id and a 256-bit one-time
   claim (an HMAC of the cloud id and attempt under the service's backup secret, so a retried create that gets the
   first machine back carries the same claim; the service keeps only its hash, valid 1 hour). The provider's API, its
   logs and its dashboard never see a secret.
2. **First boot.** The setup script redeems the claim at `/v1/managed/claims/redeem` (retrying for up to 55 minutes,
   honouring `Retry-After`) and gets the bootstrap secret, the dashboard link key and its env. It is answered once,
   again within 5 minutes for a lost answer (audited and alerted), then never; a recovery's new machine gets a new
   claim. The setup moves them into root-only files and shreds the boot file.
3. **Install.** Root's `omb-home install` checks the package's sha256 and its release signature against the pinned
   release keys before unpacking. A machine started from a template checks the template's signature against the tree
   hash of the app it carries before anything starts.
4. **Entitlement.** Before a cloud counts as running, and hourly after (and on every wake), the account service signs an
   Ed25519 entitlement (24 hours, key id, cloud id, plan, features, an opaque account reference, no email) and pushes it
   through the signed `POST /api/cloud/entitlement`. Every home this service makes has `DUSK_CLOUD_ENTITLEMENT=required`
   in its boot env, and then serves nothing but its liveness probe and the signed admin routes without a valid token
   for its own machine id, pairing included. A home another Admin runs from the same release (without that env) is
   unaffected until that Admin pushes entitlements too. Clock skew of 5 minutes
   either way is tolerated; tokens longer than 7 days are refused whoever signed them.
5. **App.** The session's cloud list carries the same token; the app verifies it offline (`electron/entitlement.mjs`)
   and offers the Cloud desktop only for a cloud whose token verifies for that cloud id. A packaged app trusts only the
   pinned keys; a development build also trusts `DUSK_ENTITLEMENT_DEV_KEYS`.
6. **Rotation.** Pin the next public key in a release first (kid `ent-YYYY-MM`), ship it, then switch the service's
   signing key. Tokens from the old key keep verifying until it is removed from the pinned list in a later release.

### What people see

User-facing origins are `https://<label>.<DUSK_MANAGED_PUBLIC_DOMAIN>`. The label is an HMAC of the cloud id (20 hex
characters): it names no person, no cloud id and no provider. The edge Worker (`edge/worker.js`) maps it to the
machine's own hosted URL through `/v1/managed/edge/route`, caches the answer 60 seconds, forwards WebSockets, strips
`server`/`via`/`x-powered-by` and rewrites redirects. The home answers for both names (`DUSK_CLOUD_UPSTREAM_HOST`) and
keeps the public one as its `DUSK_PUBLIC_URL`. The account service itself talks to the machine's own URL.

DNS and proxy, once:

1. A zone you control, say `desktops.example.com`, on Cloudflare.
2. Deploy `edge/worker.js` with `wrangler deploy` and bindings `ROUTE_URL` (the account service origin), `PUBLIC_DOMAIN`
   (`desktops.example.com`) and the secret `EDGE_TOKEN` (`wrangler secret put EDGE_TOKEN`, same value as the service's
   `DUSK_MANAGED_EDGE_TOKEN`, 32 characters or more).
3. A proxied wildcard record `*.desktops.example.com` (any target; the Worker answers) and the Worker route
   `*.desktops.example.com/*`. Cloudflare's universal certificate covers one wildcard level.
4. Set `DUSK_MANAGED_PUBLIC_DOMAIN=desktops.example.com` on the account service. It refuses to start without it (and
   without the edge token) unless it runs on loopback.

Machines are named `omb-<cloud id>` at the provider (no email), labelled with the cloud id and this deployment's scope.

### What cannot be prevented

- Anyone with the source can remove the entitlement check from their own build of the app or the home, or start our
  home package without `DUSK_CLOUD_ENTITLEMENT=required`, and run it against a service of their own. Signed tokens stop
  forged tokens, not a modified copy or a different boot env. A release build never trusts development keys.
- Anyone can buy the same provider, run their own account service and their own Stripe. The recipe is public here, as
  OpenBot's is. What they do not have is our keys, our accounts, our domain, our users' data and the service itself.
- Network inspection (DNS, the certificate behind the provider's URL, the ASN, timing) can reveal the provider to a
  determined user even behind the edge. Hiding is about not advertising it.
- The license (PolyForm Strict) is enforced by law, not code: keep the copyright holder, a CLA, a trademark
  file and terms of service current. Obfuscation is not worth it.

### Deploys

- **Account service.** Built from `main`; secrets come from the deploy environment, never from the repo. Deploy it
  before any home that requires entitlements: a home from this release refuses clients until the service pushes one.
- **Home package.** CI builds it (`node apps/cloud-service/scripts/build-home-package.mjs`), signs it
  (`DUSK_RELEASE_SIGNING_KEY=… node apps/cloud-service/scripts/sign-release.ts release/home/omb-home.tgz --kind home-package --name omb-home --version <v>`),
  publishes the package and its `.sig`, and the service gets `DUSK_MANAGED_HOME_PACKAGE_URL`, `_SHA256` and
  `_SIGNATURE` (or `_SIGNATURE_FILE`). The service checks the signature at start and refuses an unsigned package off
  loopback.
- **Template.** See "Pre-baked template" below; it runs only in CI, with the template key. The service gets `DUSK_MANAGED_TEMPLATE` and
  `DUSK_MANAGED_TEMPLATE_SIGNATURE` and checks it at start.
- **Test and production** use different provider keys and, preferably, different provider accounts, and every list and
  delete is limited to the deployment's scope label.

### Compared with OpenBot (ideas only, no code copied)

Same: one runtime key in the service and a separate template key in CI; the machine gets only a short-lived claim
(`noEnv`); hosted mode is claimed, not configured; a pre-stop hook with a restart guard; a dead-man lease; a keep-alive
start before the provider's 14-day purge; backoff on provider limits. Different: our releases and templates are signed
and checked by the machine (theirs are pinned by checksum only); the user-facing name is ours (they need none because
clients reach machines through their relay); the app and the home verify entitlements offline with pinned keys and an
explicit clock tolerance; machine labels carry no email; backups live off the provider with 45-day retention.

## Lifecycle hardening

### Pre-baked template

`scripts/build-template.ts` runs in the release job with `BOAT_TEMPLATE_API_KEY` and `DUSK_RELEASE_SIGNING_KEY`:

1. creates a builder (`noEnv`, no boot file, its own scope, a 2-hour lease) with the same setup script as every home;
2. uploads the signed home package; root's `omb-home install` checks the signature;
3. checks the app never ran (no env, no machine id, an empty data folder) and refuses to save otherwise;
4. hashes the installed app (`omb-home tree`), signs `{kind: template, name, version: <package sha256>, sha256: <tree>}`
   and places the signature in the image;
5. saves the named snapshot `omb-home-<version>` (never replacing an existing name), waits for it, deletes the builder;
6. keeps the three newest templates plus any `--in-use` one, and prints `DUSK_MANAGED_TEMPLATE` and
   `DUSK_MANAGED_TEMPLATE_SIGNATURE` for the service.

A machine started from it checks the signature against its app's tree hash before anything starts (this catches a
wrong or altered template, not a hostile provider, which runs the check itself), skips the downloads
and system packages it already has, and the service skips installing the package the template carries. Saved
snapshots need a paid provider plan (the trial refuses them). Engine CLIs are still installed by the home on first use;
baking them in is a later step.

### Provider limits, conflicts and failing stops

- A 429 is never a failure: the cloud keeps its state, the step is retried 30 s, 1, 2, 4 then 5 minutes later (or as
  long as `Retry-After` asks, up to 15 minutes), attempts are not counted, and the audit says `provider_limit` once
  per streak; 12 in a row alert the operator. Setup keeps its 45-minute ceiling.
- A 409 or a "busy" answer to a resume or a stop means the machine is already on its way: in progress, not an error,
  never a reason to rebuild.
- A stop the provider reports as `failing` is read as stopping: the home is not started again, the cloud is not counted
  awake, nothing is deleted while it lasts, and after 15 minutes the operator is alerted (`stop_failing_long`).

### Pre-stop hook

`~/.boat/pre-stop` (the provider allows 60 s): sets the `pre-stop` flag under `CLOUD_HOME.run` (`electron/legacy-names.mjs`), blocking the home's unit
with `ConditionPathExists=!`, arms a 15-minute timer (`omb-home resume-if-cancelled`) that starts the home again if
the flag is older than 5 minutes and the machine is still up (a cancelled stop, or a resume that kept the machine in
memory while the service was down), then stops the home within 40 s or kills it (`TimeoutStopSec=35`). `omb-home start`,
which the service runs after every wake, clears the flag and the timer first.

### Keeping stopped disks

The provider purges a disk 14 days after its stop. A sleeping or ended cloud, and a retired machine, is started briefly
after 11 days (`DUSK_MANAGED_REFRESH_DAYS`, 3 to 13) and stops again. Starts are spaced 10 minutes apart across the
deployment, oldest eligible disk first (the same rules the refresh itself applies: no hold, more than a day before a
scheduled deletion), and a disk whose refresh keeps not happening holds the head for 30 minutes at most: at most 144 a
day, so up to about 430 disks due on the same day still make it within the 3-day margin. A recovery from backup covers
the rest.

### Idle sleep and waking for routines

The home itself reports, through the signed `GET /api/cloud/power` read once a minute while it is up, whether it is
busy (a turn, a run, a call, a computer, maintenance, recent use, work finished under 2 minutes ago, a run due within
5 minutes) and when its next routine or retry is due; the sleep handshake returns the same. Background polls from open
windows are marked and never count as use, so an idle open app does not keep a machine running. The service sleeps a
home only on the home's word and wakes it 5 minutes before its next run (`DUSK_MANAGED_WAKE_LEAD_MINUTES`), the same
window in which the home refuses to sleep.

### Memory guard

On every machine: the home's unit (launcher, edge, server and its engines) runs under `MemoryHigh=80%`,
`MemoryMax=90%`, `OOMScoreAdjust=-500` and `OOMPolicy=continue`; bot computers' containers run under `omb-bots.slice`
(`MemoryMax=75%`, docker's `cgroup-parent`); compressed swap of half the memory (`omb-zram`, best effort). Not done yet:
a separate OOM score for engine processes inside the home and holding new turns when free memory is low; both need
changes in the server's process spawning.

## Updates

A running home takes a new release only when it can't break it (`src/home-update.ts`, `shared/update-guard.ts`): the
release (`DUSK_MANAGED_HOME_RELEASE_FILE`, `{ sha256, signature, url | file }`, read again when it changes, else the
package the service started with) must be signed, newer than what the home runs, at or above the floor and not blocked
in the signed update policy (`DUSK_UPDATE_POLICY_FILE`, signed with `scripts/sign-update-policy.ts`, read again when it
changes, served unchanged at `GET /v1/updates/policy`). It goes in only while no turn, routine run, upload or backup
runs. The home then self-tests (`server/update-state.ts`: health, a page in the bot's browser, one read per connected
Google app; only a check that passed on the version before can fail it). A failed self-test, or the next two runs
failing in a row, rolls it back (`omb-home rollback`), never below the floor; a blocked running version rolls back
the same way. That version is never offered to the home again. The machine refuses an older package or one below the
floor on its own as well. The owner sees one line in the app ("Updated to 1.4.2" / "Update rolled back, nothing lost").
Audit actions: `update_applied`, `update_settled`, `update_rolled_back`, `update_refused`, `update_install_failed`,
`update_stuck` (alerted: a rollback is due and nothing allowed is left to go back to).

## Settings

`DUSK_MANAGED=1`, `BOAT_API_KEY`, `BOAT_BASE_URL`, `DUSK_CLOUD_SEAL_KEY`, `DUSK_ENTITLEMENT_SIGNING_KEY`,
`DUSK_MANAGED_PUBLIC_DOMAIN`, `DUSK_MANAGED_EDGE_TOKEN`, and a package (`DUSK_MANAGED_HOME_PACKAGE_URL` or `_FILE`,
`_SHA256`, `_SIGNATURE`) or a template (`DUSK_MANAGED_TEMPLATE`, `DUSK_MANAGED_TEMPLATE_SIGNATURE`). Optional:
`DUSK_MANAGED_KINDS`, `_SMALLEST`, `_SCOPE`, `_IDLE_MINUTES`, `_LEASE_HOURS`, `_BACKUP_DIR`, `_BACKUP_KEY`,
`_BACKUP_KEY_PREVIOUS`, `_BACKUP_HOURS`, `_BACKUP_KEEP`, `_BACKUP_TAIL_DAYS`, `_BACKUP_MAX_MB`, `_REFRESH_DAYS`,
`_RETENTION_DAYS`, `_DELETE_DELAY_DAYS`, `_LOST_AFTER_MINUTES`, `_WAKE_LEAD_MINUTES`, `DUSK_RELEASE_PUBLIC_KEYS` (staging keys),
`DUSK_OPS_ALERT_EMAIL`, `DUSK_UPDATE_POLICY_FILE`, `DUSK_MANAGED_HOME_RELEASE_FILE`. Every older `DUSK_BOAT_*` name still works; the neutral one wins.

## Tests

`pnpm exec vitest run apps/cloud-service` (fake provider API, no network). `node apps/cloud-service/scripts/e2e.ts --fake`
runs the whole life against the fake. A real run needs `BOAT_API_KEY`, `BOAT_BASE_URL` and the production
`DUSK_ENTITLEMENT_SIGNING_KEY` in the environment (the release home trusts only the pinned key); see `docs/provider.md`.
