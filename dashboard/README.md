# OpenMausBot account dashboard

One hosted web app for everyone's OpenMausBot workspaces. A person signs in with their OpenMausBot account and sees
each of their workspaces (their Mac, each VPS) side by side: bots, usage, the machine and its bot computers, devices.

```
 workspace (an OpenMausBot server)            dashboard service (dashboard/server)          browser (dashboard/src)
 ---------------------------------            ------------------------------------          -----------------------
 POST /api/dashboard/link  (app menu)  ---->  POST /v1/enroll {ed25519 public key}
   opens the claim link in the browser        <---- {workspaceId, claimUrl}
                                                                                            /claim#token, signed in
                                              POST /v1/claim  <---------------------------  "Connect"
 every 5 s while watched, 3 min otherwise:
 POST /v1/report (signed)  ----------------->  keeps the newest of each section  --------->  GET /v1/workspaces/:id
 GET  /v1/wait   (signed, long poll)  <-----  commands, "someone is watching"  <---------  POST .../commands
 runs the command on its own routes,
 sends the result in the next report  ---->   command done / failed  ------------------->  toast + new state
```

- **Protocol.** `shared/dashboard-protocol.ts`, version 1: the report sections, the commands, the signature
  (`ed25519` over method, path, time and the body's sha256), timings and the discovery path. Reports carry counts and
  states only: machine stats, bot names, colours and models, computer states, device names, daily usage totals. Never
  messages, prompts, files or secrets.
- **Transport.** Plain HTTPS from the workspace to the service, so it does not depend on any relay. A relay can name
  its dashboard at `/.well-known/openmausbot/dashboard` (`OMB_LINK_DASHBOARD_URL` on the link service); a workspace
  uses, in order, the URL it is given, `OMB_DASHBOARD_URL`, its relay's discovery answer, then `DEFAULT_DASHBOARD_URL`.
- **Accounts.** The service owns email-code sign-in, accounts and browser/app sessions (`shared/account-api.ts`).
  Accounts and token hashes live in `auth.json`; codes and one-time grants stay in memory. Browser mutations echo
  the `omb_csrf` cookie in `x-omb-csrf`. Apps use the existing Admin contract v1 bearer routes. Social providers are
  unavailable for now, with coming-soon buttons only in development.
- **Workspaces.** The server makes its key on first link (`dashboard-link.json` in its data folder, mode 0600). The
  claim link is one-time and lasts 30 minutes; an unclaimed workspace is dropped after a day. Removing a workspace in
  Settings stops its key working.
- **Commands.** Wake or sleep a bot computer, revoke a phone or a signed-in session, pause or resume a routine. The
  workspace runs each one through its own existing routes and confirms it; one not picked up in 10 minutes expires.

## Slack while a cloud desktop sleeps

Opt-in per desktop ("Wake for Slack" on its Cloud desktop page) and off unless the service runs with
`OMB_SLACK_EDGE=1` (which then needs `OMB_CLOUD_SEAL_KEY` outside loopback development). It is the one exception to
"Slack traffic stays between the harness and Slack": a bot's Socket Mode connection needs its app-level token, so a
desktop that wants to answer while asleep lends that token to this service.

```
 cloud desktop (repo server/slack/handover.ts)     this service (server/slack-edge)                Slack
 every 60 s and at boot: signed POST /v1/slack-edge/sync
   {x25519 public key, bots: id + token hash, acks}  ---->  remembers the key, asks for changed tokens
 POST /v1/slack-edge/tokens {xapp tokens}  -------------->  seals them at rest (OMB_CLOUD_SEAL_KEY)
                                                          desktop stopped or asleep: opens Socket Mode  <---->  events
                                                          acks each event at once, seals it to the desktop's key,
                                                          DM or mention: wakes the desktop (again each minute)
 boots, syncs  <------------------------------------------  sealed events; closes its own connection
 opens them, feeds the bridge (it drops repeats), acks  ->  deletes them
```

What the service can see, and why:

- **The app-level token** (`xapp-`) of each bot, sealed at rest, in memory while it holds the connection. Socket Mode
  needs it. It only opens Socket Mode connections: it cannot read history, post or act as the bot. The bot token
  (`xoxb-`), the signing secret and the config token never leave the desktop.
- **Each event, in memory, while it is held.** Slack sends events in the clear over Socket Mode's TLS, so the process
  holds each one for the moment it takes to read its type fields (`type`, `channel_type`, `subtype`, `bot_id`,
  `user` against the bot's id, `event_id`) and seal the whole payload to the desktop's x25519 key (HKDF, AES-256-GCM,
  bound to the bot). The text is never read, logged or written; channel chatter that does not address the bot is
  dropped unsealed and unstored.
- **At rest** (`slack-edge.json`): sealed events (at most 64 or 256 KB per desktop, 24 hours), their event ids and
  times, bot ids, Slack app and bot user ids, token hashes, the desktop's public key, and wake timings. Only the
  desktop's private key (`slack-edge-key.json` on the desktop, mode 0600) opens an event.
- A compromised service process could read events while it holds a connection. That is why it is opt-in, only while
  the desktop sleeps, and released as soon as the desktop syncs after waking.

Wake timings (wake request to the desktop's first sync) feed the catalog's `wake` stat per desktop kind once 10 or
more were measured; the plan cards print a wake time only from it.

## Running it

```sh
pnpm build:dashboard            # the page, into dashboard/dist
pnpm dashboard:service          # OMB_DASHBOARD_PORT, _HOST, _DATA, _PUBLIC_URL, _STATIC
```

Production mail uses `OMB_MAIL_PROVIDER=resend`, `OMB_RESEND_API_KEY` and `OMB_MAIL_FROM`. Loopback HTTP or
`OMB_DASHBOARD_DEV=1` enables development console mail. Set `OMB_AUTH_SIGNUP_OPEN=0` to close signups and
`OMB_TRUST_PROXY=1` only behind a trusted proxy. `OMB_OPS_TOKEN` (32 characters or more) turns on the operator's checkout funnel:
`GET /v1/billing/ops/funnel?days=30` with `Authorization: Bearer <token>` counts checkouts started, paid and still active
by where they started (`CHECKOUT_SOURCES` in `shared/billing-api.ts`); without the token the route does not exist. `OMB_AUTH_SECRET` must be at least 32 characters if supplied;
otherwise the service creates a private `auth-secret` file beside its data.

Local work on the page: `pnpm dashboard:fixture` starts the service on `127.0.0.1:7480` with a temporary data folder,
a memory mailer, a signed-in session and a demo workspace (made-up numbers, fixture only). Sign-in codes print in
its terminal. Then `pnpm dev:dashboard` serves the page on `127.0.0.1:5288` with `/v1` proxied to it
(`OMB_DASHBOARD_SERVICE` to point elsewhere).

The page keeps its own English strings: it is a separate web app outside `src/` and its locales.

### Sign-in providers

Google uses `OMB_AUTH_GOOGLE_CLIENT_ID` and `OMB_AUTH_GOOGLE_CLIENT_SECRET`. Apple uses `OMB_AUTH_APPLE_CLIENT_ID` (Services ID), `OMB_AUTH_APPLE_TEAM_ID`, `OMB_AUTH_APPLE_KEY_ID`, and the .p8 key in `OMB_AUTH_APPLE_PRIVATE_KEY` (PEM, literal `\n` accepted) or `OMB_AUTH_APPLE_PRIVATE_KEY_FILE`. X uses `OMB_AUTH_X_CLIENT_ID`, optional `OMB_AUTH_X_CLIENT_SECRET`, and optional `OMB_AUTH_X_SCOPES` (default `users.read tweet.read`). Register `<public url>/v1/auth/oauth/google/callback`, `<public url>/v1/auth/oauth/apple/callback` (Apple's Return URL), and `<public url>/v1/auth/oauth/x/callback`. Partial provider configuration fails startup; endpoint overrides are available only through code options for isolated fixtures. The dashboard fixture runs local fake Google, Apple and X providers without external accounts.

## Type

Geist Sans everywhere, Geist Mono for ids. No serif and no pixel face anywhere in the dashboard.

| role | family | size / line | where |
|---|---|---|---|
| page title (`.t-title`) | Geist Sans 600, -0.022em | 28/34, 24/30 under 640px | the `h1` of every page, the sign-in and welcome steps |
| plan price | Geist Sans 600 | 34 on cards, 24 in sheets | Plans & billing cards and plan sheet totals |
| figure (`.t-figure`, `ui/Figure.tsx`) | Geist Sans 600, tabular | 26/32 | big numbers on stat cards and the activity total |
| id (`.t-id`) | Geist Mono | 13 | ids and versions; table counts stay in sans, tabular |
| heading | Geist Sans 500 | 15/22 | section titles |
| body | Geist Sans 400 | 14/20, 13/18 secondary | everything else; never under 12px |

## Motion

Hovers are instant colour changes. Movement is kept for page and section entrances (`.enter`), menus, sheets,
dialogs, toasts, figures that change, content switches (`.swap-in`, a soft blur, never a slide) and a chart's first
draw. Tokens live in `app.css` (Bencho: 160/220/420/600 ms, `--ease-out`). Mascots draw at 30 fps, stop off screen
and rest under reduced motion.
