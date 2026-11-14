# The desktop first run as a funnel

What a brand-new person meets in the desktop app, where they hesitate, and how the run was reshaped (November 2026). The
code lives in `src/components/onboarding/` (`WelcomeFlow.tsx` orders it, `funnel.ts` decides the steps). The end-to-end
check is `scripts/smoke/flows/onboarding.mjs --path mac|cloud|server`.

## The job

The first run has one job: get the person to the first useful bot reply (the "wow") with as few decisions as possible.
For people who want their bots running 24/7, it also has to make buying dusk cloud quick and calm. It is a Persuade
surface that has to feel like Operate: short, quiet, nothing to read twice.

## Before (as shipped up to 2be8b8cbc)

| # | Screen | What the person sees and feels | Friction and drop-off risk |
| --- | --- | --- | --- |
| 0 | Account gate (packaged app, before the app) | "Sign in to dusk bot": Google, Apple, X or an emailed code | A wall before any value. This is the biggest drop-off risk in the whole run, and it is outside this funnel (see "Not changed"). |
| 1 | Welcome | "Meet dusk bot", one line, "get started" | One click that decides nothing. Pleasant, but it costs a click and a screen of patience. |
| 2 | Account (only when not signed in yet) | The same sign-in again, inside the funnel | Before the person has chosen anything, they're asked who they are. |
| 3 | Where should your bots live | This Mac (free), dusk cloud ("from $20 a month", hard-coded), own server | The cloud price was a fixed string, not the offer, and the trial wasn't shown. |
| 3a | This Mac's sheet | "dusk cloud runs your bots 24/7 / they stop when it sleeps" with the price | Good and kind. Kept as the owner wrote it. |
| 3b | dusk cloud | An in-app buying sheet over the funnel: sign-in again if needed, a plan list, then a checkout in the browser, then back | A sheet inside a funnel inside the app, then a browser, then the sheet again: three surfaces for one purchase. Closing the sheet left the person on step 3 with no trace of what happened. |
| 4 | Connect an AI | A grid of AIs, the free model, "set up later" | Fine. Its line didn't know a cloud was being made. |
| 5 | Bring what you already use (this Mac) | What other AI apps left here, and the prompt for AIs online | Optional and quiet; the memory import is a real differentiator. |
| 6 | Phone (behind a flag) | QR code | Hidden. Asking for a phone before the first reply would cost people. |
| 7 | Making your cloud (dusk cloud) | Progress, then the cloud's chat | Then a second "welcome to dusk cloud" covered the cloud's chat: a second onboarding right after the first. |

## After

**This Mac:** where bots live (hello included) → this Mac's sheet → account (only if not signed in) → connect an AI →
bring what you already use → the chat, where Dusk greets you and the first reply comes.

**dusk cloud:** where bots live → **Continue in your browser** (account, plan and checkout happen there) → connect an
AI while the cloud is made → making your cloud → the cloud's chat, with no second welcome.

**Own server:** where bots live → the one install line (unchanged).

