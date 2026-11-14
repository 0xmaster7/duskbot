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
| 0 | Account gate (packaged app, before the app) | "Sign in to dusk bot": Google, Apple, X or an emailed code | A wall before any value, the biggest drop-off risk in the whole run. Now removed (see "The account comes when something needs it"). |
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

**This Mac:** where bots live (hello included) → this Mac's sheet → connect an AI →
bring what you already use → the chat, where Dusk greets you and the first reply comes.

**dusk cloud:** where bots live → **Continue in your browser** (account, plan and checkout happen there) → connect an
AI while the cloud is made → making your cloud → the cloud's chat, with no second welcome.

**Own server:** where bots live → the one install line (unchanged).

| # | Screen | Why it is here, and what changed |
| --- | --- | --- |
| 1 | Where should your bots live | The first screen on the desktop app is now the first real question. The hello moved onto it (the animated mascot plus "A team of bots that does real work for you. You can move them any time."), which removes a screen and a click. dusk cloud's tile shows the live offer: "N days free" as its tag and "Then from $X/month + tax." under it, or "From $X/month" when no trial is offered. The price is shown before anything is asked for. |
| 1a | This Mac's sheet | Unchanged, as the owner wrote it. "Use dusk cloud" there goes to the same browser step as the tile. |
| 2 | Account | Gone from the run (see below): this Mac needs no account, and dusk cloud makes one in the browser. Shown only on an install that requires an account. |
| 2c | Continue in your browser (dusk cloud) | The app calls `continueInBrowser({ kind: "upgrade", source: "app_onboarding", move: "computer" })` (`src/lib/account-intent.ts`). Signed out, the browser signs up or in and lands on the plans; signed in, a one-time handoff opens the plans already signed in. This screen is the calm waiting state: what is left ("Create your account, pick a plan and check out", or "Pick a plan and check out" once signed in), a pulsing "Waiting for your sign-in / checkout" line, **Open the page again**, a small, light **Use this Mac instead** text link (which lets go of a sign-in still waiting) and **Back**. No price line here: the price is on the place step and on the page asking for the money. It moves on by itself when the payment shows on the account (main's watch, a re-read every 6 s and whenever the window comes back to the front) and brings the app to the front. The app-wide "Continue in your browser" sheet stays closed during the first run because this screen is that state. |
| 3 | Connect an AI | On dusk cloud it says the cloud is getting ready, so the wait is used for something. There is no way back to a purchase that is done. |
| 4 | Bring what you already use (this Mac) | Kept: it is optional, quiet, and the memory import makes the first reply better. |
| 5 | Making your cloud (dusk cloud) | Unchanged. When the cloud is ready the app opens it, and now marks its onboarding with `cloud-welcome-done` (`electron/cloud-welcome-carry.mjs`, the same idea as `welcomeForServer` for servers). It does the same when the website's "you're all set" deep link (`duskbot://cloud`) opens it. The person lands in a working chat. The one useful part of the cloud's own welcome, connecting an AI, already happened in step 3 while the cloud was made. |

### Principles applied

- **Fewest steps to the first reply.** On the desktop, this Mac path went from 4 screens after the gate (welcome, place,
  AI, bring) to 3 (place, AI, bring). dusk cloud went from welcome, place, sheet (sign-in, plans, pay), AI, making and
  a second welcome to place, browser, AI and making.
- **Price before money.** The dusk cloud tile shows the live offer (the trial and the price after it) before anything
  is asked for, and the plans page in the browser shows it in full. Nothing is charged in the app.
- **Trial framed simply.** "7 days free" as the tile's tag, with "Then from $15/month + tax." under it.
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

## The account comes when something needs it

The installed app no longer opens on a sign-in (`electron/account-gate.mjs`: `accountGateRequired` is true only with
`DUSK_REQUIRE_ACCOUNT=1`, for an install that must have an account). The first screen is "Where should your bots live?".

- **dusk cloud:** the account is made or signed in to in the browser, as part of the checkout (`continueInBrowser` with
  the upgrade intent bound to the app's device sign-in). Approving the app on the website goes straight on to the plans;
  that approval also counts as the account's first run, so the website doesn't walk the person through its own
  onboarding first (`apps/dashboard/src/pages/DeviceApproval.tsx`). The app signs itself in when the approval lands and
  notices the payment by itself.
- **This Mac:** no account at all for local use. Anything that needs one asks at that moment, in the browser
  (`continueInBrowser({ kind: "signin" })`: the You menu, Settings, the cloud notice, a server's link). Paid features that
  need an account (X research, pages) say they aren't offered rather than waiting.
- **Own server:** the install line waits on a browser sign-in where it needs one, and makes itself after it.

## Kept on purpose

- **The website's "continue as <email>?" on an app handoff.** It shows only when an app that is already signed in opens
  a website page in a browser that isn't. The one-time link is minted by the app's session and isn't bound to the
  browser, so this click is what stops a link someone else minted from signing a browser into their account
  (login CSRF; `redeemHandoff` in `apps/dashboard/server/auth/index.ts`). A new person never sees it any more: signed
  out, the app uses its device sign-in, which has no such step.
- **The bring step** stays on this Mac's path. If the numbers show people stopping there, move the prompt for AIs online
  into Dusk's first chat.
