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

## Running it

```sh
pnpm build:dashboard            # the page, into dashboard/dist
pnpm dashboard:service          # OMB_DASHBOARD_PORT, _HOST, _DATA, _PUBLIC_URL, _STATIC
```

Production mail uses `OMB_MAIL_PROVIDER=resend`, `OMB_RESEND_API_KEY` and `OMB_MAIL_FROM`. Loopback HTTP or
`OMB_DASHBOARD_DEV=1` enables development console mail. Set `OMB_AUTH_SIGNUP_OPEN=0` to close signups and
`OMB_TRUST_PROXY=1` only behind a trusted proxy. `OMB_AUTH_SECRET` must be at least 32 characters if supplied;
otherwise the service creates a private `auth-secret` file beside its data.

Local work on the page: `pnpm dashboard:fixture` starts the service on `127.0.0.1:7480` with a temporary data folder,
a memory mailer, a signed-in session and a demo workspace (made-up numbers, fixture only). Sign-in codes print in
its terminal. Then `pnpm dev:dashboard` serves the page on `127.0.0.1:5288` with `/v1` proxied to it
(`OMB_DASHBOARD_SERVICE` to point elsewhere).

The page keeps its own English strings: it is a separate web app outside `src/` and its locales.