| # | Screen | Why it is here, and what changed |
| --- | --- | --- |
| 1 | Where should your bots live | The first screen on the desktop app is now the first real question. The hello moved onto it (the animated mascot plus "A team of bots that does real work for you. You can move them any time."), which removes a screen and a click. dusk cloud's tile shows the live offer: "N days free" as its tag and "Then from $X/month + tax." under it, or "From $X/month" when no trial is offered. The price is shown before anything is asked for. |
| 1a | This Mac's sheet | Unchanged, as the owner wrote it. "Use dusk cloud" there goes to the same browser step as the tile. |
| 2 | Account (this Mac only, and only when not signed in) | Moved after the place, so the person decides what they want before being asked who they are. On the dusk cloud path it isn't shown at all: the browser does it. |
| 2c | Continue in your browser (dusk cloud) | The app calls `continueInBrowser({ kind: "upgrade", source: "app_onboarding", move: "computer" })` (`src/lib/account-intent.ts`). Signed out, the browser signs up or in and lands on the plans; signed in, a one-time handoff opens the plans already signed in. This screen is the calm waiting state: what is left ("Create your account, pick a plan and check out", or "Pick a plan and check out" once signed in), a pulsing "Waiting for your sign-in / checkout" line, the trial and price with "Cancel any time", **Open the page again**, **Use this Mac instead** (which lets go of a sign-in still waiting) and **Back**. It moves on by itself when the payment shows on the account (main's watch, a re-read every 6 s and whenever the window comes back to the front) and brings the app to the front. The app-wide "Continue in your browser" sheet stays closed during the first run because this screen is that state. |
| 3 | Connect an AI | On dusk cloud it says the cloud is getting ready, so the wait is used for something. There is no way back to a purchase that is done. |
| 4 | Bring what you already use (this Mac) | Kept: it is optional, quiet, and the memory import makes the first reply better. |
| 5 | Making your cloud (dusk cloud) | Unchanged. When the cloud is ready the app opens it, and now marks its onboarding with `cloud-welcome-done` (`electron/cloud-welcome-carry.mjs`, the same idea as `welcomeForServer` for servers). It does the same when the website's "you're all set" deep link (`duskbot://cloud`) opens it. The person lands in a working chat. The one useful part of the cloud's own welcome, connecting an AI, already happened in step 3 while the cloud was made. |

### Principles applied

- **Fewest steps to the first reply.** On the desktop, this Mac path went from 4 screens after the gate (welcome, place,
  AI, bring) to 3 (place, AI, bring). dusk cloud went from welcome, place, sheet (sign-in, plans, pay), AI, making and
  a second welcome to place, browser, AI and making.
- **Price before money.** The tile and the waiting screen both show the live offer: trial, price after it, tax and
  "Cancel any time". Nothing is charged in the app.
- **Trial framed simply.** "7 days free" on the tile, then one sentence: "Free for 7 days, then from $15/month + tax.
  Cancel any time."
- **Trust at the right moment.** The account is asked for only once it is needed (this Mac's sync, or buying). Paying
  happens on the payment provider's page, not in the app.
- **No dead ends, easy back-out.** Every step before payment has Back. The browser step has Open the page again and Use
  this Mac instead. A browser that didn't open says so and offers the page again.
- **Kind upsell.** dusk cloud is offered on the first screen and once on this Mac's sheet, never again in the run.

## Analytics (opt-in only)

Sent through `track()` as `app_action` events, only when "Help improve dusk bot" is on:

- `onboarding_step` `{ step, path?, ms? }`: each screen shown, the path (`mac` / `cloud`) once picked, and the time
  spent on the screen before.
- `onboarding_place` `{ choice: mac | cloud | server }`
- `onboarding_mac_sheet` `{ action: open | mac | cloud | close }` (as before)
- `onboarding_checkout` `{ action: open | again | mac | paid, outcome? }`
- `onboarding_cloud` `{ action: bought }`
- `onboarding_account` `{ action: signed_in | skipped }`
- `onboarding_ai` `{ action: connected | free | later }`
- `onboarding_completed` `{ reason, at, path? }`

The admin's Product page has a **desktop first run** table (`apps/dashboard/server/admin/product.ts` `appFirstRun`):
the people who reached each screen per path, their share of the first screen, and the median time on the screen before.
Replays are left out.

## Not changed, and worth deciding

- **The account gate comes before the welcome** in the packaged app (`src/main.tsx`, `electron/account-gate.mjs`). A
  brand-new person still signs in before they see what dusk bot is. Moving the gate behind the place question (signed
  out, the dusk cloud path would then sign up in the browser in one go) is the largest remaining conversion win. It
  changes an auth boundary, so it is left for the owner to decide.
- **The website's handoff asks a fresh browser "continue as <email>?"** before the plans page. That is one extra click,
  a deliberate safety check on the account side.
- **The bring step** stays on this Mac's path. If the numbers show people stopping there, move the prompt for AIs online
  into Dusk's first chat.
