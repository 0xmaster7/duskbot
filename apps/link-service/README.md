# Dusk Bot link service

Links a person's VPS to their Dusk Bot app with one pasted line. It's a small Node app with no dependencies and
nothing tied to dusk.bot or Cloudflare.

```
curl -fsSL https://link.dusk.bot/i/<code> | sh
```

## Phone push

`POST /v1/push` sends one push for a workspace that holds no APNs or FCM keys of its own; `GET /v1/push` lists the
services this relay has keys for. It sees the device token, the bot's name and ids, never message text, and keeps
nothing. Set `DUSK_APNS_KEY_FILE`, `DUSK_APNS_KEY_ID`, `DUSK_APNS_TEAM_ID`, `DUSK_APNS_TOPIC` and
`DUSK_FCM_SERVICE_ACCOUNT_FILE` on the service; see `docs/phone-push.md`.

## Slack OAuth return

`GET /slack/callback` validates Slack's code or error and state, then returns a small page that opens
`duskbot://slack/oauth` with a copyable fallback. The route is stateless: it never calls Slack, stores nothing,
and never logs the query. The app completes the exchange with its own harness, so the harness needs no public URL.

## How it fits together

```
 app (electron main)                link service (this folder)                 vps
 -------------------                --------------------------                 ---
 1 POST /v1/sessions  ----------->  session {verifier, appPub}
   shows the one line
                                    GET /i/<code>  <---------------------  person pastes the line
                                    POST claim, events  <----------------  install.sh: each step, log tail on failure
 2 long-poll events  <------------  steps as they arrive
                                    POST probe  <------------------------  agent.mjs probe: can we reach :80?
                                    POST result {sealed, vpsPub}  <------  agent.mjs link: pairing code, tunnel keys,
 3 opens the sealed result                                                  sealed for the app (x25519 + aes-gcm)
   (only the app can)
 4 local proxy http://vps-<id>.localhost:<port>
      |  sealed frames  ------->    /v1/tunnels/<id>/to-vps  ----------->  agent.mjs tunnel (duskbot-link.service)
      |  sealed frames  <-------    /v1/tunnels/<id>/to-app  <-----------    -> http://127.0.0.1:8799 (marked remote)
   pairs, saves the server, signs the AI in from this Mac, moves everything
```

- **Relay mode** (the default, and what Oracle Cloud gets because only port 22 is open; see "Direct path" for how such a
  server is still reached directly): every request and reply goes
  through the link service as AES-256-GCM frames, sealed with a key only the app and the VPS hold. The service just
  queues opaque blobs. Every frame carries a timestamp and is refused if it's stale or seen twice.
- **Direct mode**, used only when the service can reach the VPS on port 80: Caddy gets a certificate for
  `<ip-with-dashes>.sslip.io`. The app talks HTTPS straight to it and pins the certificate's public key, which Caddy keeps
  across renewals (`reuse_private_keys`). The tunnel still runs as a private control channel.

## Direct path

A relay-linked server also gets a direct path, picked automatically and kept up in the background, with the relay as
the fallback. Nothing is opened on the server and the person configures nothing: it rides the server's own sshd on port
22, which every VPS already answers (Oracle Cloud included). Where the person's network blocks port 22 (Jio, often),
the same byte stream rides a WebSocket to the server's own HTTPS on 443 instead. The app tries ssh, then 443, then
stays on the relay; a transport that failed on a network is tried last there for 30 minutes.

```
 app (electron main)                                         vps
 vps-link-direct.mjs  -- ssh, tcp 22, host key pinned -->    sshd -> forced command: node agent.mjs direct (as omb-link)
                                                                -> unix socket ~/.config/duskbot-link/direct.sock
                      -- wss, tcp 443, tls key pinned -->    https front (caddy, nginx) /omb-direct -> 127.0.0.1:8797
   same sealed frames as the relay, length-prefixed          both end in the tunnel process: http://127.0.0.1:8799 (marked remote)
```

