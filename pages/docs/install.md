---
title: install
description: macos, windows and linux: what you need, how to install, how updates work and how to remove it.
section: start
order: 2
art: s-parcel
---

the app is one download for each system, from [the download page](/download). it brings everything it needs with it. you do not install node, docker or anything else to run it on your own computer.

## mac

you need macos 12 or later. there is one build for apple silicon and one for intel.

1. open the `.dmg` you downloaded.
2. drag dusk bot into your applications folder.
3. open it from applications.

the mac app is signed and notarized.

## windows

you need windows 10 or 11, 64-bit.

1. run `DuskBot-setup.exe`.
2. it installs for your user only, so it does not ask for an admin password.
3. open dusk bot from the start menu.

> note: if windows shows a blue "windows protected your pc" box the first time, choose **More info**, then **Run anyway**.

## linux

you need ubuntu 24.04, 64-bit, with the gnome desktop. linux is still in beta.

the `.deb` is the one we recommend. it installs what the app needs and sets up the sandbox for the bots' browser:

```sh
sudo apt install ./DuskBot-amd64.deb
```

or run the appimage, which installs nothing on your system:

```sh
chmod +x DuskBot.AppImage
./DuskBot.AppImage
```

two things work differently on linux today:

- a bot can control this computer only on an xorg session, and only after you switch that on. on wayland a bot can be shown your screen when you choose to share it, but it cannot click or type.
- dictation and calls use a fish audio key for speech, where the mac listens on the device. see [voice and calls](/docs/voice).

chat, routines, connected apps, cloud computers and your own server all work the same.

## updates

the app looks for a new version once a day and tells you when there is one. nothing installs by itself. the note opens [the download page](/download), and you install the new version over the old one. your bots, chats and settings stay where they are.

you can see what changed in [what's new](/changelog), and which version you have under **Settings**, then **About**.

## where it keeps things

on your own computer, everything dusk bot stores lives in one folder called `.duskbot` in your home folder: bots, chats, memory, settings. [privacy and where data lives](/docs/privacy-and-data) has the whole picture.

## removing it

- **mac:** quit the app and drag it from applications to the trash.
- **windows:** remove dusk bot from **Settings**, **Apps**.
- **linux:** remove the package you installed, or delete the appimage.

removing the app leaves the `.duskbot` folder alone, so a reinstall picks up where you left off. delete that folder too if you want everything gone. make a [backup](/docs/privacy-and-data#backups) first if you might want it back.

## checking a download

every release lists the sha-256 fingerprint of each installer. [the download page](/download#verify) shows the command for each system.
