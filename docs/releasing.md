# Releasing

For a normal release, run **Actions → Prepare next release → Run workflow** and
choose a patch, minor, or custom version. It opens a tiny version-bump PR;
merging that PR automatically starts **Release** and assembles a draft from the
exact merge commit. Review and publish the draft when it is ready.

The existing **Actions → Release → Run workflow** button remains available for
reruns and recovery. It
builds macOS (arm64 + x64, signed, notarized, stapled), Windows, and Ubuntu
from a single pinned commit, verifies every artifact the way a user would
receive it, and assembles the canonical draft in
[Dusk Bot releases](https://github.com/goatedgrokbotalternative/duskbot/releases).
Tick **publish** to publish the release immediately, or leave it unticked to
review the draft first.

The release commit must have passed CI on every platform: the **CI passed on
the release commit** job waits (while the platforms build) for a ci.yml run
whose `CI` check passed with every Linux, Windows and macOS shard, on the
pinned commit or a commit with the same tree, and stops the release before any
draft if the commit's CI failed. A push to main runs the Linux shards only, so
unless the release branch's own CI (started by **Prepare next release**) or a
nightly run covered the same tree, the job runs the full CI on the commit
itself on a temporary `release-ci/v<version>` branch, which takes about as
long as the platform builds. After a flaky failure, re-run the failed CI jobs;
a release still waiting picks up the new attempt, and a release that already
stopped needs only `gh run rerun <id> --failed`. `ship_without_ci` skips the
wait, for emergencies only. See [CI job selection](ci.md#main-and-releases).

The workflow refuses to overwrite an already-published version. Manual Release
runs still require `package.json`'s version to be bumped on the selected ref.
A release is rejected if any installer, stable download
name, size, or digest is absent or inconsistent.

GitHub generates the release body (the changelog) from pull requests since the previous tag. Write PR titles for
people: they become the release notes on the downloads repo.

## Putting a release on dusk.bot

The private repo's release is the canonical record; people download from the public downloads repo and dusk.bot.
After publishing, run on the Mac:

```sh
scripts/publish-downloads.sh v0.1.142            # DRY_RUN=1 first to only verify
```

It downloads the release, checks every installer against the run's signed `SHA256SUMS`, uploads the installers to
the public `goatedgrokbotalternative/duskbot-releases` release (stable `/releases/latest/download/` names that
dusk.bot/download links to), then puts `latest.json` and `SHA256SUMS` on dusk.bot through the deployd landing site.
Desktop apps read `https://dusk.bot/releases/latest.json` once a day, accept it only when a pinned release key
signed it (server/update-check.ts), and show a notification that opens dusk.bot/download. Nothing installs itself.

## Why the gates exist

Each verification step in `release.yml` maps to a real incident from the
hand-cut releases (0.1.15–0.1.25): stale build output breaking the code
signature, a bare import killing the packaged server on launch while every
check stayed green, helper paths resolving outside the app after bundling,
stapling silently invalidating every published hash, and a finished release
sitting invisible as a draft. Don't remove a gate without reading the comment
above it.

## Bundled browser gates

Desktop builds also stage a pinned engine and Chromium Headless Shell before
packaging. Pre-signing checks validate complete resources and upstream hashes;
native browser smoke tests and macOS signature checks run on the packaged
output. See [browser packaging](browser-packaging.md) for update ownership,
license provenance and Linux sandbox constraints. Missing browser resources
must fail the build, not ship an installer that downloads them on first use.

## One-time setup: release secrets

Set these in **Dusk Bot → Settings → Secrets and variables → Actions**.

The **Prepare next release** workflow also needs
**Settings → Actions → General → Workflow permissions → Allow GitHub Actions
to create and approve pull requests** enabled. The workflow only creates the
version PR; it never approves or merges it.

### 1. `MAC_CERT_P12_BASE64` + `MAC_CERT_PASSWORD`

The Developer ID Application certificate, exported from the Mac that
currently signs releases:

```sh
# Keychain Access → My Certificates → "Developer ID Application: Milind Soni
# (993D98NH4J)" → right-click → Export… → .p12 with a strong password, then:
base64 -i DeveloperID.p12 | pbcopy   # → MAC_CERT_P12_BASE64
# the export password             → MAC_CERT_PASSWORD
```

### 2. `APPLE_API_KEY_P8_BASE64` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER_ID`

An App Store Connect API key for notarization (better than an app-specific
password for CI — revocable, scoped, no 2FA dance):

1. [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
2. Generate a **Team Key** with the **Developer** role
3. Download the `.p8` (one chance only), note the Key ID and Issuer ID

```sh
base64 -i AuthKey_XXXXXXXX.p8 | pbcopy   # → APPLE_API_KEY_P8_BASE64
```

### 3. `DUSK_RELEASE_SIGNING_KEY`

The Ed25519 release key (`kid:<pkcs8 base64url>`) whose public half is pinned in
`apps/cloud-service/src/release-signing.ts` and `server/update-check.ts` (a test keeps them equal). The assemble job
signs `latest.json` with it; without it the release still builds but apps never hear about it. A new key:
`node apps/cloud-service/scripts/keygen.mjs rel-2027-01 ~/.config/duskbot/keys`, pin the printed public key in both
files, ship an app with it, and only then switch the secret.

### Local fallback

The hand-cut path still works when Actions is down or a release needs
surgery: `pnpm package:mac`, gate with `codesign --verify --deep --strict`,
notarize with the local keychain profile (`xcrun notarytool submit …
--keychain-profile AC_PASSWORD`), staple, re-zip, upload the complete asset set to the release, and verify the
published bytes by downloading them back.
