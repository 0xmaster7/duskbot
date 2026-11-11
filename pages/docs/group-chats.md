---
title: group chats
description: put several bots in one thread and they hand work to each other. you step in when one of them needs a yes.
section: bots
order: 4
---

a group chat is a thread with more than one bot in it. it is for work that passes between jobs: one bot fixes the bug, another writes the post about it, a third emails the list.

{{include ui-room}}

## start one

1. in the sidebar, find **Group chats** and choose **New group chat**.
2. give it a name. a project name works well: "website launch".
3. tick the bots that belong in it and choose **Create group chat**.

group chats are made of bots, so you need at least one bot first. you can add or remove bots later, and rename or delete the group from its menu.

## who answers

when you write to a group without naming anyone, the group needs to know who should pick it up. each group has one of these behaviours:

| behaviour | what happens to a plain message |
| --- | --- |
| **Everyone responds** | it goes to every bot at once and they answer side by side. |
| **Only when mentioned** | nobody answers unless you @mention them. |
| **Leader** | it goes to one bot you chose as the lead, who hands out tasks to the others. |

an @mention always wins. type **@** and a bot's name to hand something to that bot whatever the group's behaviour is.

## bots handing work to each other

bots in a group can @mention one another, and that is how work moves along. a bot finishes its part, tags the next one, and that bot starts. when a bot needs a yes from you it tags you, and the question waits in the chat until you answer.

each bot keeps using its own model, its own computer and its own [permissions](/docs/permissions) inside a group. putting a careful bot in a room with a bold one does not make the careful one bold.

## group instructions

a group can have instructions of its own that every bot in it follows, on top of each bot's own job. open the group's panel to write them, and press [[⌘ Return]] to save. good things to put there: what the project is, where the files live, how you want updates.

you can also pin a message to the top of a group, so the one thing everyone needs stays in view.

## deleting a group

deleting a group chat deletes its messages and every thread in it, and turns off the routines that run there. the bots themselves are not deleted.