- **443.** The tunnel process listens on `127.0.0.1:8797` (`DUSK_LINK_WSS_PORT`) for a WebSocket at `/omb-direct`; its
  binary messages carry exactly the ssh channel's byte stream. A direct-mode install's Caddy passes `/omb-direct` to it.
  On a relay-mode server whose operator runs their own HTTPS (nginx with a real certificate), add a location for
  `/omb-direct` that proxies WebSocket upgrades to `127.0.0.1:8797` and set `DUSK_LINK_WSS_URL=wss://<host>/omb-direct` in
  the link unit's environment. The app asks for the address with the sealed control op `direct-wss`; the agent answers
  the URL and the SHA-256 of its certificate's public key (read from the server itself), which the app pins on top of
  the usual certificate checks. A changed key (a renewal that made a new key) asks again over the sealed tunnel, at most
  once an hour. A server with no address says so, and is asked again an hour later.
- **Egress.** Egress streams ride the direct connection the app said hello on last, in the writer's lane (its own
  256 KB of unacknowledged bytes, served first each round), and the relay otherwise, where they have their own queue,
  unnumbered posts marked `lane`, and room of their own in the link service, which reads them out first.

- **Setup.** Once a link's tunnel is up, the app makes its own ed25519 key and sends the public half as the sealed
  control op `direct-key`. The agent adds one line to `~maus/.ssh/authorized_keys`:
  `restrict,command="<node> <agent.mjs> direct" ssh-ed25519 AAAA... omb-link-<tunnel id>` (no shell, pty, agent, X11 or
  port/socket forwarding, so the docker socket the server account can reach stays out of reach) and answers with sshd's public host
  keys, its public IPv4 (from a STUN server, outbound UDP) and the user name. The private key is kept with safeStorage
  in the link record (`links[].direct`); host keys are pinned there. `direct-off` and unlinking remove the line; the
  tunnel agent re-points the line at its own node path on start. An older agent answers "unknown request" and is asked
  again after 6 hours. `DUSK_LINK_DIRECT=off` (agent's environment, or the app's) keeps everything on the relay;
  `DUSK_LINK_DIRECT_HOST` / `DUSK_LINK_DIRECT_PORT` override the address the agent reports.
- **Sealing and identity.** The channel carries exactly the relay's frames (AES-256-GCM with the tunnel key, AAD
  `<id>|to-vps` / `<id>|to-app`, timestamps, one replay guard across every path on each end: the tunnel process serves
  the relay and every direct connection) as `[u32 length][type][iv|ct|tag]`
  records after a `\0OMBD1\n` magic. The agent says a sealed hello first; the app uses the path only after opening it,
  so a server without the tunnel key is never used. sshd's host key must be one the agent sent inside the sealed
  tunnel, so neither the network nor the relay can stand in. An auth or host-key failure asks for a new key over the
  sealed tunnel, at most once an hour.
- **Choosing a path.** A request takes the direct path when it is up and keeps its path. When the direct path drops,
  an unanswered GET or HEAD goes again over the relay and the rest fail (a POST is never sent twice). Event streams
  still on the relay 3 s after the direct path came up are ended so they reconnect over it; a desktop websocket opened
  while the direct path is dialling waits up to 4 s for it. Pings every 5 s measure the round trip; only silence
  (nothing received at all) drops the path. A wake or an unlocked screen resets the relay's sockets and restarts its
  read at once, and new requests take the relay until a quick ping proves the direct connection still alive.
- **Fairness.** Control frames (requests, heads, ends, control) go first. Stream bytes take turns in 16 KB pieces, a
  stream's own frames never overtake its bytes, and unacknowledged stream bytes are capped near what the path delivers
  in its round trip plus 250 ms (384 KB to 8 MB, from the acks), so a download or a busy desktop delays an API reply by
  about that much at most. What is ready goes out as one write a turn later: sshd sets no `TCP_NODELAY` for a channel
  without a pty, so separate small writes waited for delayed acks.
- **Why not WebRTC.** Measured on the reference setup (2026-11-07): the Mac behind its VPN maps each destination to a
  new public port (symmetric NAT), and the VPS drops unsolicited UDP (OCI security list and host firewall), so STUN
  hole punching delivered nothing in 25 s either way. TCP 22 is open on every VPS. A WebRTC tier could be added beside
  this one for networks where punching works; it would not help behind such VPNs.
- **When it cannot work.** sshd set to refuse the link account (`AllowUsers`, `AllowGroups`, `DenyUsers`), sshd off
  port 22 without `DUSK_LINK_DIRECT_PORT`, or outbound port 22 blocked on the person's network, and no HTTPS address for
  443: the app logs it and stays on the relay.

## Versions and updates

