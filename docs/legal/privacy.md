> **Draft for legal review.** Not yet reviewed by a lawyer. Do not publish as final until reviewed. Last updated: 10 November 2026.

## Privacy policy and controller

Effective date: [Effective date].

[Legal entity name], at [Registered address], is the controller for personal data processed through the Dusk Bot services described here. You can contact privacy@dusk.bot about your information or this policy. Our website is dusk.bot. Our optional account dashboard is dusk.bot/dashboard. Our link service is link.dusk.bot.

Your computer, VPS, our account services and a Dusk Cloud desktop have different roles. Choosing a hosted desktop stores your bot content on that machine. That content is not part of account dashboard workspace reports.

## Desktop app and AI providers

Dusk Bot is local-first. On macOS, Windows and Linux, your bots, chats, files, memory and settings live on your computer or your own server. The app sends anonymous, structured usage counts and short anonymous summaries to our account service, described under Product analytics; you can switch them off under Settings, Data sharing. Our account and link services do not receive your message content, prompts, files or AI keys as workspace reporting data.

You sign in to AI engines yourself or add your own API keys. Examples include Anthropic Claude, OpenAI Codex/ChatGPT, Google Gemini and xAI Grok. Prompts and replies go directly from the machine running your bots to the provider under your account. Dusk Bot does not receive them through the account service. The provider's own terms and privacy policy apply. Read those policies before you send personal or confidential information.

## Phone app and push notifications

The phone app lets you use Dusk Bot with the machine running your bots. Local-first content stays on your own computer or VPS, or on your Dusk Cloud desktop if you choose one. Phone and device names can appear in the periodic workspace reports described below.

The phone push relay sees your device push token, the bot's name and identifiers. It never sees message text and keeps nothing. It uses Apple Push Notification service and Firebase Cloud Messaging from Google to deliver notifications. Those providers receive the necessary push delivery data.

## Crash and error reports

The app sends crash and error reports only when a release is built with error reporting configured. A report contains the error type, a scrubbed message, stack frames with app-relative file names, the app version and platform.

Scrubbing removes secrets, email addresses, web addresses, quoted text and personal folder names. Reports never contain message text, prompts, files, contacts or keys. The destination is [error tracking provider: self-hosted GlitchTip on our server, or Sentry]. Error reports are on by default; you can switch them off under Settings, Data sharing, in the desktop app. Error report retention is [error report retention]. This reporting is for finding and fixing errors, not product analytics.

## Optional account service

If you use the account dashboard at dusk.bot/dashboard, we store your email address and optional display name. For linked Google, Apple or X sign-in, we store the provider name, its account identifier and email address. Sign-in codes are emailed and kept in memory only.

Sign-in session records contain your device name, platform, app version, creation time and last-seen time. We store only a hash of the session token. The hash lets the service check a session without storing the original token in its session records.

If you link a workspace, we store its name and kind. Periodic workspace reports contain counts and states only. They can include CPU, memory and disk statistics; bot names, colours and models; bot computer states; phone and device names; and daily usage totals. These reports never contain messages, prompts, files or secrets. Names and identifiers may still be personal data even when message content is absent.

## Product analytics

We keep first-party usage records in our own database, never with a third-party analytics provider, to see whether people find the site, sign up, set up Dusk Cloud and get their first bot reply.

