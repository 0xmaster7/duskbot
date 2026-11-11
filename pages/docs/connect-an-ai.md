---
title: connecting an ai
description: sign in with the ai you already use, add an api key, or point dusk bot at a model you run yourself.
section: start
order: 3
art: s-key
---

dusk bot does not ship a model of its own. every bot thinks with an ai you choose. you connect one once and every bot can use it.

## how it works

you sign in to the ai yourself, on the machine your bots run on, the same way you sign in to that ai anywhere else. when a bot works, its messages go straight from that machine to the ai provider, under your account and on your plan. they do not pass through us.

so there are two things to know:

- **your plan's limits are the limits.** a bot that works all day uses your ai plan all day.
- **the provider's rules apply.** their terms and their privacy policy cover what you send them.

## sign in with a subscription

this is the usual way. open the app and it shows the ais it can use. choose one and follow its sign-in.

{{include ui-signin}}

dusk bot works with **claude**, **chatgpt**, **gemini** and **grok**, and also with cursor, copilot, deepseek, kimi, qwen, opencode and cline. you manage them all under **Settings**, **Model providers**.

you can connect more than one. then each bot can use a different one.

## use an api key

if you would rather pay per use, add a key under **Settings**, **API keys**. you can add a key from anthropic or xai, or from any service that speaks the openai api, such as openrouter, groq or together.

- paste the key once. it saves and checks itself, and the models show up in the model picker.
- keys are stored on the machine your bots run on. after you save one, the app only ever shows that a key is set. it never shows the key again.
- api usage is billed by whoever gave you the key.

## use a model you run yourself

local models work too. start ollama or lm studio, then open a bot's model picker and choose **Use a local model**.

for any other server that speaks the openai api, add it under **Settings**, **API keys** as an openai-compatible server and give it the address. for ollama that is:

```text
http://localhost:11434/v1
```

local models can be slow to answer on a small computer. there is a setting for how long the app waits for the next words of a reply before it gives up.

## a different ai for each bot

open a bot and use its model picker. you can give your researcher one model and your code reviewer another, and change your mind at any time, even in the middle of a conversation.

{{include ui-models}}

when you swap a bot's model, the bot keeps its chats, its files and its memory. only the thinking changes.

## limits and usage

**Settings**, **Usage** shows how much of your plan you have used, once a signed-in plan like claude or chatgpt reports it. api keys and local models have no limit to show there.

if a bot stops because your plan ran out, it says so in the chat. wait for the limit to reset, or switch that bot to another ai and carry on.

## on a server or a cloud computer

when your bots live on [your own server](/docs/your-own-server) or on [dusk cloud](/docs/dusk-cloud), the ai is signed in there, not on your laptop. the app walks you through it from your own computer, so you never type a password on the server.
