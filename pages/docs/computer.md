---
title: a bot's computer
description: a bot can have its own browser and desktop. watch it work, take the mouse whenever you like, and decide what it asks first.
section: using
order: 7
art: s-computer
---

some jobs need a screen: holding a fare, filling in a form, checking a dashboard with no api. so a bot can have a computer of its own, separate from yours.

{{include ui-computer}}

## where it is

on [dusk cloud](/docs/dusk-cloud) each bot gets a desktop on your cloud (2 awake at once on plus, 5 on pro). on [your own server](/docs/your-own-server) it's a private desktop there. on a mac you can also point a bot at your own screen, on purpose.

a computer nobody is using goes to sleep and wakes when a bot needs it.

## watch and take over

open the bot's panel and choose **Screen** to watch live. choose **Take control** to click and type yourself, then **Hand control back**.

this is how you get a bot past things only you should do: a sign-in, a captcha, a two-step code. the bot stays signed in afterwards and never sees the password.

## asking first

a bot stops and shows a card before anything risky. you choose **Allow** or **Deny**, from the app, your phone or a call.

{{include ui-approval}}

how much it may do without asking is up to you, per bot:

| level | what the bot does on its own |
| --- | --- |
| **Ask for approval** | nothing risky. asks before commands and file changes. |
| **Auto-accept edits** | changes files. other things still ask. |
| **Approve for me** | the ai's own review approves routine actions; the rest come to you. |
| **Full access** | everything. real questions and missing sign-ins still come to you. |

sending in your name (emails, posts, payments) is separate: **Ask every time**, or **Allow a daily amount**.

for what can go wrong and the checks worth making with any tool like this, see [is it safe to let ai control your computer?](/guides/is-it-safe-to-let-ai-control-your-computer)

> careful: you're responsible for what you approve. read the card before you tap **Allow**, especially when it sends, buys or deletes. [[⌘ .]] stops a bot at any moment.