- **Handshake.** The agent says what it speaks (`LINK_PROTOCOL`, the oldest app and server it works with, `AGENT_VERSION`
  and its capabilities) in its direct hello and in answer to the sealed control op `hello`, which also carries the
  server's version and link protocol (`server/link-protocol.ts`, the `link` field of
  `/.well-known/duskbot/environment`). Protocol numbers decide, never versions; an optional feature is a capability
  the app checks for. The app's view gets `compat: { update: null | "app" | "agent" | "server", message, ... }`. An
  agent from before the handshake answers "unknown request" and works as protocol 1.
- **Self-update.** Every 6 hours (5 minutes after start first) the tunnel reads `GET /v1/release` (the version, protocol
  and sha256 of the agent this service serves, and `agent.mjs.sig` when there is one) and stages a newer release in
  `~/.config/duskbot-link/releases/<version>/` only when the file matches its hash and its own version line, a
  signature checks out when release keys are pinned (`RELEASE_KEYS` in agent.mjs or `DUSK_LINK_RELEASE_KEYS`; sign with
  `node release.mjs sign <key>`), and `agent.mjs selftest` runs; `ready.json` is written last. It never takes an older
  version or a lower protocol. It applies only after 5 minutes without a request, a stream byte or an egress stream
  from the app (or at once for the `update` op with `apply: "now"`), by ending the tunnel so systemd starts it again.
  The installed `/opt/duskbot-link/agent.mjs` then launches the staged file, and stops launching one that did not
  stay up for 2 minutes three starts in a row, so a bad release leaves the installed agent running.
  It stays off until at least one release key is pinned, since an update runs downloaded code as the agent;
  `DUSK_LINK_UPDATES=off` turns it off for good. The server's own build is not updated this way: it is root's, and only
  `install.sh` replaces it.

## Phone channels

The VPS agent syncs phone channels with its local harness at `/api/mobile/relay/sync` and registers them under the
existing tunnel. Each phone has its own relay token verifier, encryption key, replay guard and queues. Grant channels
only serve pairing redemption, environment discovery and health; device channels serve the harness API with the
phone's session. Phone channels refuse agent controls and strip cookies and `x-dusk-*` headers. Requests carry
a per-channel remote address, so they never receive loopback trust. Removing a channel from the harness closes its
forwarded requests and removes it from the relay.

The agent keeps its X25519 phone keys in `phone-keys.json` beside `tunnel.json`, with mode 0600. Grant keys come from
the harness; device keys derive from the phone and agent key pairs using the channel id. Set `DUSK_LINK_PHONES=off`
to disable the phone hub. Phone clients use `createTunnelProxy` with `id` set to the channel id and `route` set to
`${base}/v1/channels/${channelId}`.

## Security model

- The code in the command is one-time. It must be used within 30 minutes and the session ends 2 hours after it opens.
  Once linked, the same line is refused ("already used"), and running it again only repairs the install offline.
  Nothing in shell history can be used again.
- The service stores only sha256 verifiers of bearer tokens, public keys and sealed blobs. It never stores a token, the
  pairing code, a credential or chat data. `test/link-service.test.mjs` checks the saved state file for this.
- The result is sealed with X25519 ECDH between a key the app made and a key the VPS made, so passively logging
  everything the service sees opens nothing. Residual risk: an actively malicious link service could serve a different
  script or swap keys. That is the trust you give anything you `curl | sh`. Run the service yourself (this folder) to
  remove the third party entirely.
- Tunnelled requests arrive at Dusk Bot with `X-Forwarded-For` set, so the server treats them as remote: they need
  the paired session and never get loopback trust. The app's proxy serves only its own `vps-<id>.localhost:<port>` host.
