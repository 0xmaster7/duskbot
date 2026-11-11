---
title: memory
description: bots remember how you like things done. the notes are plain files you can read, edit and delete.
section: using
order: 5
art: s-notebook
---

tell a bot once that you only fly aisle, and next month it still knows. it keeps notes, and the notes are yours.

{{include ui-notes}}

## what a bot remembers

- **what you tell it to.** "remember that dana signs off on anything over €500."
- **what it notices.** when a chat goes quiet it writes down new facts worth keeping: a preference, a decision, who is who. those are marked as noticed.
- **what it did.** a short daily log, for you to read.

anything that looks like a password or a key is blanked out before a note is saved.

## see and change the notes

open a bot's settings and choose **Memory**. tap a note to forget it, type a new one in, or edit them directly; every change can be undone. the notes are markdown files in `.duskbot/workspaces/<bot>/`, so **Open in Obsidian** works too.

old notes move to an archive by themselves when the list gets long. a note can carry an end date ("until 2026-09-28") for things that stop being true.

## tips

- **correct it out loud.** "that's wrong, dana left. it's sam now." it updates the note.
- **put shared things in About me.** your name, time zone and how you like to be written to go in **Settings**, **About me**, and every bot gets them.
- **bots don't learn from group chats** unless you turn on **Learn from group chats** for that bot.

to stop a bot remembering, turn off **Let this bot use memory**. the files stay on disk.