- **On the website** (dusk.bot and the preview site), a small script of ours records page views (the path only, with ids removed), clicks on sign-up and download links, waitlist sign-ups (never the address), how far a page was scrolled and how long it was visible. Where cookies are allowed it sets two first-party cookies: `dusk_vid`, a random visitor id kept for a year, and `dusk_sid`, a visit id that ends after 30 minutes without activity. If Cloudflare places your connection in the EU, the EEA, the UK or Switzerland (including their territories with their own country code), or cannot tell where you are, the script stores nothing in your browser: no cookies and no local storage (other than the `?dusk_ignore=1` off switch, if you set it yourself), and it removes `dusk_vid` and `dusk_sid` if an earlier visit left them. Instead our server derives a visitor id from your IP address and browser type with a secret that is kept only in memory and replaced every day, so the id changes daily and cannot be traced back to your address or linked from one day to the next; we never store the address or the secret. Your visit then ends after 30 minutes without activity, and each visit's source (referring site or campaign) is counted on its own rather than being tied to earlier visits. Until our server has answered, the script stores nothing anywhere. We keep the referring site's name (never its full address), campaign tags (`utm_*`, `ref`; values that look like email addresses are dropped), a coarse device, system and browser type, and the country, region and city Cloudflare derives from the connection, with coordinates rounded to about 10 km. We never store IP addresses. When you sign in to the account page on the same domain, your visitor id is linked to your account so we can see which visits led to a sign-up. Without cookies, that link covers only the same day's visits from the same connection and browser.
- **In the account page and the apps**: sign-ups and sign-ins (method and device type), onboarding steps, plan and checkout steps, Dusk Cloud states, which screens and features of the desktop and phone apps are used (names like "routine created", never their content), message and reply counts and how long replies took, error and pairing failure codes, app platform and version. The apps use a random install id; once an app signs in, its install is linked to your account. We never record message content, prompts, files, names you give things, form input, emails or keys.
- **From your bots' work** (desktop, phone and Dusk Cloud): when your workspace is linked to your account, it reports one structured record per bot turn and per routine run. A record holds only words from fixed lists, counts and times: the AI engine family (like claude or codex, never a model name you typed), whether the turn worked, failed or was stopped, a failure reason code (like rate limit or sign-in expired, never the error text), how long it took, the kinds of tools used (like browser, files or terminal), which connected app was used (only by its catalog name, like gmail or notion), a coarse task category worked out on your device from those tools and apps (like email, calendar, research or coding), whether a person, a routine or another bot started it, whether it was in a room, and whether it ran on a desktop or a cloud. Routine runs add how they were started (schedule, app event or webhook). The workspace also reports how many bots, rooms, routines, webhooks and skills it has. Tool names, arguments, error messages and anything you wrote are turned into those words on your device and never sent.
- **Anonymous summaries**: when a chat seems to go badly (signals like a thumbs down, stopping a reply, asking the same thing again, or replies that failed), and once a week for people who use Dusk Bot regularly, your own AI engine, on its cheapest model and at your plan's cost, writes a short anonymous summary on your device of what kind of work it was and what went wrong or what you use Dusk Bot for. A filter on your device removes email addresses, web addresses, handles, numbers, quotes, file names and capitalised names, and drops the summary if too much had to be removed. We never receive your messages. How often this happens grows with how much you use the app and is capped each day. These summaries help us see what to fix first.
- **Your choices**: the website script does nothing when your browser sends Global Privacy Control or Do Not Track. Usage stats and summaries are on by default. You can switch off usage stats, summaries, or both, in the desktop app under Settings, Data sharing, or on your account page under Data sharing (`PUT /v1/account/analytics`); switching off usage stats deletes your recorded events and stops new ones, and switching off summaries stops new summaries from being kept.
- **Retention**: raw events are deleted after 400 days, and raw records of your bots' work and summaries after 90 days. Per-day counts linked to you are deleted after 400 days. Daily totals and chart notes without any personal link are kept. Deleting your account deletes the events, records and summaries linked to it.
- Only the operator can see these records, in an admin panel that logs each opening of a person's record.

## Payments and transactional email

Dodo Payments is the merchant of record for paid plans. It handles card data, tax and invoices. Dusk Bot stores subscription status, plan lines, amounts and payment identifiers. We never store card numbers. Dodo's handling of payment data is also subject to its own applicable privacy terms.

We use Resend for transactional email, including sign-in codes and account and billing notices. It processes your delivery address and the email content needed to send those messages. Transactional messages are part of providing account and billing functions. They are not product analytics or advertising.

## Dusk Cloud desktops

Dusk Cloud provides a hosted, always-on computer per customer on InstaBox infrastructure, which runs on Amazon Web Services. InstaBox is a sub-processor. Your bots, chats and files live on that machine. This is the exception to the statement that your message content is not stored on our services. The cloud desktop connects directly to the AI providers you sign in to, using your accounts with them.