- AI credentials are made on the Mac (`claude setup-token`, Codex's `~/.codex/auth.json`). They travel only as sealed
  control frames to the agent, which writes them with mode 0600 into its hand-off folder (`/var/lib/omb-link/handoff`).
  A root unit (`duskbot-handoff.service`, `/usr/local/lib/duskbot/engine-handoff.sh`) reads them as `omb-link`,
  keeps only the `CLAUDE_CODE_OAUTH_TOKEN=` line for `/etc/duskbot/engines.env` (which only systemd reads) and
  writes the Codex sign-in into maus's `~/.codex/auth.json` as maus. They never pass through Dusk Bot's HTTP API and
  are never logged.

### Accounts on the server

Bots run shell commands, so the server is split so that no bot can reach what would give it the machine or the link:

| Account | Runs | Holds | Never has |
|---|---|---|---|
| `dusk` (`maus` on a server set up before the rename) | `duskbot.service` (hardened: no new privileges, no capabilities, system read-only, other homes hidden) | its home (0700) and data folder (0700) | the docker group, the link files |
| `omb-link` | `duskbot-link.service` and the app's restricted direct key | `/var/lib/omb-link`: `tunnel.json`, `.ssh/authorized_keys`, the hand-off folder | the server's data |
| `omb-docker` (in `docker`) | `omb-docker-gate.service`: a Docker API filter on `/run/duskbot-docker/docker.sock` (group `omb-dockergate`: the server account only) | nothing | a shell, the network |

- Every bot's turn runs in the bot box (`DUSK_BOT_BOX=required`, server/bot-box): its own user, mount, pid and network
  namespaces, HOME an engine home inside the data folder (`engine-home`) with only the engines' sign-ins bound in
  (settings read-only), its workspace, and the internet through the box's egress gate. The server's HOME, data folder,
  `~/.ssh`, `~/.config` and `~/.local` are never in a box, and a working folder that would contain them is refused. If
  bubblewrap cannot run, bots' turns are refused rather than run unboxed. Ubuntu 24.04 needs the AppArmor profile
  install.sh writes (`/etc/apparmor.d/duskbot-bwrap`) for bubblewrap to make user namespaces.
- The docker gate (`docker-gate.mjs`, served at `/docker-gate.mjs` like the agent) forwards only what the server's bot
  computers need, on containers labelled as ours, with the flags it sets (gVisor, no privileged mode, no host mounts,
  devices or namespaces, dropped capabilities). The two host probes are allowed only in their exact shape.
- Running install.sh again on an older install moves `tunnel.json` to `omb-link`, drops the app's key from the server account (the app
  asks the agent for a new one over the sealed tunnel and connects as `omb-link`), moves the Claude token to
  `/etc/duskbot/engines.env`, copies the engines' sessions into the engine home, takes the server account out of the docker group
  and installs the gate and the hardened units. Nothing in the data folder moves.
- A server set up before the rename to Dusk Bot keeps its server account (`maus`). Running install.sh on it again
  (`migrate_legacy`) stops and removes the old units, moves the state, logs, agent, gate, `/etc` and link folders and
  the data folder to the new names (the old data and agent folder names stay as links), points the app's direct key at
  the moved agent, and moves the AppArmor profile and Caddy site. Until then the old install keeps working: the agent
  reads its old folder and env names, and the app reads the old unit names and the old well-known path.
- Unlinking in the app deletes the tunnel at the service. The agent then idles and the app forgets the server.

### Secrets sealed for the server itself

On top of the tunnel, every password, 2FA key, 1Password service-account token and API key typed in the app is sealed
for the Dusk Bot server process before it leaves the page (HPKE: P-256, HKDF-SHA256, AES-256-GCM), so neither the
link service, the agent nor anything else that relays the request can read it:

- The server makes a fresh sealing key each start (`GET /api/seal-key`) and signs it with its long-term identity key,
  `seal-identity.key` (P-256, mode 0600, in the data folder, never in a workspace backup or a move). The identity is in
  `/.well-known/duskbot/environment` as `sealIdentity`.
- `agent.mjs link` puts `sealIdentity` in the result it seals for the app, and the app pins it in its link record
  (`vps-link.json`, `links[].sealIdentity`). A link made before that pins the first identity it sees, through the same
  sealed tunnel (`sealPinnedAt` says when). The page asks main (`window.ogb.sealTrust.check`); main picks the link from
  the page's own origin. A key signed by any other identity is refused and nothing is sent.
- Each seal is bound to what it is for (`shared/saved-secrets.ts` `sealedValueAAD`): a login from Settings to its host
  and username, a change to the login's id, a sign-in card's login to that bot, conversation and card, the 1Password
  token to its connect, API keys to the settings paths they fill (`sealedPaths`). A sealed value opens once.
- The server refuses a secret in the clear from anything but loopback with `400 {code: "seal_required", sealKey}`. The
  desktop's own page on this computer, and its private main-process channel for keys, keep working unsealed.
- Reinstalling Dusk Bot with a fresh data folder makes a new identity: the app then refuses to seal for it until the
  server is linked again (run the install line from a new "Add your VPS").

## Route traffic through this computer

