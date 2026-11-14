# To do: file splits behind the size-ratchet exception

On 2026-11-14 fourteen files were over their line limit in
`scripts/testing/file-size-ratchet.test.ts` while several agents were editing them at the same time. Splitting them
then would have caused conflicts, so their numbers were raised to their size plus a small margin, under a
"DELIBERATE EXCEPTION" note in that test. This is the plan to pay that back. The numbers still only go down:
`scripts/tighten-ratchets.mjs` lowers them at each release, and nothing may grow past them meanwhile.

The same change stopped counting `*.node-test.mjs` files. They are tests (Node's own runner), and the ratchet already
says tests are not counted; only the filename pattern was missing.

## How to split

Follow `server/host/README.md`, which already governs `server/index.ts` and works for every file here:

- One concern per module, exporting a factory or plain functions with explicit deps; the original file stays the
  composition root and imports the module.
- Moves are moves: byte-identical bodies (review with `git diff --color-moved=dimmed-zebra`), behaviour changes in
  their own PR.
- Tests follow the code: a test that read the old file's source text moves to the new module.
- Split one file per PR, when nobody else is editing it, and lower its number (or drop its line) in the same PR.
- When a file is back under its old number, remove it from the exception block; delete the block when it is empty.

## Files and extraction plans

| File | Size then | Plan |
| --- | ---: | --- |
| `server/index.ts` | 16,038 | Keep going with the existing program in `server/host/README.md`: next candidates are the usage-signals wiring (usage outbox, frustration watch, digest), the dashboard collector/reporter composition, and the remaining route handlers into `server/routes/`. Back under 15,799 first, then the program's own targets. |
| `electron/main.mjs` | 3,495 | Move the companion connection block (`ensureManagedCompanionConnector` through `activatePersistedManagedCompanionEndpoint`) to `electron/companion-main.mjs`; the cloud menu helpers (`cloudMenuSublabels`, `cloudMenuOptions`, `refreshCloudMenus`, `openCloudAdd`) to `electron/cloud-menu.mjs`; the secure credential helpers (`loadSecureCredentials`, `saveSecureCredentials`, `secureComposioConfig`, `secureWorkspaceConfig`) to `electron/secure-credentials.mjs`; company backup scope helpers to the existing backup module. |
| `src/state/store.tsx` | 3,382 | Move the type declarations (`Message`, `Bot`, `Task`, `Group`, card data types, `AppState`, `Action`) to `src/state/store-types.ts` and re-export them; split the reducer's card and onboarding-card helpers (`patchCard`, `patchGroupCard`, `openOnboardingCard`, `dismissOnboardingCard`) into `src/state/card-reducers.ts`. |
| `server/drivers/codex.ts` | 1,776 | Move config and permission-profile translation (`decodeConfig`, `managedCodexArgs`, `chatgptPlanCodexArgs`, `grantedPermissions`, `withResolvedSandbox`, the approval-param helpers) to `server/drivers/codex-config.ts`, and the native log message mapping to `server/drivers/codex-log.ts`. |
| `server/vps-computer.ts` | 1,488 | Split into `vps-computer-status.ts` (status probing: `computeVpsComputerStatus`, `vpsComputerStatus`, status problem helpers), `vps-computer-inventory.ts` (`scanManagedVpsAlias`, `listManagedVpsComputers`, `removeManagedVpsComputer`) and keep lifecycle actions (`vpsComputerAction`, join, replace) in the original. |
| `scripts/mcp-server.ts` | 1,415 | Move the `TOOLS` catalogue (lines ~157-476) to `scripts/mcp-server-tools.ts` and the argument validation and projection helpers (`validateToolArguments`, `*Arg`, `project*`) to `scripts/mcp-server-args.ts`. |
| `electron/vps-link-protocol.mjs` | 1,327 | Already marked in sections: move the crypto shared with `apps/link-service/agent.mjs` to `electron/vps-link-crypto.mjs` and the relay transport section (`keepAliveFetch` through `streamChoice`) to `electron/vps-link-transport.mjs`. Relay-owned: coordinate with the relay owner first. |
| `electron/vps-link.mjs` | 1,256 | `createVpsLink` is one large factory: lift the install/progress helpers and the transfer steps into `electron/vps-link-install.mjs` and `electron/vps-link-transfer.mjs`, passing the factory's state in explicitly. Relay-owned: coordinate first. |
| `server/container-computer.ts` | 1,232 | Move image constants and `managedImageDockerfile` to `server/container-image.ts`, and runtime detection (`containerRuntimeStatus`, `installed`) to `server/container-runtime.ts`. |
| `electron/cloud-account.mjs` | 1,111 | `createCloudAccountClient` holds most of it: split the plan and checkout calls and the sign-in/session handling into two helper modules the factory composes. |
| `server/composio.ts` | 1,102 | Move broker HTTP (`brokerRequest`, `throwBrokerError`, `relayMcp`) to `server/composio-broker.ts`, and account/inventory listing (`listConnectedAccounts`, `connectedServicesInventory`, `serviceStateFromAccounts`) to `server/composio-accounts.ts`. |
| `server/browser-runtime.ts` | 1,063 | Move `BrowserClient` (the transport, lines ~134-336) to `server/browser-client.ts`; keep `BrowserRuntime` and the small result helpers. |
| `src/lib/ready-bots.ts` | 1,024 | Almost all of it is the ready-bot catalogue data: move the data to `src/lib/ready-bots-catalog.ts` (or one file per category) and keep `readyBot`, `readyBotTemplate` and `matchesReadyBot` here. |
| `shared/wire.ts` | 1,012 | Move the card data interfaces (`OptionCardData`, `SecretRequestCardData`, `SignInRequestCardData`, `QuotaSwitchCardData` and friends) to `shared/wire-cards.ts` and re-export them from `shared/wire.ts`. |