Cloud desktop backups are encrypted with a key held by the account service. That key arrangement is different from the link relay, where only your app and your VPS hold the keys. After your plan ends, the desktop is kept for 30 days and then deleted; we email you 7 days before. If you ask to delete it yourself, it is deleted 7 days after you confirm. While the desktop exists we keep its newest three verified backups. When it is deleted after those 30 days, its encrypted backups are kept 30 more days as a safety copy and then deleted; when you ask for the deletion yourself, the backups are deleted with it.

If you enable Wake for Slack, the account service holds your bot's Slack app-level token while the desktop sleeps. The token is sealed at rest. It also holds Slack events addressed to your bot, sealed to the desktop's key, for at most 24 hours. It never reads or logs event text. You choose whether to enable this feature.

## Link service

The service at link.dusk.bot pairs your own VPS with your app. Traffic is relayed as AES-256-GCM frames sealed with keys held only by the app and VPS. The link service cannot read that traffic.

The service stores install session records and hashes of link tokens. These support installation and pairing without storing the original link tokens in those records. Retention for install sessions and token hashes is [link record retention]. Push delivery through this service follows the phone relay description above.

## Connected apps

You can optionally connect third-party apps such as Gmail, Slack and GitHub through Composio. Tool traffic passes through a Dusk Bot broker on Cloudflare Workers to Composio. Composio holds the OAuth connections. The broker stores only a hash of each installation's token.

Tool traffic can include information needed to carry out your requested action in a connected app. This is distinct from collecting your chats or prompts in account reports. Review the permissions you grant and the connected app's own policy. Retention by the connected-app service is [Composio connection and tool-data retention]. The broker token hash is kept for [broker token hash retention].

## Website, hosting and logs

The website, account service and link service run on a server rented from Contabo GmbH, Germany, [confirm data center region]. Cloudflare runs the connected-apps broker and the cloud desktops' public edge. Spaceship provides DNS. Let's Encrypt provides TLS certificates.

Server access logs include IP addresses. We keep them for [log retention, for example 14 days] for security and abuse prevention. We do not use advertising or third-party analytics. Visiting the website does not give us access to content held on your computer or VPS.

## Purposes and legal bases

Where GDPR applies, we rely on the following legal bases. Contract covers processing needed to provide the services you request. This includes account sign-in, linked workspace reporting, paid plan administration, cloud hosting, pairing, push delivery and connected-app actions.

Legitimate interests cover keeping services secure, preventing abuse and diagnosing errors. We consider your rights when relying on these interests. You can object to processing based on legitimate interests. Consent applies where required for optional processing, including [processing that requires consent and withdrawal method]. You can withdraw consent without affecting earlier lawful processing.

Where legal obligations require payment or other records to be retained, the applicable obligations and records are [legal recordkeeping requirements]. We do not use your data for ads, and our product analytics stay first-party, as described below. We do not collect your message content on our account or link services. Your own Dusk Cloud desktop and the optional tool traffic described above have separate processing roles.

## Sub-processors and service providers

Provider legal roles, including any independent controller role for payments, are [provider role confirmations]. A provider's company location does not establish where all processing occurs.

| Name | Purpose | Data involved | Location |
| --- | --- | --- | --- |
| Contabo GmbH | Website, account and link hosting | Account records, service records and access logs; sealed relay traffic | Germany, [confirm data center region] |
| Cloudflare | Connected-apps broker and cloud desktop public edge | Tool traffic, broker token hashes and cloud edge traffic | [Cloudflare processing locations] |
| InstaBox | Cloud desktop infrastructure, sub-processor | Your hosted bots, chats, files and desktop data | [InstaBox processing locations: AWS us-west-2, United States] |
| Dodo Payments | Merchant of record, payments, tax and invoices | Billing details, card data and transaction records; Dusk Bot receives no card numbers | [Dodo Payments processing locations] |
| Resend | Transactional email delivery | Email address, sign-in codes and account or billing notice content | [Resend processing locations] |
| Composio | Connected-app tools and OAuth connections | OAuth connections and tool request and response data | [Composio processing locations] |
| Apple APNs | Phone push delivery | Device push token, bot name and identifiers, never message text | [Apple APNs processing locations] |
| Google FCM | Phone push delivery | Device push token, bot name and identifiers, never message text | [Google FCM processing locations] |
| Spaceship | DNS only | DNS queries and domain routing information, no bot content | [Spaceship DNS processing locations] |
| Let's Encrypt | TLS certificates | Certificate information, no personal data | [Let's Encrypt certificate service locations] |
| [error tracking provider: self-hosted GlitchTip on our server, or Sentry] | Conditional crash and error reporting | Scrubbed errors, app-relative frames, app version and platform | [error tracker processing location] |

