---
title: memory
description: every bot keeps notes on how you like things done. the notes are plain files you can read, edit and delete.
section: bots
order: 3
art: s-notebook
---

a bot remembers between conversations. tell it once that you only fly in an aisle seat, and next month it still knows. it does this by keeping notes, and the notes are yours.

{{include ui-notes}}

## what a bot remembers

- **what you tell it to.** "remember that dana signs off on anything over €500."
- **what it notices.** when a chat goes quiet, the bot looks back over it and writes down new facts worth keeping: a preference, a decision, who is who. a note it picked up this way is marked as noticed.
- **what it did.** a short daily log of its work, in its own words. the log is for you to read. it is not loaded into conversations.

a bot is careful about what counts as a fact about you. a question you asked or a task you gave it is not treated as a preference.

## read and edit the notes

open a bot's settings and choose **Memory**. you see every note, and you can:

- tap a note to forget it
- type into **Tell [name] something to remember** to add one
- edit the notes directly
- undo any change from the list of recent changes

the same panel has **Show in Finder** and **Open in Obsidian** (or your file manager on windows and linux), because the notes are ordinary markdown files in a folder:

```text
.duskbot/workspaces/<bot>/
  MEMORY.md        the notes that load into every conversation
  memory/
    <topic>.md     longer notes the bot reads when it needs them
    archive.md     older notes that were moved out
    log/           what the bot did, one file a day
```

you can open them in any editor. nothing about a bot's memory is stored anywhere except the machine the bot runs on.

## what loads into a conversation

the first 200 lines of `MEMORY.md` (or the first 24 kb, whichever comes first) are given to the bot at the start of every turn. the memory panel shows a gauge of how full that is.

you do not have to prune it. when a new note would push the file past its budget, the oldest notes move to `archive.md` on their own. notes you wrote by hand stay put.

longer notes on one subject live in their own topic file. before each reply, the bot looks through those files and its other conversations for anything that matches what you just asked, and reads the best few.

## notes that expire

some facts stop being true. a note can carry an end date ("until 2026-09-28"), and it stops loading the day after. birthdays and other yearly dates never expire.

## secrets stay out

anything that looks like a password, an api key or a token is blanked out before a note is saved. a bot that reads a key in a file does not get to keep it in its memory.

## turning memory off

the **Let this bot use memory** switch is on by default. turn it off and the bot stops loading its notes, stops adding to them and stops searching them. the files stay on disk for you.

## group chats

a bot does not learn from group chats unless you turn on **Learn from group chats**, which is off by default. when it is on, what you say in a group counts as yours, and what another bot says only counts if it is something that was checked or that you agreed to.

## about me

things every bot should know about you go in **About me** in settings, not in one bot's memory. see [bots](/docs/bots#telling-every-bot-about-you).