Settings > Computer > Your computer > "Route traffic through this computer" (`PUT /api/computer/egress {enabled}`,
saved as `vps.routeThroughComputer`, on unless someone turned it off) sends the bot computers' web traffic out through the person's own
computer while its app runs, so sites see a home connection instead of the VPS's data centre address. When the app is
closed, asleep or offline, new connections use the VPS's own network, and they go back through the computer once it
says hello again. The row says which network is in use (amber while it is the server's), and the app shows a quiet
note the first time it falls back. It applies to new connections only.

```
 bot computer (chromium)         vps host                            the app (electron main)
 managed policy: PAC              agent.mjs createEgressProxy         vps-link-egress.mjs createEgressEndpoint
 "SOCKS5 172.18.0.1:3129"         -> socks5 / http connect on the  -> {t:"dial", r, host, port}  ->  resolve here, check
                                    omb-desk0 bridge only             <- {t:"dialed", r, ok, code}     every address, connect
                                                                      <-> bytes frames on the same sealed tunnel streams
```

- Frames: the app says `{t:"egress", ready}` every 15 s while it takes streams (and `ready: false` on close). The agent
  sends `dial`, the app answers `dialed`; then both sides send the stream's bytes as ordinary `bytes` frames and `end`
  or `cancel`. It is the tunnel's own stream api (`send`, `bytes`, `queued`, `onDrain`), so it rides any transport the
  tunnel uses, with the outbox's per-stream round robin. Egress reads pause at 1 MiB queued (the desktop's own mark is
  2 MiB), so the screen and API keep their share.
- The app connects only to ports 80 and 443 on the public internet. It looks names up itself, refuses a whole name when
  any answer is loopback, this computer, its networks (and its public IPv6 prefix), the home's public address (from
  `GET /v1/ip` on the link service), private, CGNAT, link-local, metadata, multicast or reserved (NAT64 and 6to4
  unwrapped), refuses `.local`, `.localhost`, `.internal`, `.lan`, `.home.arpa` and single-label names, and connects
  only to the addresses it checked (no second lookup, so DNS rebinding changes nothing). At most 128 streams, 600 new
  streams a minute and 8 MiB/s down; idle streams close after 5 minutes. No UDP.
- The agent never dials anything itself (a box must not reach this host past the host fence). It listens only on the
  bridge's address, refuses the bridge's own address (so processes on the host cannot use it), and answers with a
  SOCKS failure at once when the setting is off, the app is at its stream cap, has not said hello for 40 s or did not
  answer a dial within 5 s (then its open streams close too, and the agent reports at once). The policy has no
  `DIRECT` fallback, so such a request fails instead of leaving through the server's network: a page that exhausts the
  stream cap cannot push the browser off the proxy. The server removes the policy (every request direct) only once the
  agent reports the app offline, and writes it again when the app is back. A destination the app refuses
  or cannot reach (its own DNS may block ad domains, for one) gets a SOCKS success and an immediate close instead,
  which fails only that request and keeps the proxy in use; HTTP CONNECT gets 403 or 502.
- `host-fence.sh` lets the bridge reach TCP 3129 on the host (`omb-box-egress`); nothing else on the host.
- The server (`server/computer-egress.ts`) takes the agent's report every 5 s (`POST /api/computer/egress/agent`,
  owner-trust loopback only), and writes `/etc/chromium/policies/managed/omb-egress.json` into each running bot
  computer while the route is up and the box can reach the proxy (removing it otherwise). Chromium rereads that folder
  by itself, so nothing restarts and no image change is needed. Strict (read-only) boxes keep using the server's network.
- Settings show the row only on a linked VPS, with the route new connections take now: through your computer, or the
  server's network while your computer is offline. Bots are told about it in their prompt while it is on.

## Phone channels and typed codes

Each phone has its own channel and bearer verifier under a VPS tunnel, separate from the Mac's queues.
The VPS token authorizes `PUT /v1/tunnels/:id/channels {channels:[{id,verifier,kind,expiresAt?}]}` to replace
its whole set (up to 32): `grant` expires within 24 hours; `device` has no expiry. Omitted channels are revoked;
changing a verifier ends old readers and clears queued frames. Channel verifiers persist in `state.json`; frames do not.

- Phone token: `POST /v1/channels/:cid/to-vps {frames,epoch?,seq?}`,
  `GET /v1/channels/:cid/to-app?wait=25&stream=1`, `DELETE /v1/channels/:cid`.
