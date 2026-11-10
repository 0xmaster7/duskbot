> **Draft for legal review.** Not yet reviewed by a lawyer. Do not publish as final until reviewed. Last updated: 10 November 2026.

## Privacy policy and controller

Effective date: [Effective date].

[Legal entity name], at [Registered address], is the controller for personal data processed through the Dusk Bot services described here. You can contact privacy@dusk.bot about your information or this policy. Our website is dusk.bot. Our optional account dashboard is app.dusk.bot. Our link service is link.dusk.bot.

Your computer, VPS, our account services and a Dusk Cloud desktop have different roles. Choosing a hosted desktop stores your bot content on that machine. That content is not part of account dashboard workspace reports.

## Desktop app and AI providers

Dusk Bot is local-first. On macOS, Windows and Linux, your bots, chats, files, memory and settings live on your computer or your own server. The app does not include product analytics. Our account and link services do not receive your message content, prompts, files or AI keys as workspace reporting data.

You sign in to AI engines yourself or add your own API keys. Examples include Anthropic Claude, OpenAI Codex/ChatGPT, Google Gemini and xAI Grok. Prompts and replies go directly from the machine running your bots to the provider under your account. Dusk Bot does not receive them through the account service. The provider's own terms and privacy policy apply. Read those policies before you send personal or confidential information.

## Phone app and push notifications

The phone app lets you use Dusk Bot with the machine running your bots. Local-first content stays on your own computer or VPS, or on your Dusk Cloud desktop if you choose one. Phone and device names can appear in the periodic workspace reports described below.

The phone push relay sees your device push token, the bot's name and identifiers. It never sees message text and keeps nothing. It uses Apple Push Notification service and Firebase Cloud Messaging from Google to deliver notifications. Those providers receive the necessary push delivery data.

## Crash and error reports

The app sends crash and error reports only when a release is built with error reporting configured. A report contains the error type, a scrubbed message, stack frames with app-relative file names, the app version and platform.

Scrubbing removes secrets, email addresses, web addresses, quoted text and personal folder names. Reports never contain message text, prompts, files, contacts or keys. The destination is [error tracking provider: self-hosted GlitchTip on our server, or Sentry]. You can opt out using [opt-out setting]. Error report retention is [error report retention]. This reporting is for finding and fixing errors, not product analytics.

## Optional account service

If you use app.dusk.bot, we store your email address and optional display name. For linked Google, Apple or X sign-in, we store the provider name, its account identifier and email address. Sign-in codes are emailed and kept in memory only.

Sign-in session records contain your device name, platform, app version, creation time and last-seen time. We store only a hash of the session token. The hash lets the service check a session without storing the original token in its session records.

If you link a workspace, we store its name and kind. Periodic workspace reports contain counts and states only. They can include CPU, memory and disk statistics; bot names, colours and models; bot computer states; phone and device names; and daily usage totals. These reports never contain messages, prompts, files or secrets. Names and identifiers may still be personal data even when message content is absent.

## Payments and transactional email

Dodo Payments is the merchant of record for paid plans. It handles card data, tax and invoices. Dusk Bot stores subscription status, plan lines, amounts and payment identifiers. We never store card numbers. Dodo's handling of payment data is also subject to its own applicable privacy terms.

We use Resend for transactional email, including sign-in codes and account and billing notices. It processes your delivery address and the email content needed to send those messages. Transactional messages are part of providing account and billing functions. They are not product analytics or advertising.

## Dusk Cloud desktops

Dusk Cloud provides a hosted, always-on computer per customer on Boat infrastructure. Boat is a sub-processor. Your bots, chats and files live on that machine. This is the exception to the statement that your message content is not stored on our services. The cloud desktop connects directly to the AI providers you sign in to, using your accounts with them.

Cloud desktop backups are encrypted with a key held by the account service. That key arrangement is different from the link relay, where only your app and your VPS hold the keys. After your plan ends, the desktop is kept and then deleted under [retention period, for example 7 days after deletion request; 30 days after a plan ends]. Backup retention is [cloud backup retention and deletion schedule].

If you enable Wake for Slack, the account service holds your bot's Slack app-level token while the desktop sleeps. The token is sealed at rest. It also holds Slack events addressed to your bot, sealed to the desktop's key, for at most 24 hours. It never reads or logs event text. You choose whether to enable this feature.

## Link service

The service at link.dusk.bot pairs your own VPS with your app. Traffic is relayed as AES-256-GCM frames sealed with keys held only by the app and VPS. The link service cannot read that traffic.

