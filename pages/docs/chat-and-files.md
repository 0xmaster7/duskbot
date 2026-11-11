---
title: chatting and files
description: texting a bot, stopping or steering it while it works, sending it files, and finding what it made.
section: bots
order: 2
---

you talk to a bot the way you text a person. type what you need and press [[Return]]. there is no special syntax to learn.

## while a bot works

a reply streams in as it is written. when the bot uses a tool, runs a command or opens a page, the chat shows a small line saying so. you can open it to see what happened.

you do not have to wait for it to finish:

- **send another message.** a message you send while the bot works either steers it, so it reads your message and adjusts, or waits in a queue until the bot is done. one of the two is the default, and [[⌘ Return]] does the other.
- **stop it.** [[⌘ .]] stops the bot in the open chat. [[⌥ ⌘ .]] stops every bot.
- **fix your last message.** with the box empty, press [[↑]] to edit the last thing you sent.

on windows and linux, use [[Ctrl]] where the mac uses [[⌘]].

## when a bot asks you something

sometimes a bot needs a yes before it goes on: to send an email, run a command, or change a file. the question shows as a card in the chat with **Allow** and **Deny**. the bot waits until you answer.

{{include ui-approval}}

how often a bot asks is up to you. see [permissions and safety](/docs/permissions).

## sending files and pictures

drop a file onto the chat, or use **Attach files** in the message box. the bot can read documents, look at pictures and work with what you give it.

## what a bot makes

when a bot writes a report, a spreadsheet or code, the chat shows the file and you can open it from there.

where the file itself lives depends on [where the bot lives](/docs/where-bots-live):

- **on your computer:** in the bot's own folder on your disk. you can also give a bot a project folder to work in.
- **on dusk cloud:** on your cloud computer, and a copy comes down to `Documents/Dusk Bot`, in a folder for each bot and conversation. see [dusk cloud](/docs/dusk-cloud#files).
- **on your own server:** on the server.

## more than one conversation

a bot can keep several threads, so a long project does not bury a quick question. each thread has its own history. the bot's memory and job are shared across all of them.

## finding things

- [[⌘ F]] finds text in the conversation you have open.
- [[⌘ K]] opens the switcher. it jumps to any bot or group chat, and it searches what was said across all of them.

## reading replies aloud

press the speaker on any reply to hear it, or call a bot and talk. see [voice and calls](/docs/voice).