- VPS token: `POST /v1/tunnels/:id/channels/:cid/to-app {frames,epoch?,seq?}`,
  `GET /v1/tunnels/:id/channels/to-vps?wait=25&stream=1`. The aggregated stream starts with `{frames:[]}`,
  then emits `{channel,frames}` batches round robin, with one reader per tunnel. Without `stream=1`, it returns
  `{batches:[{channel,frames}]}`. Deleting the tunnel also removes its channels.
- Phone limits per channel: 50 posts/s with a burst of 400, 64 MiB of frame text per rolling minute,
  and 240 reads per rolling minute. A limit returns `429 {error,code:"rate_limited"}`.
- Public typed-code storage: `POST /v1/lookups {id,sealed,ttlS,deleteVerifier?}` (32 lowercase hex id,
  base64url sealed text up to 16384 characters, TTL 30-900 seconds), `GET /v1/lookups/:id` returns
  `{sealed,expiresAt}`. Optional `DELETE /v1/lookups/:id` requires the token matching `deleteVerifier`.
  Lookups stay in memory only, up to 5000 live entries; per IP, 30 creations and 60 misses per hour.

## Step events

install.sh posts every step to `POST /v1/sessions/<id>/events` (bearer: the VPS token); the app reads them from
`GET /v1/sessions/<id>/events?after=<seq>&wait=25` (bearer: the watch token) as `events[]`:

```
{ "seq": 12, "at": 1762462800000, "step": "node", "status": "running" | "done" | "failed" | "skipped",
  "log":   "last 30 lines\n...",              // only on failed and skipped: the step's log tail
  "cmd":   "apt-get -y -q install nodejs",     // optional: the command running now
  "lines": ["$ apt-get -y -q install nodejs", "Get:4 https://deb.nodesource.com/... [31.2 MB]", "..."] }  // optional
```

- While a step runs, install.sh sends its new log lines about every 0.5 s: at most 40 a batch (a batch that had more
  starts with `[N more lines]`), each line cut to 300 characters and stripped of control characters, one batch in
  flight at a time, and the last one before the step's `done`/`failed`. Lines starting with `$ ` are the commands it
  runs. Those batches have `"status": "running"`, so an app that ignores `lines` sees nothing new.
- Before anything is written to a log or sent, bearer tokens, the link secret and VPS token, `sk-...` keys and
  `token`/`password`/`secret`/`*_KEY` values are replaced with `[redacted]`.
- The service keeps up to 60 lines and 16 KB per event (the newest), `cmd` up to 300 characters, and the newest 150
  line, progress and heartbeat events per session; status events are never dropped for those events. Steps the app does not know
  (`sandbox`, `fence`) are reported as `desktop`.
- In the app, `electron/vps-link.mjs` keeps them in memory only and puts them on the view it already sends:
  `steps[i].cmd`, `steps[i].lines` (last 200 per step) and `terminal` (last 400 lines overall, in order, each
  `{ "step": "node", "text": "..." }`). A late batch never moves a finished step back to running.
- Running events may include `progress`: downloads report `kind: "download"`, `receivedBytes` and `totalBytes`;
  Docker reports `kind: "layers"` or `"build"`, `completed` and `total`, and known transfer bytes. Build totals count
  observed operations and can grow; only `DONE` or `CACHED` operations count as complete.
- Running events include `activity: { elapsedMs, quietMs }`. A heartbeat is sent about every two seconds without
  output; `heartbeat: true` means no new log bytes or progress were observed. It proves contact, never progress.
  Closing the app's setup modal keeps installation running. Explicit cancellation stops the installer's children,
  keeps installed files and cached download bytes, and requires a new setup command to resume.

## The server build

The VPS installs our own server, built from this repo, not the upstream `duskbot` npm package. That build is
private: the service hands it only to a claimed install session, at `/pkg/<session>/<sha256>.tgz`, with the session's
own bearer token, while the session is still installing, at most 10 times across both archives. There is no public url for it.

- The claim reply names the build: `"package": {"sha256", "size", "version", "path"}`. install.sh downloads it (the
  terminal shows a progress bar), checks the sha256, and installs it with `npm install -g <file>` as the server account (`dusk`).
  Interrupted downloads retain `.part` files and resume with an authenticated `Range: bytes=<offset>-` request.
  A checksum mismatch discards that partial file and retries from zero; a verified cache needs no download.
  Its three native dependencies (DuckDB, resvg, the 1Password SDK) still come from the npm registry, per platform.
