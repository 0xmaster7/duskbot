## Cookie policy

Effective date: 12 November 2026. Last updated: 12 November 2026.

This policy lists the cookies and browser storage that dusk bot uses on dusk.bot, including the website, the account dashboard at dusk.bot/dashboard, the admin and the API. It also covers the preview site at preview.dusk.bot, which works the same way. Our [privacy policy](privacy.md) explains the data behind them.

We do not use advertising cookies, and we do not use third-party analytics or tracking cookies. Every cookie below is set by dusk.bot itself, and none is shared with anyone else.

## Strictly necessary cookies

These cookies are needed for signing in and keeping your account secure. They are set only when you use the account dashboard, and they do not need consent. If you block them, sign-in and account functions will not work.

| Name | Purpose | Lasts |
| --- | --- | --- |
| `dusk_dash` | Keeps you signed in. HttpOnly, so page scripts cannot read it. | 30 days, renewed while you use it |
| `dusk_csrf` | Protects requests that change your account against cross-site request forgery. | 30 days, renewed with the session |
| `dusk_oauth` | Remembers a sign-in with Google, Apple or X while you are away at that provider. | 10 minutes |

Cloudflare, which sits in front of dusk.bot, may set its own strictly necessary security cookies, such as `__cf_bm`, to tell people apart from abusive automated traffic. They do not track you across sites.

## Analytics cookies

Our own small analytics script counts page views, sign-up and download clicks, scrolling and time on page. It sets two first-party cookies, and only outside the EU, the EEA, the UK and Switzerland:

| Name | Purpose | Lasts |
| --- | --- | --- |
| `dusk_vid` | A random visitor id, so we can count returning visitors. | 1 year |
| `dusk_sid` | A random visit id, so we can group the pages of one visit. | 30 minutes without activity |

If Cloudflare places your connection in the EU, the EEA, the UK or Switzerland, or cannot tell where you are, the script sets no cookies and uses no browser storage, and removes `dusk_vid` and `dusk_sid` if an earlier visit left them. Our server then counts visits with an id that changes every day and cannot be traced back to you. The privacy policy describes this under Product analytics.

The script does nothing at all when your browser sends Global Privacy Control or Do Not Track.

## Local and session storage

| Name | Where | Purpose | Lasts |
| --- | --- | --- | --- |
| `dusk-dash-theme` | Dashboard, local storage | Your light or dark theme choice. | Until you clear it |
| `dusk-dash-notify` | Dashboard, local storage | Your notification preferences on this browser. | Until you clear it |
| `dusk-dash-visit` | Dashboard, session storage | A random visit id for our first-party product analytics. | Until you close the tab |
| `dusk_ignore` | Website, local storage | Turns our analytics off on this browser. Set only if you visit a page with `?dusk_ignore=1`. | Until you clear it |

## The apps

The desktop and phone apps do not use browser cookies. They keep their settings on your device and use a random install id for the usage stats described in the privacy policy, which you can switch off under Settings, Data sharing.

## Your choices

You can block or delete cookies and storage in your browser's settings. Blocking the strictly necessary cookies stops sign-in from working. Blocking the analytics cookies has no effect on the site. You can also turn our analytics off on a browser by visiting any page with `?dusk_ignore=1`, or by turning on Global Privacy Control.

## Changes and contact

If we add a cookie or change what one does, we update this page and its date. For questions, email privacy@dusk.bot.
