# My Cloud on Boat

The account service (`apps/dashboard/server`) can run each paid My Cloud on its own [Boat](https://boat.dev) sandbox. The
sandbox runs the same My Cloud home as every Cloud plan (`server/cloud-home-start.ts`, `apps/cloud-service/deploy/Caddyfile`),
installed natively under systemd. Everything else a person sees is the existing My Cloud: pairing, wake, the one-time
move and move back. Your own VPS ("Add your VPS", `apps/link-service/install.sh`) is unchanged.

## Lifecycle

The code is `apps/cloud-service/src/lifecycle.ts`.

- **Provision** when the plan is paid:
  - one `small`-or-larger sandbox per cloud, labelled `omb.cloud` and `omb.scope`;
  - created `noEnv`, with no Boat credentials on it;
  - its public URL is Boat's stable hosted URL for port 8080.
- **Sleep.** After 15 minutes without use the dashboard reads the home's power and asks for the sleep handshake
  (`server/cloud-power.ts`), then stops the sandbox. Boat's pre-stop hook stops the home first, so its databases close
  cleanly.
- **Wake** for:
  - the app (`/api/cloud/desktop/wake`);
  - the dashboard's power button;
  - the Slack edge;
  - a routine due within 2 minutes.

  A Boat start does not run the home's start by itself, so the reconciler always runs `omb-home start` after a resume.
- **Back up** `/data` from Boat's newest snapshot, encrypted, into `DUSK_MANAGED_BACKUP_DIR` (`boat-backups.ts`). The home
  never holds a credential for that storage.
- **Recover** a lost or expired machine: a fresh sandbox, then the newest verified backup restored into it.
- **Retain.** When a plan ends, its cloud is stopped, kept for 45 days and the owner is notified at the end, then 30, 7
  and 1 days before deletion. It is deleted only through `deletionVerdict` (`boat-retention.ts`), which reads the
  billing store, never a request.

Every action is one line in `boat-audit.jsonl`. A deletion also alerts `DUSK_OPS_ALERT_EMAIL`.

## Configuration (account service)

- **Required:**
  - `DUSK_MANAGED=1`.
  - `BOAT_API_KEY` and `BOAT_BASE_URL`.
  - `DUSK_CLOUD_SEAL_KEY`.
  - `DUSK_MANAGED_HOME_PACKAGE_SHA256`, plus either `DUSK_MANAGED_HOME_PACKAGE_FILE` or an https `DUSK_MANAGED_HOME_PACKAGE_URL`.
    Build the package with `node apps/cloud-service/scripts/build-home-package.mjs`, or set `DUSK_MANAGED_TEMPLATE` to a saved Boat
    snapshot that already has it installed.
- **Optional:** `DUSK_MANAGED_BACKUP_KEY` (43 base64url characters; otherwise derived from `DUSK_CLOUD_SEAL_KEY`). Its fingerprint is kept in the data folder, and a different key refuses to start unless the old one is set as `DUSK_MANAGED_BACKUP_KEY_PREVIOUS`, which seals every backup again first. Also `DUSK_MANAGED_KINDS`, `DUSK_MANAGED_IDLE_MINUTES`, `DUSK_MANAGED_RETENTION_DAYS`, `DUSK_MANAGED_DELETE_DELAY_DAYS`,
  `DUSK_MANAGED_BACKUP_DIR`, `DUSK_MANAGED_BACKUP_HOURS`, `DUSK_MANAGED_BACKUP_KEEP`, `DUSK_MANAGED_BACKUP_TAIL_DAYS`,
  `DUSK_MANAGED_REFRESH_DAYS`, `DUSK_MANAGED_LEASE_HOURS`, `DUSK_MANAGED_SMALLEST`, `DUSK_MANAGED_SCOPE`.
- **Minimums:** `DUSK_MANAGED_RETENTION_DAYS` is at least 45 and `DUSK_MANAGED_DELETE_DELAY_DAYS` at least 7; shorter values
  stop the service at startup.

## Deleting a cloud's data on request

Only the owner can delete a cloud's data early.

1. They call `POST /v1/clouds/:id/delete-data`. This needs the cookie session with its CSRF header, a sign-in from the
   last 10 minutes, and no active plan.
2. That emails a one-time link. Confirming it (`POST .../delete-data/confirm {token}`) schedules deletion 7 days out.
3. Until then, `POST .../delete-data/cancel` undoes it.

No route deletes anything directly. The reconciler acts after the delay, through the same verdict as every other
deletion.

## End-to-end check

`apps/cloud-service/scripts/e2e.ts` runs the whole life once. With `--fake` it runs against a loopback fake of the Boat API.
With `BOAT_API_KEY`/`BOAT_BASE_URL` set, it runs on real Boat with at most two `small` sandboxes under a scope label of
its own, and deletes them all at the end.