- No build published means no `package` in the claim, and the install stops at "Installing Dusk Bot" with "the link
  service has no Dusk Bot build to hand out yet".
- `DUSK_PACKAGE=<npm spec or tarball url>` before `sh` installs that instead. It is never the default.
- The bot computer kit rides the same way: `deploy/bot-desktop/` plus `shared/bot-desktop.ts` as one tgz, named in
  the claim as `"desktop": {"sha256", "size", "image", "path"}` (`image` is `BOT_DESKTOP_IMAGE`). install.sh then sets
  the host up the way `deploy/bot-desktop/README.md` ("Host setup the box expects") says, as three terminal steps
  that all report to the app as its one `desktop` step:
  - **Sandboxing bot computers**: gVisor `runsc` from its apt repo, registered in `/etc/docker/daemon.json` with
    `"runtimeArgs": ["--overlay2=none"]`; if that fails, `"userns-remap": "default"`. The file is merged, never
    replaced (the first original is kept as `daemon.json.omb-before`), Docker restarts only when it changed, and the
    old file goes back if Docker won't start with the new one.
  - **Fencing their network**: `host-fence.sh` to `/usr/local/sbin/omb-host-fence`, `omb-box-fence.service`
    enabled and started, then `omb-host-fence --check`.
  - **Building the bot computer**: nothing if the image is already there, a `docker pull` if a registry copy exists,
    else the kit's `build.sh` (installs `docker-buildx` only for that fallback), reporting completed build operations.
  Each of these that fails is shown in amber and the install goes on: bots work without a bot computer, boxes fall
  back to strict mode without the sandbox or fence, and the app builds the image on first use.

Publish a new build (from the repo root, on a machine with this checkout):

```
node scripts/build-vps-package.mjs                               # builds; writes release/vps/duskbot-<version>-<sha12>.tgz + manifest.json
node scripts/build-vps-package.mjs --skip-build --publish /root/omb-link-data   # on the link service host: copies it in
```

`--publish <data dir>` writes `<data dir>/packages/<sha256>.tgz` for the build and the kit, then
`<data dir>/packages/current.json` (`{"sha256","version","commit","builtAt","desktop":{"sha256","image"}}`), each by rename, so nothing restarts and new claims get the new build at
once. To publish from elsewhere, copy those three files into the service's `packages/` dir in that order (tgz first). Older
tgz files keep serving installs already under way; delete them when no install from the last 2 hours needs them.
`LINK_PACKAGES_DIR` moves the folder.

## The terminal

install.sh opens with the wordmark decoding out of noise and one light sweep (about a second, one awk process), then
shows five phases, one line each: Preparing your server (check, basics, docker, user), Installing the runtime
(node), Installing Dusk Bot (app, engines, service), Setting up the bot computer (sandbox, fence, desktop) and
Linking to your app (address, link). The running step is the line's sub-status, with a bar for downloads of known
size and build steps, and the line turns into one check when the phase is done (amber when an optional part failed).
The mascot wags its tail while work runs. A failure shows the red step, its last log lines and one plain fix. The end
is three lines: ready and how long it took, where it runs, and "go back to the app". The versions table goes to
`/var/log/duskbot-link/summary.log` (and on screen with `DUSK_VERBOSE=1`); every step's log is
`/var/log/duskbot-link/<step>.log`.

It falls back to plain lines (no escapes) when stdout is not a terminal or `TERM=dumb`, drops colors and the
animation for `NO_COLOR` (`DUSK_NO_ANIM=1` keeps colors without the animation), uses ASCII for `DUSK_ASCII=1`, and a
one-line wordmark under 80 columns. In-place drawing (the phase list, the mascot) only happens when the screen has
room for all of it; otherwise lines just follow each other.

Try the screen without a server (writes nothing, needs no root, runs on a Mac too):

```
DUSK_INSTALL_DEMO=1 sh apps/link-service/install.sh        # DUSK_INSTALL_DEMO=fail shows a failure
```

## Uninstall

```
curl -fsSL https://link.dusk.bot/uninstall | sh                 # shows what it removes, asks on the terminal
curl -fsSL https://link.dusk.bot/uninstall | sh -s -- --yes     # no question (or DUSK_UNINSTALL_YES=1)
```

