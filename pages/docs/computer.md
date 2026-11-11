---
title: a bot's computer
description: a bot can have its own browser and desktop to sign in to and click through. watch it live, and take the mouse back whenever you like.
section: doing
order: 2
art: s-computer
---

some jobs cannot be done with words alone. holding a fare, filling in a form, checking a dashboard that has no api: these need a screen. so a bot can have a computer of its own.

{{include ui-computer}}

## what it is

a bot's computer is a real desktop with a browser. the bot looks at the screen, moves the pointer, types, and reads what comes back, the same way you would. it is separate from your own desktop, so a bot can work there without getting in your way.

## where the computer is

this depends on [where your bots live](/docs/where-bots-live).

| your bots are | a bot's computer is |
| --- | --- |
| on dusk cloud | a bot computer on your cloud. plus runs two at a time and pro runs five. |
| on your own server | a private desktop for each bot on that server. |
| on your computer | a cloud or server desktop if you have one. on a mac, a bot can also be pointed at this computer itself. |

letting a bot use your own computer is a bigger step than giving it one of its own, because it is your real desktop. on a mac you choose it for a bot on purpose. on ubuntu it works on an xorg session after you switch it on, and it is off on wayland.

## watch it work

open the bot's panel and choose **Screen**. you see the bot's desktop live while it works. the same picture shows up in the chat when the bot takes a screenshot of what it did.

the panel has more tabs: **Browser** for the bot's browser, **Files** for what it has made, and **Routines** for its schedules.

## take the mouse

you can step in at any moment.

1. choose **Take control**.
2. click and type on the bot's desktop yourself. while you have it, the bot's own clicks and keystrokes are refused.
3. choose **Hand control back** when you are done.

this is how you get a bot past the things only you should do: a sign-in, a captcha, a two-step code.

if you take over a bot's browser and then walk away, control goes back to the bot by itself after five minutes without input.

## signing in to websites

a bot stays signed in on its own computer, the way you stay signed in on yours. to sign it in somewhere:

1. ask the bot to open the site, or open it yourself from the **Browser** tab.
2. choose **Take control** and sign in.
3. hand control back.

the bot never needs to know the password. if you use 1password, you can also let bots use logins from one vault you choose, under **Settings**, **Logins**.

## asleep and awake

a computer nobody is using goes to sleep, and wakes when a bot needs it. waking takes a moment. on the pro plan your bot computers are first in line to wake.

a bot only wakes its computer when the task needs a screen. a quick question does not.

## several chats, one screen

a bot has one desktop, even if it has several conversations going. the first conversation that reaches for the screen gets it. another that needs it shows a line saying it is waiting for its turn, and carries on by itself when the screen is free.

## is this safe?

a bot with a computer follows the same [permissions](/docs/permissions) as it does everywhere else, and it asks before the scary stuff. you can watch at any time, take over at any time, and stop the bot with [[⌘ .]].
