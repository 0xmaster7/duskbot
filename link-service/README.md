# OpenMausBot link service

Links a person's VPS to their OpenMausBot app with one pasted line. It's a small Node app with no dependencies and
nothing tied to openmausbot.com or Cloudflare.

```
curl -fsSL https://link.apps.siddz.com/i/<code> | sh
```

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
      |  sealed frames  ------->    /v1/tunnels/<id>/to-vps  ----------->  agent.mjs tunnel (openmausbot-link.service)
      |  sealed frames  <-------    /v1/tunnels/<id>/to-app  <-----------    -> http://127.0.0.1:8799 (marked remote)
   pairs, saves the server, signs the AI in from this Mac, moves everything
```

- **Relay mode** (the default, and what Oracle Cloud gets because only port 22 is open): every request and reply goes
  through the link service as AES-256-GCM frames, sealed with a key only the app and the VPS hold. The service just
  queues opaque blobs. Every frame carries a timestamp and is refused if it's stale or seen twice.
- **Direct mode**, used only when the service can reach the VPS on port 80: Caddy gets a certificate for
  `<ip-with-dashes>.sslip.io`. The app talks HTTPS straight to it and pins the certificate's public key, which Caddy keeps
  across renewals (`reuse_private_keys`). The tunnel still runs as a private control channel.

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
- Tunnelled requests arrive at OpenMausBot with `X-Forwarded-For` set, so the server treats them as remote: they need
  the paired session and never get loopback trust. The app's proxy serves only its own `vps-<id>.localhost:<port>` host.
- AI credentials are made on the Mac (`claude setup-token`, Codex's `~/.codex/auth.json`). They travel only as sealed
  control frames to the agent, which writes them with mode 0600 (`engines.env`, `~/.codex/auth.json`). They never pass
  through OpenMausBot's HTTP API and are never logged.
- Unlinking in the app deletes the tunnel at the service. The agent then idles and the app forgets the server.

## Run it

```
cd link-service && npm start                       # PORT (default 8790)
```

| env | default | |
|---|---|---|
| `PORT` | 8790 | listen port |
| `LINK_BASE` | `https://link.apps.siddz.com` | public address the VPS reaches; baked into the served script |
| `LINK_DATA_DIR` | `./data` | `state.json` (sessions, tunnel verifiers); keep it outside the checkout so redeploys keep tunnels |
| `LINK_TRUST_PROXY` | `1` | read the client IP from `X-Real-IP` or the last `X-Forwarded-For` hop; set `0` without a proxy |

The app's base comes from `OMB_LINK_BASE` (default `https://link.apps.siddz.com`).

Deploy with the `deploy` CLI from the repo root:

```
printf 'LINK_DATA_DIR=/root/omb-link-data\n' > /tmp/omb-link.env
deploy link-service --name omb-link --domain link --env-file /tmp/omb-link.env
```

Requests stay under 1 MB (nginx's default body limit), and long polls are 25 s (under nginx's 60 s read timeout).
WebSockets are not needed.

Tests: `pnpm vitest run link-service electron/vps-link.test.mjs` from the repo root.
