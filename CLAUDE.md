@AGENTS.md

## Getting someone started

When someone clones or forks this repo and asks to set it up, initialize it, or just start working:

1. `pnpm install`
2. Run the app: `pnpm dev:server` (harness on 127.0.0.1:8799), `pnpm dev` (UI on 127.0.0.1:5199), then `pnpm dev:desktop` for the desktop window.
3. Test bots: the first `pnpm dev:server` on a brand-new workspace adds eight invented test bots (Nova, Quill, Rivet, Tally, Echo, Juno, Basil, Moss) in a "Test bots" sidebar section, with chats, memory, skills, a room, routines (all off) and webhooks, so nobody starts from zero bots. It happens once per workspace and never again, even after they are removed. If they are missing, run `pnpm test-bots` while the server is up; `pnpm test-bots --remove` deletes only what it created. `OMB_NO_TEST_BOTS=1` skips the automatic seeding.
4. Messages to the test bots get real replies through the person's own engine sign-in (Claude Code etc.), so they use that account's usage.

`pnpm demo` starts a fully separate copy with the same test bots and richer history (harness 8899, UI 5299, data in ~/.openmausbot-demo); `pnpm demo stop` stops it.
