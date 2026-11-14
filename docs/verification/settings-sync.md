# Settings that follow the person

What it covers: the person's settings kept level between this computer, My
Cloud and servers of the person's own (`server/settings-sync.ts`,
`electron/settings-sync.mjs`, `src/lib/synced-prefs.ts`), and an app's own
settings in connector sync (`server/connector-sync.ts`).

```sh
pnpm exec vitest run server/settings-sync.e2e.test.ts server/connector-sync.e2e.test.ts
node --test electron/settings-sync.node-test.mjs electron/connector-sync.node-test.mjs
```

`server/settings-sync.e2e.test.ts` runs two fixtures from
`scripts/testing/cloud-send-fixture.ts`: this computer (its private port over
Node's IPC), My Cloud with a Team Cloud beside it, and a second Cloud home that
stands in for the person's own server, reached over the owner's session. It
checks: language, a feature switch, the voice provider, an API key and a page
preference changed here reach both others; a later change on My Cloud beats an
earlier one on the server; a page preference from My Cloud reaches this
computer's page store; the computer's name and an address only this computer
reaches stay; keys come out of this computer only over its private port and of
a Cloud only to the owner's session; a Team Cloud answers none of it; nothing
logs a key; after the move to My Cloud a change there comes home, and one made
here goes back out.

`electron/settings-sync.node-test.mjs` covers the merge rules with in-memory
places: the last change wins, first-seen ties (set beats unset, then this
computer, My Cloud, a server), keys read only from the winning place, a value a
place refuses not offered again for 30 minutes, a place that is down left out.

Not covered here: the two-minute pass, the 20-second look and the instant
trigger in a packaged app; the page bridge in a real window (unverified in a
browser); a real server of the person's own (the same routes, reached over the
window's sign-in there).
