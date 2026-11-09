# Phone sync: pairing, relay and companion routes

One fake phone pairs from the QR payload, lists bots, sends and hears the reply on the event stream, uploads a file and
downloads it back from the chat, opens a websocket, and is refused once the owner revokes it. It runs twice: through an
in-process link service and link agent (a VPS without public ingress) and through the companion sidecar (a Mac).

```sh
node --experimental-strip-types scripts/mobile-sync-e2e.ts
```

It launches its own isolated fixture (`scripts/control-omb.ts launch`) and never touches the live relay or the user's
app. The fixture has no desktop, so the websocket check proves the upgrade reaches the harness's viewer gate with the
phone's session (409), not a live desktop; the byte-for-byte websocket echo is covered by
`apps/link-service/test/phone-hub.test.mjs` and `apps/companion/test/mobile.test.ts`.