`GET /uninstall` (also `/uninstall.sh`) serves `uninstall.sh` to anyone, no session, with the base baked in. It puts
the server back the way install.sh found it, in the same five-phase screen: Unlinking from your app (deletes the
tunnel at the service with the server's own tunnel token, so the app reads "unlinked"), Stopping Dusk Bot (every
unit install.sh wrote), Clearing the bot computers (our containers, their home volumes, the desktop
network (`DOCKER_NAMES.desktopNetwork` in `electron/legacy-names.mjs`), our images, the host fence and its iptables rules, and `/etc/docker/daemon.json` back from install.sh's
`.omb-before` copy or with only our keys taken out; Docker restarts only when that file changed), Removing your bots'
home (a 0600 tarball of `~maus/.duskbot` to `/root/duskbot-backup-<date>.tgz` first unless `--no-backup`,
then the server account, `/opt`, `/var/lib`, `/var/log` files and Caddy site) and Removing what it installed. It ends
with a check of what is left (systemctl, `docker ps -a` and friends, the account, the paths, the fence, daemon.json).

It asks before changing anything, on `/dev/tty`, so the `curl | sh` line works. With no terminal and no `--yes` it only
shows what it would remove; `--dry-run` does that on purpose. It is safe to run again, and when nothing or only part is
installed. A failed backup stops it before anything of the bots is removed.

install.sh writes `/var/lib/duskbot/install-manifest`: every package its apt calls added (dependencies too), the
apt sources and keyrings it created, whether it made `daemon.json` or which keys it added, what it did to the
Caddyfile, the ufw ports it opened and whether it made the server account. A plain uninstall keeps Docker, Node, Caddy
and gVisor (and the `pkg`/`file` lines of the manifest, so a later `--all` still knows them). `--all` also purges
those packages: it marks them automatic and purges only the ones apt would then autoremove, so anything installed
later that needs one keeps it; it never removes `curl` or `ca-certificates`, and it clears Docker's build cache. When
Docker is one of them, purging it also empties `/var/lib/docker` (every container and volume, not only ours), and the
plan says so before it asks. Docker's socket unit is stopped first so a later install's Docker starts cleanly.

## Run it

```
cd apps/link-service && npm start                       # PORT (default 8790)
```

| env | default | |
|---|---|---|
| `PORT` | 8790 | listen port |
| `LINK_BASE` | `https://link.dusk.bot` | public address the VPS reaches; baked into the served script |
| `LINK_DATA_DIR` | `./data` | `state.json` (sessions, tunnel verifiers); keep it outside the checkout so redeploys keep tunnels |
| `LINK_PACKAGES_DIR` | `$LINK_DATA_DIR/packages` | the private server builds (see "The server build") |
| `LINK_TRUST_PROXY` | `1` | read the client IP from `X-Real-IP` or the last `X-Forwarded-For` hop; set `0` without a proxy |

The app's base comes from `DUSK_LINK_BASE` (default `https://link.dusk.bot`).

Deploy with the `deploy` CLI from the repo root:

```
printf 'LINK_DATA_DIR=/root/omb-link-data\n' > /tmp/omb-link.env
deploy link-service --name omb-link --domain link --env-file /tmp/omb-link.env
```

Requests stay under 1 MB (nginx's default body limit), and long polls are 25 s (under nginx's 60 s read timeout).
WebSockets are not needed.

How the two ends use it, for speed (docs/verification/wire-latency.md has the measurements):

- Both reach the service over one HTTP/2 connection when it offers h2 (nginx does): the streamed read and every post
  share one warm TLS connection, and up to eight posts are out at once (the service holds eight that overtook an
  earlier one). A service without h2 gets keep-alive HTTP/1.1 and three posts.
- A post leaves on the next turn of the event loop; frames that come while posts are out gather for 2 ms per post out.
- Each end asks for its next streamed read 21 s into the current one, so the next is waiting at the service when the
  current one ends (the service hands the queue to the newest reader): no frame waits through a round-trip gap.
- After a sleep or a network change the connections are dropped but the TLS sessions are kept, so reconnecting
  resumes instead of paying a full handshake.

Tests: `pnpm vitest run link-service electron/vps-link.test.mjs` and `node --test electron/vps-link-*.node-test.mjs` from the repo root.

## Account dashboard

Set `DUSK_LINK_DASHBOARD_URL` to advertise the hosted dashboard through `GET /.well-known/duskbot/dashboard`.
