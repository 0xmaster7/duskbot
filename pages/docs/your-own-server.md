---
title: your own server
description: keep your bots on a server you rent. paste one line and it installs everything and links itself to your app.
section: where
order: 3
art: s-server
---

if you rent a server, your bots can live there and stay on around the clock. it is free: you pay only for the server. setting it up is one pasted line.

## what you need

- a server running **ubuntu 22.04 or 24.04**, with **2 gb of memory or more**. more memory means more bot computers awake at once.
- a way to run a command on it as root or as a user who can use `sudo`.
- the dusk bot app on your computer.

you do not need to open any ports, set up a domain or install anything first. a fresh server is best. give bots a server of their own, not one that also holds things you would not hand to them.

## set it up

1. in the app, open the menu at the top of the sidebar, choose **Add a Cloud or your own server**, and pick your own server.
2. the app shows one line. it works once and for a limited time.
3. log in to your server, paste the line and press return.
4. watch the app. it shows each step as the server sets itself up.

{{include ui-server}}

the whole thing takes about ten minutes and asks you nothing. it checks the server, installs docker and node, makes a home for your bots, installs dusk bot, starts it, finds a way for your app to reach it, and gets the bot computer ready.

when it is done, the app asks you to sign in to your ai. you do that on your own computer and it is passed to the server privately, so you never type a password on the server. then the app offers to move your bots over.

## if something goes wrong

- **a step failed:** paste the same line again. it is safe to run twice and picks up where it stopped.
- **the line ran out of time:** ask the app for a new one.
- **you closed the app:** open it again. the server keeps going, and the app catches up.

## read it before you run it

piping a script into a shell deserves a second look. the installer is a plain file you can read first:

```sh
curl -fsSLo install.sh https://dusk.bot/install.sh
curl -fsSL https://dusk.bot/install.sh.sha256
shasum -a 256 install.sh
less install.sh
```

the two fingerprints should match. the line the app shows you runs this same script with your one-time code. the script only talks to https addresses and checks the fingerprint of everything it downloads.

## how your app reaches the server

your app and your server talk through a small relay at `link.dusk.bot`. everything they say to each other is sealed with a key that only your app and your server hold, so the relay passes along packages it cannot open.

where it can, the app also opens a direct line to your server and uses the relay only as a fallback. you do not configure any of this, and nothing new is opened on the server.

## bot computers on your server

each bot can have its own private desktop on your server, with a browser it signs in to. you can watch it and take control from the app, the same as [any bot computer](/docs/computer).

- a desktop nobody is using goes to sleep after about ten minutes and wakes when a bot needs it.
- how many can be awake at once depends on the server's memory. a server with 12 gb keeps about six awake.
- desktops are not published to the internet. you see them through the app.

## looking after it

it is your server, so updates to ubuntu, backups of the disk and the bill are yours. dusk bot runs as a service and starts again by itself after a reboot.

## removing it

to take dusk bot off a server:

```sh
curl -fsSL https://link.dusk.bot/uninstall | sh
```

move your bots back to your computer first, or export a [backup](/docs/privacy-and-data#backups), if you want to keep them.
