# dusk bot link relay (Cloudflare Workers + Durable Objects)

Carries the bytes between a person's own server and their app when neither direct path works, so the link service
on our own box (`apps/link-service`, link.dusk.bot) is no longer the data path. Pairing, setup status and install
stay on the link service.

```
 app (electron main)                       relay.dusk.bot (this worker)                 server (agent.mjs tunnel)
 orderedConnect: ssh, 443, then cloud      one Durable Object per tunnel                createCloudRelay
   wss /v1/t/<id>/app  ---------------->   "app:<sid>"  <-- binary, untouched -->  "vps:<sid>"  <---- wss /v1/t/<id>/vps?s=<sid>
                                           "ctl" {"t":"open","s":<sid>}  ------------------------>  wss /v1/t/<id>/vps (standing)
   the direct path's byte stream (\0OMBD1\n, sealed records, acks): the relay never holds a key
```

- **What rides it.** Exactly the direct path's stream (`apps/link-service/README.md`, "Direct path"): the agent hands
  each relay session to `createDirectHub`, the app treats it as one more direct transport (`via: "cloud"`). Frames
  stay sealed end to end with the tunnel key, the replay guard and the sealed hello are unchanged, and the ack
  window of the direct writer is the flow control. Large files stream over the socket in pieces, so the 100 MB
  request cap of the Free zone never applies.
- **Order.** ssh on 22, then the server's own https on 443, then this relay, then the link service relay underneath
  (`electron/vps-link.mjs` `directFor`). Turning "Fast direct connection" off leaves this relay on: it is a relay.
  An agent without the `cloud-relay` cap, or an app with no dusk account (no link grant), stays on the link service.
- **Auth.** The bearer is `HMAC-SHA256(tunnel key, "dusk-relay-v1|<id>")` (`relayTokenOf` in both clients); the
  relay keeps only its sha256. The app registers a tunnel with `POST /v1/t/<id>/register {grant, verifier}`; the
  link grant (Ed25519, the account service's pinned key, `src/grant.js`) binds the tunnel to that dusk account, and
  another account cannot take it over (409). A wrong token and an unknown tunnel both answer 404.
- **Hibernation and heartbeats.** All sockets are hibernatable. Each client sends the text `ping` every 25 s; the
  runtime answers `pong` without waking the object, and a client drops a socket silent for 75 s. An idle server
  (app closed) costs no duration. Both ends reconnect by themselves (agent: 1 s to 2 min backoff; app: the direct
  link's backoff), which covers deploys dropping sockets. On the cloud path the app's sealed ping is every 20 s.
- **Fair use, per dusk account** (`src/fair-use.js`): 25 Mbit/s with a burst of 8 s of rate, up to 50 GB a month;
  past that the rate halves for every further 50 GB, never below 2 Mbit/s (never cut off). An account's rate is
  shared by its tunnels that moved bytes in the last 10 s. Holding a message back slows the sender through the ack
  window; a tunnel queue past 48 MB closes the sender (4003).
- **Limits.** 8 app sessions per tunnel; an app session its server does not pick up within 15 s is closed (4002);
  register 30 a minute and connect 600 a minute per client address.

## Ops counters

With the `OPS_TOKEN` secret set, `Authorization: Bearer <OPS_TOKEN>`:

- `GET /v1/ops/usage?month=YYYY-MM&limit=100` -> `{ month, totals: { accounts, bytes, slowed }, accounts: [{ acct, bytes, rate, tunnels, slowedAt, updatedAt }] }`
  (`rate` in bytes per second; refreshed at most once a minute per account, and at once when one is first slowed)
- `GET /v1/ops/usage/<acct>` -> `{ month, bytes, tunnels, slowedAt }` (live)
- `GET /v1/ops/tunnel/<id>` -> `{ registered, server, sessions, queued, sent, delayed, rate }` (live)

Without `OPS_TOKEN` these answer 404.

## Run, test, deploy

```
pnpm relay:test                      # unit tests (fair use, forwarding, grants, the two clients agree)
pnpm relay:e2e                       # wrangler dev + the real agent hub and app proxy, a 110 MB transfer, a restart
cd apps/cloudflare/link-relay
set -a && . ~/.config/duskbot/dusk.env && set +a
npx wrangler deploy --env=""         # preview: relay-preview.dusk.bot and workers.dev
npx wrangler deploy --env production # relay.dusk.bot (the address clients dial by default)
```

Load test (`scripts/load.mjs`): needs a grant key the relay trusts (`GRANT_KEYS` var or secret, `kid:x`) and its
private key in a PEM file; `--register-per-minute 29` keeps under the register limit.

## Cost (Workers Paid, prices of 2026-10)

Bandwidth is free; what costs is Durable Object duration ($12.50 per million GB-s, billed at 128 MB) while an object
is awake, and incoming messages (20 per billed request, $0.15 per million). A server whose app is closed costs about
nothing: its standing socket hibernates and the heartbeats do not wake it. An open app session keeps its tunnel's
object awake (sealed pings, the egress hello every 15 s), about $0.0056 an hour.

| per 1,000 users a month, all of them on this relay | connected | relayed | cost |
|---|---|---|---|
| normal | 4 h a day | 5 GB | about $680 |
| heavy | 12 h a day | 100 GB | about $2,100 |
| servers only, app closed | 0 | 0 | about $2 |

Duration is 99% of it. Only links whose ssh and 443 paths both fail ride this relay, so the real bill is that share
of the table. Closing an idle app session (no request for a few minutes, reopened on the next one in about one round
trip) would bring "connected" down to the time actually in use.

## Going live (the flip)

Clients already prefer `https://relay.dusk.bot`. Until it exists it is answered by the `*.dusk.bot` edge route with
404, so agents and apps fall back to the link service at once and try again later (agent: backoff to 2 minutes;
app: that transport goes to the back of the line for 30 minutes on the network).

1. `npx wrangler deploy --env production` (custom domain `relay.dusk.bot` plus a route that beats the wildcard).
2. Optional: `npx wrangler secret put OPS_TOKEN --env production` for the ops counters.
3. Ship the agent (2.1.0, served as `/agent.mjs` by the link service) and an app build with the cloud transport.

Undo: `npx wrangler delete --env production` (or remove the custom domain); every client falls back to the link
service relay on its own. `DUSK_RELAY_URL=off` (agent unit or app environment) keeps one install off it;
`DUSK_RELAY_URL=https://relay-preview.dusk.bot` points one at the preview.
