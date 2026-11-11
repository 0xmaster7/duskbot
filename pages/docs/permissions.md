---
title: permissions and safety
description: the scary stuff. what a bot may do without asking, what it must ask about, and how you stay in charge.
section: doing
order: 3
art: s-button
---

a bot that can click, type and send things for you needs rules. dusk bot has two: how much a bot may do without asking, and whether it may send things in your name.

## the approval card

when a bot reaches something it has to ask about, it stops and shows a card in the chat. you choose **Allow** or **Deny**, and the bot carries on or does something else.

{{include ui-approval}}

for some requests you can also allow that exact thing from now on, so a bot stops asking about a command it runs every day. the grant is narrow: it covers that one command or tool, not everything like it.

approvals reach you wherever you are. they show in the app, on your [phone](/docs/phone) with a notification, and out loud if you are on a [call](/docs/voice).

## approval levels

every bot has an approval level. it decides what the bot does without asking.

{{include ui-levels}}

| level | what the bot does |
| --- | --- |
| **Ask for approval** | asks before it runs a command or changes a file. |
| **Auto-accept edits** | changes files without asking. other actions can still ask. |
| **Approve for me** | the ai's own automatic review approves routine actions and asks you about the rest. |
| **Full access** | does commands, edits and computer actions without asking. real questions and missing sign-ins still come to you. |

not every ai offers every level. where an ai has no automatic review, **Approve for me** behaves like **Ask for approval**, and the app tells you so.

### changing the level

- **for a bot:** open its settings. the level applies to the bot and all of its conversations.
- **for one conversation:** use the level control by the message box.
- **for a whole department:** if you sort your bots into departments in the sidebar, a department's menu has **Set for all bots in this department**. it shows you what each bot will get before anything changes.

you can change the level while a bot is working. it applies from the bot's next step where its ai allows that, and otherwise from its next turn.

## sending on your behalf

sending is treated separately, because a sent email cannot be unsent. this covers emails, messages, posts, invites and payments made through [connected apps](/docs/connected-apps). reading and drafting never count.

{{include ui-sending}}

- **Ask every time:** every send waits for your tap.
- **Allow a daily amount:** sends go out on their own, up to a cap you set. after that, the bot asks.

you set this for each bot, in its permissions.

## what a bot never needs to ask about

a bot can always read its own things: its job, its notes and its own conversation folders. that is its own notebook, not yours.

## what no level can do

even **Full access** is only about approval prompts. it does not:

- sign in for you, or get past a captcha or a two-step code
- get around your operating system's privacy settings
- give a bot access to an app you did not connect, or to someone else's workspace
- turn on a feature you turned off

## staying in charge

- **stop:** [[⌘ .]] stops the bot you are looking at. [[⌥ ⌘ .]] stops all of them.
- **watch:** a bot's [computer](/docs/computer) is live on your screen whenever you want to look.
- **take over:** **Take control** hands you the mouse, and the bot's own clicks are refused until you hand it back.
- **limit what it can reach:** a bot can only use the apps you connected and allowed for it.

> careful: you are responsible for what your bots do and for what you approve. read a card before you tap **Allow**, especially when it sends, buys or deletes.