AI model providers you choose have a direct relationship with you. They are not our sub-processors. On Dusk Cloud, the cloud desktop connects to the providers you sign in to. You still use your own provider account and their terms apply; those connections are part of operating your hosted desktop.

## International transfers

Your information may be processed outside your country through these providers. Where a transfer requires safeguards, we use applicable mechanisms, including Standard Contractual Clauses where needed. The relevant transfer destinations and safeguards are [international transfer details and SCC arrangements]. Contact privacy@dusk.bot to ask about safeguards applicable to your data or request a copy where available.

## Retention and account deletion

Account record retention is [account and workspace report retention]. Session record retention is [session retention]. Billing record retention is [billing retention and legal requirements]. The service-specific periods above apply to logs, error reports, link records and cloud data. We do not assign a fixed period here where it has not been confirmed.

You can use Delete account on the Account page. It removes the account, sessions, identities and linked workspaces. Active plans and cloud desktops must be cancelled first. The page offers to cancel them. A cloud desktop of a deleted account stops (at once, or when its paid time ends), is kept for 30 days, and is then deleted; its backups follow the backup rule above. Deleting your Dusk Bot account does not itself delete local files or records held independently by your AI providers.

## Your rights and choices

Depending on applicable law, you can ask to access, correct or delete your personal data, restrict processing or object to it, and obtain a portable copy. On the Account page, Download your data gives you a JSON file. This exports account service data, not an independent copy of every file on your machines.

Email privacy@dusk.bot for correction or other requests. Include enough information to identify your account and request, without sending passwords or keys. We may need to verify your identity before acting. You can complain to your competent supervisory authority. You do not have to contact us before doing so.

## Security measures

We use encryption in transit, sealed relay frames, hashed session and link tokens, and encrypted cloud backups. Wake for Slack tokens are sealed at rest, and queued events are sealed to the desktop's key. These measures protect different parts of the service. No system can guarantee complete security. Keep your own devices, provider accounts and keys secure. Report vulnerabilities to security@dusk.bot.

## Cookies and local storage

On dusk.bot (the dashboard, the admin and the API), a session cookie is HttpOnly, lasts 30 days and is renewed while used. A CSRF cookie protects requests. A short-lived OAuth state cookie supports sign-in. Your theme preference is stored in local storage.

There are no advertising cookies. Outside the EU, the EEA, the UK and Switzerland, the website's analytics script sets two first-party cookies, `dusk_vid` (a random visitor id, one year) and `dusk_sid` (a visit id, 30 minutes), described under Product analytics; they are never shared with anyone. Where Cloudflare places you in those countries, or cannot place you, the script sets no cookies and uses no local storage, and our server counts visits with a daily-changing id instead, as described under Product analytics. The account cookies are strictly necessary for account and security functions. Theme local storage records your preference. Blocking required cookies may prevent account sign-in or related functions from working.

## Children, changes and contact

Dusk Bot is not for children under 16 [or the age the owner picks]. If you believe a child has provided personal data through our services, contact privacy@dusk.bot so we can address it.

We may update this policy. We will use [privacy change notification method] for material changes. Check the effective date when reviewing it. For privacy requests, contact privacy@dusk.bot or [Legal entity name], [Registered address]. For general questions, use hello@dusk.bot.
