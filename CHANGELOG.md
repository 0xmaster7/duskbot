# Changelog

Notable changes to dusk bot, newest first. Installers and checksums for each version are on the
[releases page](https://github.com/DuskBotAI/duskbot/releases) and at [dusk.bot/download](https://dusk.bot/download).

## 0.2.4

- When the free backup model has used up its free replies, the chat says so within seconds and suggests connecting your
  own AI, instead of trying other free models that share the same limit.
- A free backup model that answers with nothing counts as no answer: the next free model gets the message, and if none
  answers, the chat says so plainly.

## 0.2.3

0.2.1 and 0.2.2 were own-server packages only; this is the first version on every line since 0.2.0.

- A new person's first message always gets an answer: a free backup model that sends nothing in 25 seconds hands the same
  message to the next free model, and if none answers, the chat says so plainly and what to do.
- Every account step goes to your browser for its context: sign in or make your account there, then land on your plan's
  checkout, billing or home, and the app signs itself in and goes on by itself (coming back to the app is optional).
- Moving a server's bots to dusk cloud while signed out no longer stops at "sign in on this Mac's own page first".
- Linking your own server while signed out signs you in in the browser, then shows the install line by itself.
- The install line stops with a plain message when a download fails, and every download retries, falling back to IPv4.
- A sleeping cloud says it is asleep instead of "waking up".

## 0.2.0, first light

The first public release. dusk bot is your own crew of AI helpers: each bot gets a job, a chat and a computer of its own,
and works on the Claude, ChatGPT, Gemini or Grok you already use. Free for personal use, with no account and no card.

### Bots

- Give each bot one job in plain words, and run as many as you like at once, each with its own chat, files and memory.
- Memory you can read and edit: a bot keeps notes on how you like things done, and every note says where it came from.
- Routines: ask once, and it runs on a schedule or the moment something happens.
- Rooms: put several bots in one thread to hand work to each other; they ask you before anything big.
- Bring the AI you already pay for (Claude, ChatGPT, Gemini, Grok, Cursor, Copilot, DeepSeek and more), an API key, or a
  model you run yourself. Use a different model for each bot and swap any time.

### Computer

- Every bot gets a browser and a desktop of its own to sign in to and click through.
- Watch it work live and take the mouse back whenever you like.
- The live screen connects straight to your bot when it can, with a relay through Cloudflare as a backup.

### Phone

- Text your bots from your iPhone or Android: scan a code on your computer to pair.
- Answer questions, approve things and hear when a bot is done.
- The phone app runs in your phone's browser for now; App Store and Google Play listings come later.

### Connectors

- Plug bots into 60+ apps, including GitHub, Google Drive, Notion, Linear, Airtable, Todoist, ClickUp, Trello and Dropbox.
- One-click sign-in for the apps that support it.

### dusk cloud

- Free keeps your bots on your own computer. dusk cloud (Plus and Pro) runs them on a machine we host, so they keep
  working with your laptop shut.
- Or run the server on your own VPS with one line.

### Privacy

- Your bots, chats and memory live on your computer, or your own cloud machine.
- Logins you save are filled in for your bot and never shown to it.
- Bots ask before the risky stuff: sending, paying, deleting.

### Platforms

- macOS 12 or later (Apple silicon and Intel), Windows 10 or 11 (64-bit), Ubuntu 24.04 (64-bit, beta).
- The macOS build is not notarized yet and the Windows build is unsigned, so each shows a one-time security prompt.
