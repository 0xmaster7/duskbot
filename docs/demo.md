# The demo workspace

`pnpm demo` starts a second, fully separate OpenMausBot filled with demo bots, so you can click through every screen
and talk to bots that reply for real, without touching your own workspace.

```sh
pnpm demo            # start it (the first run seeds it, about 20 seconds) and open http://127.0.0.1:5299
pnpm demo --reset    # stop it, delete the demo folder, seed again from scratch, start
pnpm demo stop       # stop the demo's harness and UI
pnpm demo status     # is it running, and where
pnpm demo --no-open  # start without opening the browser
```

`pnpm demo` returns once both servers answer; they keep running in the background until `pnpm demo stop`. Running it
again while the demo is up just opens the page.

## What is separate

| | Your app | The demo |
| --- | --- | --- |
| Data folder | `~/.openmausbot` | `~/.openmausbot-demo` |
| Harness | `127.0.0.1:8799` | `127.0.0.1:8899` (webhooks on `8900`) |
| UI | `127.0.0.1:5199` | `127.0.0.1:5299` (its own Vite, its own `node_modules/.vite-demo` cache) |

The launcher strips every `OMB_*` variable from your shell before starting the demo, so nothing can point it back at your
workspace. It keeps `HOME` and `PATH`, so the demo's bots use the engine CLIs you already signed in to (Claude Code by
default) the same way your own app does. Nothing is copied out of `~/.openmausbot`.

The demo opens in your browser, not in a second Electron window: the development Electron build always talks to the
harness on 8799 (saving a key in its Settings would write to your real workspace), so a browser tab is the isolated
way to view it.

## What is in it

- **Bots**, each with its own color, body, title and standing instructions: Manager (Chief of Staff), Jordan, Amy,
  Content, Koder and Life in the **GOATS** section; Usage Auditor, scraper and B-roll in **Studio**; and MausBot.
- **Conversations** with tool calls, a markdown report with a table and code, reactions, an answered approval card
  (Koder), a work summary, and a failed tool call.
- **A pending question card**: Amy asks whether to send Prasenjit's $60 quote-tweet offer. It is in Needs you and the
  sidebar; answering it really reaches Amy, who replies with your engine.
- **Unread chats**: Content and Amy.
- **A room**, GOATS standup, with a short history.
- **Library files**: Jordan's script audit, the Usage Auditor's CSV and scraper's agency list.
- **Memory**: MEMORY.md for Jordan, Amy, Life and Content, plus a topic note and a daily log for Jordan.
- **Skills**: funnel-report (Jordan), copy-bank (Content), deploy-checklist (Koder).
- **Routines**: seven scheduled (four on, the three timers off), with nine past runs in the log, one failed.
- **Webhooks**: Vercel deploy failed (Koder), Stripe payout alert (Manager), New lead form (Amy).

Every demo bot is on **Ask me first**, so anything that needs a tool shows a real approval card first, and their
instructions tell them the history is sample data.

## Things to try

- Message any bot. It answers with its history as context ("what was the next step for Mum's laptop?" to Life).
- Answer Amy's card, then read her reply.
- Ask Koder to do something that needs a command to see a live approval card.
- Post to the New lead form webhook. It writes straight into Amy's chat and costs no AI turn:

  ```sh
  curl -X POST -H 'content-type: application/json' \
    -d '{"name":"Riya Kapoor","message":"Interested in a sponsored thread in December."}' \
    "$(node -e 'console.log(require(process.env.HOME + "/.openmausbot-demo/.demo/webhooks.json")["New lead form"].url)')"
  ```

  `~/.openmausbot-demo/.demo/webhooks.json` holds the demo webhooks' addresses and secrets (readable only by you).

## Costs and timers

Replies use your own engine sign-in, so every message you send, every card you answer and every "run" webhook spends
on it like a normal chat. Enabled routines also run when they come due while the demo is up (Morning copy bank on
weekdays at 08:30, Agency dashboards check at 10:00, Friday usage audit at 17:30, Monday funnel report at 09:00), and
within 12 hours after a time the demo was off for. Run `pnpm demo stop` when you are done, or turn routines off in the
demo's Routines page.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `OMB_DEMO_DIR` | `~/.openmausbot-demo` | The folder's name must contain `demo`; `--reset` only deletes a folder `pnpm demo` made. |
| `OMB_DEMO_PORT` | `8899` | Harness; webhooks use the next port. |
| `OMB_DEMO_UI_PORT` | `5299` | The UI. |
| `OMB_DEMO_MODEL` | `claude/claude-sonnet-5` | `INSTANCE/MODEL` every demo bot starts on. Applies at the next `--reset`. |

Logs are in `~/.openmausbot-demo/.demo/logs` (`harness.log`, `vite.log`). Content lives in `scripts/demo/content.mjs`;
edit it and run `pnpm demo --reset`.

## How the seed works

1. With the demo harness running, `scripts/demo/seed-live.mjs` makes the same requests the app makes: a team backup
   import (`POST /api/teams/import`, which brings the bots, looks, instructions, sections, memory, room and conversation
   text), then skills, routines and webhooks through their own routes.
2. With the harness stopped, `scripts/demo/seed-offline.ts` swaps each imported conversation for its full version
   (tool calls, cards, files, reactions) through `server/message-db.ts`, marks the unread chats and adds past routine
   runs. It refuses to run unless `OMB_DATA_DIR` is the demo folder.
