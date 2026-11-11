---
title: the phone app
description: text your bots from anywhere. pair your phone with your computer, your server or your cloud by scanning a code.
section: where
order: 4
art: s-mobile
---

your phone is a window onto your bots. the bots keep running where they live, and the phone lets you text them, answer their questions and get told when they are done.

## what you can do from your phone

- read and send messages, to bots and in group chats
- see a reply arrive as it is written
- stop a bot
- answer approvals and questions, so a bot is not stuck waiting for you to get back to your desk

## pair your phone

you pair once, by scanning a code. your phone does not need an account.

1. on your computer, open the menu under your name and choose **Connect your phone**.
2. choose where to connect: **to this computer**, or **to the Cloud** if you have one.
3. scan the code with your phone's camera.
4. check the computer's name on the phone and confirm.

> note: the phone app is on its way to the app store and google play. until it is there, the code opens dusk bot in your phone's browser, and you add that page to your home screen. it then opens like any other app. the steps are below.

### add it to your home screen

- **iphone:** in safari, open the share menu and choose **Add to Home Screen**.
- **android:** in chrome, open the menu and choose **Install app** or **Add to Home screen**.

if the home screen app asks you to pair again, scan a fresh code. the home screen version does not send notifications and needs a connection to work.

## other ways to pair

if scanning is not possible, the same screen has other routes:

{{include ui-pair}}

- **a code:** type a six-digit code shown on the computer.
- **nearby:** pick your computer from a list when both are on the same wi-fi. use this only on a network you trust.
- **tailscale:** if you already use tailscale, pair over your own private network.

the default is **Secure HTTPS pairing**. it is the simplest, and it keeps working when your phone leaves the wi-fi.

## your computer has to be awake

if your phone is paired with your computer, that computer has to be on, awake and running dusk bot. a sleeping laptop cannot answer your phone.

**Settings**, **Remote access** has a switch, **Keep this computer awake**, that stops it sleeping while phone access is on. the screen may still turn off.

if you want your phone to work when your computer is off, pair it with [dusk cloud](/docs/dusk-cloud) or [your own server](/docs/your-own-server) instead.

## notifications

the phone app from the store sends notifications. when it is closed or in the background, a reply, a question or an approval reaches you as a notification. it shows the bot's name and "new message". the text of the message is not in it, and the service that delivers it never sees the text.

while the app is open it shows the message itself, so nothing buzzes twice. the home screen version does not send notifications.

## manage paired devices

**Settings**, **Remote access** lists every device you have paired, and when each was last seen. remove one and it loses access at once. it would have to be paired again.

for each device you can also decide whether it may look at a bot's screen.
