---
title: privacy and where data lives
description: where your bots, chats, files and memory are stored, what leaves your machine, and how to back up or delete everything.
section: account
order: 3
---

the short version: your things live where your bots live. on your own computer or server, that means with you. this page is the plain-words map. the [privacy policy](/privacy) is the formal one.

## where things are stored

| your bots live | bots, chats, files, memory and settings are |
| --- | --- |
| on your computer | on your disk, in the `.duskbot` folder in your home folder |
| on your own server | on that server |
| on dusk cloud | on your cloud computer, which we host |

dusk cloud is the one case where your content sits on a machine we run. that is what you are choosing when you pick it.

## what leaves your machine

a bot is only useful if it can reach things. here is everything that travels, and to whom.

| what | goes to | why |
| --- | --- | --- |
| what you say to a bot, and its replies | the ai provider you signed in to | so the ai can think. it goes straight from the machine your bots run on to them. it does not pass through us. |
| what a bot does in a connected app | that app, by way of our relay and composio | so the bot can read your calendar or draft the email. |
| a notification for your phone | apple or google, through our push relay | so your phone buzzes. it carries the bot's name, never the message. |
| traffic between your app and your own server | our link relay, sealed | so they can find each other. only your app and your server hold the key, and the relay cannot read it. |
| counts and states, if you link a workspace | your account | so the dashboard can show it. never messages, files or keys. |

your ai provider's own privacy policy covers what they do with what your bots send them. read it before you send anything confidential.

## keys and sign-ins

api keys and sign-ins are kept on the machine your bots run on. after you save a key, the app shows only that one is set.

a bot's [memory](/docs/memory) blanks out anything that looks like a password or a key before saving a note.

## the optional account

if you make an [account](/docs/account), we store your email address and the things you would expect: your sessions, your linked workspaces and your plan. payments are handled by dodo payments, and we never see your card number.

the website and the account use only the cookies they need to keep you signed in. there are no advertising or tracking cookies.

## backups

you can take everything with you.

1. open **Settings**, **Backups**.
2. choose **Export full backup** and give it a password of at least 12 characters.
3. keep the file and the password somewhere safe. without the password the backup cannot be opened, by you or by us.

the backup holds your bots, conversations, instructions, files and settings. it does not hold your sign-ins or keys. on a new machine you connect your ai and your apps again.

to restore, choose **Import backup** on the new machine. the app checks the file and shows what is in it before it changes anything.

> careful: restoring a backup replaces everything in that installation. it does not merge. routines arrive paused, so nothing fires before you have looked.

## deleting things

- **a bot:** delete it from the sidebar. its chats and routines go with it.
- **everything on your computer:** remove the app and delete the `.duskbot` folder.
- **a server:** run the uninstall line from [your own server](/docs/your-own-server#removing-it).
- **your account:** use **Delete account** on the account page. see [your account](/docs/account#delete-your-account).
- **a cloud computer:** it is deleted a limited time after its plan ends.

deleting things with us does not delete what your ai provider or a connected app holds. those are their records, and you ask them.

## asking us

to see, correct or delete what we hold about you, write to privacy@dusk.bot. to report a security problem, write to security@dusk.bot and see the [security page](/security).
