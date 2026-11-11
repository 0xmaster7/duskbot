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

## The account service

The account service (`apps/dashboard/server`, with the managed cloud) keeps all of its state here: it refuses to
start outside local development without `MONGODB_URI`. Each module still holds its state in memory and says when it
changed; `persistence/` writes the rows that changed as one document each, in one transaction per flush, and a
response leaves only once what its request changed is written (a failed write drops the connection rather than
claim a success). Tests and local fixtures keep JSON files in the data folder.

- Needs a replica set for transactions: `mongod-dusk` runs as the one-node set `rs-dusk` (key file
  `/etc/mongod-dusk-rs/keyfile`). Add `&replicaSet=rs-dusk` to the URI.
- One writer: the process holds the `locks` document `account-service` (30 s lease, renewed every 10 s, checked inside
  every transaction). A second process waits up to 75 s for it, then refuses to start; a process that loses it exits.
- `/v1/health` answers 503 while writes fail.

| Collection | What | Key | Indexes |
| --- | --- | --- | --- |
| `accounts` | accounts | `id` | `email` unique |
| `identities` | Google, Apple, X sign-ins | `provider:subject` | `accountId` |
| `sessions` | web and app sessions (token hashes only) | `id` | `tokenHash` unique, `accountId`, `expiresAt` |
| `workspaces`, `workspace_accounts` | linked workspaces and their latest report | `id` | `ownerAccountId`, `publicKey` |
| `billing_*` | customers, checkouts, subscriptions, licenses, invoices, credits, webhook events, feedback, closures, refunds, provider cancels | `id` (customers: `accountId`) | `accountId`; `providerPaymentId` unique; `(reason, ref)` unique; `providerSubscriptionId` unique when set |
| `clouds` | Dusk Cloud records with the managed lifecycle | `id` | `accountId`, `status` |
| `pages`, `slack_edge_regs`, `slack_edge_events` | published pages, Slack wake edge | `id` / `cloudId` | |
| `stores` | each module's small fields (queues, counters, provider start ledger, sweep) | module name | |
| `managed_audit` | append-only lifecycle audit, ids and codes only | | `(cloudId, at)`, `at` |
| `locks` | the writer lease | | |

Every row carries `_n`, its insertion number, so arrays load back in order. Sessions expire in the service itself
(`expiresAt` is a number, not a TTL date).

Import a data folder of JSON files once: `node apps/dashboard/scripts/import-json-state.ts <data folder>` with
`MONGODB_URI` and `MONGODB_DB` set (refuses a database that already holds account state).

## What else uses it

| Data | Store | Status |
| --- | --- | --- |
| dusk.bot waitlist | `dusk.waitlist` + `dusk.counters` (deployd `sites/dusk`) | live |
| composio broker installs, triggers, events | Cloudflare D1 `duskbot-composio` | stays (runs on Workers, cannot reach a loopback DB) |
| link-service sessions and tunnels | `link-service/src/store.mjs` JSON | stays for now (ephemeral) |
| companion, self-hosted bot | local files on the user's machine | stays (user-side data) |
| sealed cloud backups, secrets files, error spool | files under `DUSK_DASHBOARD_DATA` | blobs and keys stay on disk |
