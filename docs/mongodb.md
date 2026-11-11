# Dusk's MongoDB

New server-side Dusk data goes to Dusk's own MongoDB, reached through
`MONGODB_URI` (database `MONGODB_DB`, normally `dusk`). Do not add new JSON
state files for operator data; add a collection instead.

- Where: the Contabo VPS (169.58.211.160), a dedicated `mongod-dusk` systemd
  service on `127.0.0.1:29018` (loopback only, auth on). It is separate from
  make.design's mongod on 29017; never point Dusk at that one.
- App user: `dusk`, `readWrite` on `dusk` only, `authSource=admin`. Apps on
  the VPS use the URI as is. From a Mac, open a tunnel first:
  `ssh -N -L 29018:127.0.0.1:29018 root@169.58.211.160` (add `-J oracle`
  when the direct route is blocked) and use the same URI.
- Backups: daily `mongodump` at 03:17 server time, 7 days kept, in
  `/root/backups/mongo-dusk/` on the VPS.
- Values: the operator's `.env` (repo root, git-ignored) and
  `~/.config/duskbot/`. Never commit them.

The ops runbook (users, restore, rotation) is `omb-ref/DUSK-MONGO.md` on the
operator's Mac.

## What uses it

| Data | Store today | Status |
| --- | --- | --- |
| dusk.bot waitlist | `dusk.waitlist` + `dusk.counters` (deployd `sites/dusk`) | live |
| accounts, identities, sessions | `auth.json` in `DUSK_DASHBOARD_DATA` | candidate |
| dashboard workspaces | `state.json` | candidate |
| billing (customers, checkouts, subscriptions, webhooks) | `billing.json` | candidate |
| managed clouds (incl. cloud-service lifecycle records) | `clouds.json` | candidate |
| published pages registry | `pages.json` | candidate |
| slack edge registrations and events | `slack-edge.json` | candidate |
| composio broker installs, triggers, events | Cloudflare D1 `duskbot-composio` | stays (runs on Workers, cannot reach a loopback DB) |
| link-service sessions and tunnels | `link-service/src/store.mjs` JSON | stays for now (ephemeral) |
| companion, self-hosted bot | local files on the user's machine | stays (user-side data) |

Migrating a candidate means turning synchronous in-memory reads
(`state.x.find(...)`) into async queries across its call sites; see the
estimates in the runbook before starting one.
