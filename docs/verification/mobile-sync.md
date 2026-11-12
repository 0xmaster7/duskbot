# Phone sync: pairing, relay and companion routes

One fake phone pairs from the QR payload, lists bots, sends and hears the reply on the event stream, uploads a file and
downloads it back from the chat, opens a websocket, and is refused once the owner revokes it. It runs twice: through an
in-process link service and link agent (a VPS without public ingress) and through the companion sidecar (a Mac).

```sh
node --experimental-strip-types scripts/mobile-sync-e2e.ts
```

It launches its own isolated fixture (`scripts/control-dusk.ts launch`) and never touches the live relay or the user's
app. The fixture has no desktop, so the websocket check proves the upgrade reaches the harness's viewer gate with the
phone's session (409), not a live desktop; the byte-for-byte websocket echo is covered by
`apps/link-service/test/phone-hub.test.mjs` and `apps/companion/test/mobile.test.ts`.

## Two real clients

The desktop renderer and the phone app, each in its own headless Chrome, on one isolated fixture: a message sent from
either shows on the other with the bot's reply, each stored once; a reply nobody is looking at stays unread and the
phone's list says so, and opening it on the phone reads it for both; a rename and a delete reach both; a message written
with no connection waits in the phone's outbox and is sent exactly once when the connection returns; a phone back from
the background shows what it missed.

```sh
node --experimental-strip-types scripts/mobile-two-client-e2e.ts
```

It starts its own fixture and two dev servers on free ports. The phone page reaches the fixture as a same-origin client,
so the bearer, relay and companion routes stay with the script above and the tests beside `src/mobile/transport`.
Permission asks, group chats, attachments, a workspace restart and push are not driven here.
