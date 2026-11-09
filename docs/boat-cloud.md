# My Cloud on Boat

The account service (`apps/dashboard/server`) can run each paid My Cloud on its own [Boat](https://boat.dev) sandbox. The
sandbox runs the same My Cloud home as every Cloud plan (`server/cloud-home-start.ts`, `deploy/boat/Caddyfile`),
installed natively under systemd. Everything else a person sees is the existing My Cloud: pairing, wake, the one-time
move and move back. Your own VPS ("Add your VPS", `apps/link-service/install.sh`) is unchanged.

## Lifecycle

The code is `apps/dashboard/server/clouds/boat-lifecycle.ts`.

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
- **Back up** `/data` from Boat's newest snapshot, encrypted, into `OMB_BOAT_BACKUP_DIR` (`boat-backups.ts`). The home
  never holds a credential for that storage.
- **Recover** a lost or expired machine: a fresh sandbox, then the newest verified backup restored into it.
- **Retain.** When a plan ends, its cloud is stopped, kept for 45 days and the owner is notified at the end, then 30, 7
  and 1 days before deletion. It is deleted only through `deletionVerdict` (`boat-retention.ts`), which reads the
  billing store, never a request.

Every action is one line in `boat-audit.jsonl`. A deletion also alerts `OMB_OPS_ALERT_EMAIL`.

## Configuration (account service)

- **Required:**
  - `OMB_BOAT=1`.
  - `BOAT_API_KEY` and `BOAT_BASE_URL`.
  - `OMB_CLOUD_SEAL_KEY`.
  - `OMB_BOAT_HOME_PACKAGE_SHA256`, plus either `OMB_BOAT_HOME_PACKAGE_FILE` or an https `OMB_BOAT_HOME_PACKAGE_URL`.
    Build the package with `node scripts/build-boat-home-package.mjs`, or set `OMB_BOAT_TEMPLATE` to a saved Boat
    snapshot that already has it installed.
- **Optional:** `OMB_BOAT_KINDS`, `OMB_BOAT_IDLE_MINUTES`, `OMB_BOAT_RETENTION_DAYS`, `OMB_BOAT_DELETE_DELAY_DAYS`,
  `OMB_BOAT_BACKUP_DIR`, `OMB_BOAT_BACKUP_HOURS`, `OMB_BOAT_BACKUP_KEEP`, `OMB_BOAT_BACKUP_TAIL_DAYS`,
  `OMB_BOAT_REFRESH_DAYS`, `OMB_BOAT_LEASE_HOURS`, `OMB_BOAT_SMALLEST`, `OMB_BOAT_SCOPE`.
- **Minimums:** `OMB_BOAT_RETENTION_DAYS` is at least 45 and `OMB_BOAT_DELETE_DELAY_DAYS` at least 7; shorter values
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

`scripts/testing/boat-e2e.ts` runs the whole life once. With `--fake` it runs against a loopback fake of the Boat API.
With `BOAT_API_KEY`/`BOAT_BASE_URL` set, it runs on real Boat with at most two `small` sandboxes under a scope label of
its own, and deletes them all at the end.
