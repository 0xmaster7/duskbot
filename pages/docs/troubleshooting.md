---
title: troubleshooting
description: the things that go wrong most often, and what to do about each.
section: help
order: 1
art: s-signpost
---

find the line that sounds like your problem. if none does, write to hello@dusk.bot and say what you were doing, your system, and your version (**Settings**, then **About**).

## getting started

### the app says "connect an ai to get started"

dusk bot has no model of its own, so it needs one ai set up before any bot can answer. choose one from the list on that screen and sign in. [connecting an ai](/docs/connect-an-ai) covers subscriptions, api keys and local models.

### windows says it "protected your pc"

choose **More info**, then **Run anyway**. this is windows being careful with an installer it has not seen often.

### on linux, a bot cannot control my computer

a bot can only click and type on your own desktop in an xorg session, and only after you turn that on. on wayland it is switched off. log in with xorg, or give the bot a [computer of its own](/docs/computer) on a cloud or a server.

## bots

### a bot does not answer

check these in order:

1. **is its ai signed in?** open **Settings**, **Model providers**. a sign-in can expire.
2. **has your plan hit its limit?** **Settings**, **Usage** shows it. wait for the reset, or switch the bot to another ai.
3. **is it waiting for you?** scroll up. there may be an approval card it is waiting on.
4. **is it stuck?** press [[⌘ .]] to stop it and send your message again.

### a bot keeps asking for permission

that is its approval level. open the bot's settings and choose a different one. see [permissions and safety](/docs/permissions#approval-levels).

### a bot forgot something i told it

open its settings and look in **Memory**. if the note is not there, tell the bot to remember it, or add it yourself. if memory is switched off for that bot, turn **Let this bot use memory** back on. see [memory](/docs/memory).

### a bot says it is waiting for its turn on the computer

a bot has one screen, and another of its conversations is using it. it carries on by itself when the screen is free. if you took control of the computer, hand it back.

## routines

### a routine did not run

routines run inside the app, so the usual cause is that the app was closed or the computer was asleep.

- a run missed by less than 12 hours runs once when you are back. older ones are marked as missed.
- open **Automations** and look at the routine's history. it says what happened to each run.
- a run may be waiting for an approval. the routine's card says what it is waiting for.

for routines that must run on time, put the bot on [dusk cloud](/docs/dusk-cloud) or [your own server](/docs/your-own-server).

### a routine ran at the wrong time

every routine has a time zone. ask the bot "what time zone is this routine in?" and tell it the one you want.

## connected apps

### an app stopped working

sign-ins to apps expire or get revoked. open **Connected apps**, disconnect the app and connect it again.

### a bot says it cannot use an app

the app may not be allowed for that bot. open the bot's access settings and check its connected apps.

### an mcp server stays off

it failed its test. the row says why: it could not be reached, it timed out, or it refused the keys. fix that and choose **Try again**.

## your phone

### my phone cannot connect

- the computer it is paired with has to be on, awake and running dusk bot.
- if you removed the device, pair it again.
- on the same wi-fi but still nothing? some networks stop devices seeing each other. use the default **Secure HTTPS pairing**.

### i do not get notifications

the home screen version of the app does not send notifications. the phone app from the store does, once you allow them when it asks.

## your own server

### the install stopped half way

paste the same line again. it is safe to run twice and picks up where it stopped.

### the line does not work any more

each line works once and for a limited time. ask the app for a new one.

### my app cannot reach my server

check that the server is running and online. the app reaches it through a relay, and by a direct line where it can, so no ports need opening. if the server was rebuilt or its disk was wiped, set it up again.

## dusk cloud

### my cloud says "setting up" for a long time

it usually takes about a minute. if it is still setting up after ten, write to hello@dusk.bot from the email on your account.

### the app asks me to sign in to the cloud again

sign-ins last a set time. choose **Sign in again**. your plan is not affected.

## still stuck

write to hello@dusk.bot. a person reads it. the app's own menu also has **Help and support** and **Send Feedback**.
