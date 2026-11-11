---
title: connected apps
description: plug your bots into gmail, slack, github, notion and 60+ other apps, or add any mcp server yourself.
section: doing
order: 4
art: s-plug
---

a connected app lets a bot work inside a tool you already use: read the inbox, check the calendar, open the pull request, update the page. you connect an app once, and choose which bots may use it.

## connect an app

1. open **Connected apps** in the sidebar.
2. find the app and choose to connect it.
3. sign in to that app and approve what it asks for. this is the app's own sign-in page, so your password goes to them, not to a bot.

there are 60+ apps to start with, including:

<p class="chips">{{chips gmail calendar drive docs sheets slack notion github linear figma stripe discord hubspot airtable asana trello dropbox outlook shopify sentry vercel supabase posthog zapier}}</p>

## choose which bots may use it

connecting an app does not hand it to every bot. each bot has a switch for connected apps in its access settings, and you pick what it can reach. your bookkeeper does not need your slack.

## what a bot does with an app

anything you could ask a teammate with access to do:

- "what is on my calendar tomorrow, and is there time for lunch?"
- "find the latest invoice from acme in my email and file it in drive."
- "open an issue in linear for the checkout bug and assign it to me."

reading and drafting happen freely. **sending** is different: emails, messages, posts and payments follow the bot's [sending on your behalf](/docs/permissions#sending-on-your-behalf) setting.

## start a routine from an app

a connected app can also wake a bot up. "whenever i get an email from acme, draft a reply." "when a github issue opens, triage it." these are [routines](/docs/routines#when-something-happens) that start from something happening in an app instead of from a clock.

## mcp servers

if a tool you use is not on the list, you can add it yourself as an mcp server. mcp is an open way for ai apps to use tools, and many services now offer one.

1. open **Plugins**, then **MCP servers**, and choose **Add server**.
2. paste what you were given into the one box. it understands a link to the server, a `claude mcp add` command, an `npx`, `uvx` or `docker run` line, or a block of `mcpServers` json.
3. the app works out the name and the connection, and asks only for what is missing, such as a key.
4. choose **Add**. the app connects, lists the server's tools and turns it on: "connected: 12 tools".

a server that does not answer stays off and tells you why. if it wants you to sign in, its sign-in page opens.

two kinds of server work:

- **a url:** a server that runs somewhere else. if it needs a token, that goes in a header, never in the address.
- **a command:** a server that runs on the machine your bots run on.

keys you type for an mcp server are write-only, like every other key: typed like a password and never shown again.

> careful: only add an mcp server you trust. its tools run with whatever access you give them, and a bot will use them.

## disconnecting

disconnect an app from **Connected apps** and bots lose it at once. remove an mcp server and its saved keys are deleted with it.

## where the connection is kept

app sign-ins are held by composio, the service dusk bot uses for connected apps. when a bot uses an app, that request travels through a dusk bot relay to composio and on to the app. the [privacy policy](/privacy) has the details.
