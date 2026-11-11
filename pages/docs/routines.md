---
title: routines
description: ask once and a bot does it on a schedule, or the moment something happens. routines run while you sleep.
section: doing
order: 1
art: s-clock
---

a routine is a job a bot does without being asked again. "every weekday at 8, summarise my inbox." "when a new github issue opens, triage it."

{{include ui-routine}}

## make one by asking

just say it in the chat:

- "summarise my inbox every weekday at 8."
- "check competitor prices every monday at 9 and tell me what changed."
- "prepare the sales report at 9 on the first of every month."

the bot sets the routine up in that same reply. a card appears in the chat showing the schedule, the time zone and the next few times it will run, with **Edit**, **Pause** and **Undo**.

## where routines live

**Automations** in the sidebar lists every routine, with a calendar and the history of each run. each bot's own routines are also in its panel, where every routine has a switch to pause it and turn it back on.

you can also make a routine by hand there with **New**. the form offers the common schedules: every day, every weekday, every week, every hour, or once.

## kinds of schedule

| you say | what you get |
| --- | --- |
| "tomorrow at 3pm" | it runs once. afterwards it reads **Done**. |
| "every weekday at 8" | it runs on the days you named. |
| "every 30 minutes" | it runs on a timer, anywhere from every 5 minutes to once a day. |
| "the first of every month", "the last friday" | a calendar rule. ask for these in chat and the bot works out the rule. |

a few details worth knowing:

- every routine has a time zone, and it keeps that zone even if you travel.
- a date that does not exist is skipped. "the 31st" skips short months. ask for "the last day of the month" if that is what you mean.
- a timer routine never piles up. if the last run is still going when the next is due, that one is skipped.

## when something happens

a routine does not need a clock. it can start when something happens:

- **in a connected app.** "whenever i get an email from acme, draft a reply." "when a github issue opens, triage it." this needs the app to be [connected](/docs/connected-apps). gmail is checked every 15 minutes. slack, github and most others arrive at once.
- **when another service calls an address.** the bot makes a webhook, and you paste its address into the other service. only you can see the address: copy it from the routine's card or from **Automations**.

## the computer has to be on

routines run inside dusk bot, wherever your bots live. this matters most on your own computer:

- if the computer is asleep, or the app is closed, nothing runs.
- while it is plugged in, the app keeps the computer from dozing off for the hour before a routine is due. you can turn that off under **Keep this computer awake for scheduled automations**. a closed lid still sleeps.
- if a run was missed by less than 12 hours, it runs once when you are back. older ones are marked as missed and are not replayed.

if you want routines to run with the laptop shut, put your bots on [dusk cloud](/docs/dusk-cloud) or on [your own server](/docs/your-own-server). that is what those are for.

## when a run needs you

a routine follows the same [permissions](/docs/permissions) as its bot. if a run reaches something it must ask about, it waits. you get a notification that names the routine, and the card says what it is waiting for.

## when a run fails

a run that trips over something passing, like the ai being busy for a moment, tries once more by itself. if it fails again you are told why, and the history in **Automations** shows what happened to every run.

if your ai plan ran out, the run does not keep retrying. you get one notification saying what to do.

## pausing and deleting

turn a routine off with its switch and it keeps its schedule for later. deleting a bot deletes its routines. deleting a group chat turns off the routines that run there.