The service stores install session records and hashes of link tokens. These support installation and pairing without storing the original link tokens in those records. Retention for install sessions and token hashes is [link record retention]. Push delivery through this service follows the phone relay description above.

## Connected apps

You can optionally connect third-party apps such as Gmail, Slack and GitHub through Composio. Tool traffic passes through a Dusk Bot broker on Cloudflare Workers to Composio. Composio holds the OAuth connections. The broker stores only a hash of each installation's token.

Tool traffic can include information needed to carry out your requested action in a connected app. This is distinct from collecting your chats or prompts in account reports. Review the permissions you grant and the connected app's own policy. Retention by the connected-app service is [Composio connection and tool-data retention]. The broker token hash is kept for [broker token hash retention].

## Website, hosting and logs

The website, account service and link service run on a server rented from Contabo GmbH, Germany, [confirm data center region]. Cloudflare runs the connected-apps broker and the cloud desktops' public edge. Spaceship provides DNS. Let's Encrypt provides TLS certificates.

Server access logs include IP addresses. We keep them for [log retention, for example 14 days] for security and abuse prevention. We do not use advertising or product analytics. Visiting the website does not give us access to content held on your computer or VPS.

## Purposes and legal bases

Where GDPR applies, we rely on the following legal bases. Contract covers processing needed to provide the services you request. This includes account sign-in, linked workspace reporting, paid plan administration, cloud hosting, pairing, push delivery and connected-app actions.

Legitimate interests cover keeping services secure, preventing abuse and diagnosing errors. We consider your rights when relying on these interests. You can object to processing based on legitimate interests. Consent applies where required for optional processing, including [processing that requires consent and withdrawal method]. You can withdraw consent without affecting earlier lawful processing.

Where legal obligations require payment or other records to be retained, the applicable obligations and records are [legal recordkeeping requirements]. We do not use your data for ads or product analytics. We do not collect your message content on our account or link services. Your own Dusk Cloud desktop and the optional tool traffic described above have separate processing roles.

## Sub-processors and service providers

Provider legal roles, including any independent controller role for payments, are [provider role confirmations]. A provider's company location does not establish where all processing occurs.

| Name | Purpose | Data involved | Location |
| --- | --- | --- | --- |
| Contabo GmbH | Website, account and link hosting | Account records, service records and access logs; sealed relay traffic | Germany, [confirm data center region] |
| Cloudflare | Connected-apps broker and cloud desktop public edge | Tool traffic, broker token hashes and cloud edge traffic | [Cloudflare processing locations] |
| Boat | Cloud desktop infrastructure, sub-processor | Your hosted bots, chats, files and desktop data | [Boat processing locations] |
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

You can use Delete account on the Account page. It removes the account, sessions, identities and linked workspaces. Active plans and cloud desktops must be cancelled first. The page offers to cancel them. Cloud desktop and backup deletion follow the stated retention policies. Deleting your Dusk Bot account does not itself delete local files or records held independently by your AI providers.

## Your rights and choices

Depending on applicable law, you can ask to access, correct or delete your personal data, restrict processing or object to it, and obtain a portable copy. On the Account page, Download your data gives you a JSON file. This exports account service data, not an independent copy of every file on your machines.

Email privacy@dusk.bot for correction or other requests. Include enough information to identify your account and request, without sending passwords or keys. We may need to verify your identity before acting. You can complain to your competent supervisory authority. You do not have to contact us before doing so.

## Security measures

We use encryption in transit, sealed relay frames, hashed session and link tokens, and encrypted cloud backups. Wake for Slack tokens are sealed at rest, and queued events are sealed to the desktop's key. These measures protect different parts of the service. No system can guarantee complete security. Keep your own devices, provider accounts and keys secure. Report vulnerabilities to security@dusk.bot.

## Cookies and local storage

On app.dusk.bot, a session cookie is HttpOnly, lasts 30 days and is renewed while used. A CSRF cookie protects requests. A short-lived OAuth state cookie supports sign-in. Your theme preference is stored in local storage.

There are no advertising or analytics cookies. No cookie banner is needed because the cookies used are strictly necessary for account and security functions. Theme local storage records your preference. Cookie and local storage use is limited to these purposes. Blocking required cookies may prevent account sign-in or related functions from working.

## Children, changes and contact

Dusk Bot is not for children under 16 [or the age the owner picks]. If you believe a child has provided personal data through our services, contact privacy@dusk.bot so we can address it.

We may update this policy. We will use [privacy change notification method] for material changes. Check the effective date when reviewing it. For privacy requests, contact privacy@dusk.bot or [Legal entity name], [Registered address]. For general questions, use hello@dusk.bot.
