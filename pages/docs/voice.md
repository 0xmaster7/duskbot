---
title: voice and calls
description: have a bot read its replies aloud, talk to it instead of typing, or call it and have a conversation.
section: bots
order: 5
art: s-phone
---

bots can talk. you can listen to what ran overnight while you make breakfast, or call a bot and talk a problem through.

## hear a reply

press the speaker on any reply and the bot reads it to you. you can also switch a bot to read every answer aloud as it arrives.

a reply is tidied up before it is spoken. the bot says the words and names the files, and skips the code and the punctuation that only make sense on a screen.

## call a bot

choose **call** and it becomes a conversation. the bot hears you, tells you what it is doing while it works, and asks for approvals out loud.

while you are on a call:

- hold the talk key to speak. you choose the key in settings.
- [[Space]] interrupts the bot.
- [[Esc]] hangs up.

## pick a voice

open a bot's settings and look for **Voice & alerts**. give each bot its own voice and a group chat stops sounding like one person.

voices come from one of these:

| voice | what it needs |
| --- | --- |
| built-in mac voices | nothing. they are part of macos. |
| elevenlabs | an elevenlabs api key |
| fish audio | a fish audio api key |
| grok (xai) | an xai api key |
| chatterbox | a chatterbox server you run yourself |

you paste a key once and every bot can use it. like every other key, it is stored on the machine your bots run on and is never shown again.

## talk instead of typing

the microphone in the message box turns what you say into text.

- **on a mac** it listens on the device, with apple's own speech recognition. nothing is sent anywhere.
- **on windows and linux** it uses fish audio's speech-to-text, with the same fish audio key as the voices.

> note: speech costs are billed by whichever voice service you chose, on your own key. the built-in mac voices and a local chatterbox server cost nothing.
