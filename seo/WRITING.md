# writing an seo page record

Every seo page is one JSON file in `seo/pages/<type>/<name>.json`. The templates (`seo/templates.mjs`) do the layout;
the record carries what is this page's own. Read one finished exemplar of the same type before writing:

| type | exemplar | what the page is built around |
| --- | --- | --- |
| pillar | `pages/pillar/agents-when-laptop-closed.json` | sections, optional comparison `table` |
| guide | `pages/guide/is-it-safe-to-let-ai-control-your-computer.json` | sections, optional `table`, optional `steps` |
| alternative, comparison | `pages/alternative/openclaw.json` | `verdict`, `compare` table with sources per row, `method` |
| integration | `pages/integration/gmail.json` | `app` (Composio toolkit + highlighted actions), `routines`, `asks`, `cannot` |
| use-case | `pages/use-case/email-triage.json` | `routine` (message, when, needs, sample output), `safeguards` |
| role | `pages/role/founders.json` | `day` table, `pack` of routines |
| routine | `pages/routine/weekly-calendar-preview.json` | `routine`, `knobs`, `fails` |
| glossary | `pages/glossary/always-on-ai-agent.json` | `definition`, `example` |
| tool | `pages/tool/always-on-cost.json` | `tool` (seo/tools/<name>.html + public/landing/tools/<name>.js), `method` |

## fields every record has

- `path`: the address, exactly as planned (seo/planned.json). `type`: the folder name.
- `title`: the browser tab and search result title, 30 to 65 characters, sentence case, unique. No " · Dusk Bot" needed.
- `nav`: the short name in sidebars and breadcrumbs, lowercase.
- `h1`: lowercase, like the site's headings, unique. Phrase it the way people search when that reads naturally.
- `description`: 70 to 160 characters, unique, sentence case. Says what the page gives the reader.
- `keyword` and `keywords`: from the plan; for the record only, never stuffed into copy.
- `answer`: the first paragraph, 40 to 80 words, answers the page's question directly and on its own. Lowercase like the site.
- `updated`: the day you checked the page against its sources (YYYY-MM-DD).
- `review`: `{ "status": "needs_review" }` when you draft it. Only the lead sets `approved`; only approved pages go out.
- `tags`, `connectors` (Composio toolkit slugs like `gmail`, `googlecalendar`), `related` (2 to 5 paths from seo/planned.json): these pick the related pages and the sidebar.
- `art`: `{ "props": [one or two kit objects], "bubble": "a short line, 2 to 5 words" }`, plus `"logo": "<file in public/landing/art/logos without extension>"` for an app that has one there, or `"label": "Name"` for a neutral name tile (competitors: always a label, never a drawn mark). Kit objects: s-books s-button s-clock s-cloud s-coins s-computer s-key s-mailbox s-map s-mobile s-notebook s-palette s-parcel s-phone s-plug s-server s-signpost p-bag p-binoculars p-briefcase p-bubbles p-cap p-chart p-folder p-house p-laptop p-magnifier p-megaphone p-mug p-newspaper p-receipt p-shield.
- `og_line`: under 50 characters, lowercase, ends with a full stop; shown on the share card under the h1.
- `sections`: `[{ "h": "lowercase heading", "md": "markdown" }]`. Markdown: paragraphs, `- lists`, `1. lists`, `**bold**`, `` `code` ``, `[words](/address)`, `| tables |`, `> note:` callouts, and `[^3]` to cite source 3.
- `faq`: 2 to 4 `{ "q", "a" }` taken from how people actually ask (the plan's keywords, the Reddit phrasing in omb-ref/seo-research/03-keywords-competitors.md section 3). Plain content; there is no FAQ markup.
- `sources`: `[{ "label", "url", "checked" }]`. Dusk Bot docs as `/docs/...` with no date. Every outside source needs `checked`. Integration pages get their Composio source added by the build; do not add it yourself.

## voice

- Lowercase headings and lowercase body text, like the rest of the site (product and app names stay lowercase in body copy too: gmail, claude, dusk cloud). `title` and `description` are sentence case.
- Short, warm sentences in plain words a non-technical person gets. Say "you". No hype, no exclamation marks, no "unlock", "supercharge", "seamless", "game-changer", "in today's fast-paced world".
- Never an em dash. Use a colon, a comma, a full stop or parentheses.
- Be honest about limits: every page says what it can't do or where something else fits better.
- Write what a person would want to bookmark: the exact message to send, the real setting names (in **bold**, as the app spells them), real numbers with their source.

## facts

- About Dusk Bot, use only `seo/facts/dusk.md`. If a claim is not there, leave it out.
- About an app's actions, use only `seo/facts/connectors/<toolkit>.json` (highlight action slugs that exist there).
- About competitors, use only `seo/facts/competitors.json`, citing the `source_url` of each fact you use with its `checked` date. Skip facts marked low confidence or unknown. Say "as of 12 november 2026" where a price or status could change.
- About AI vendors' own features and terms, use only `seo/facts/vendors.json` the same way.
- Never invent: features, numbers, users, ratings, testimonials, measured results, quotes, dates. Example outputs are allowed only where the template labels them as examples, and must use made-up names (sam, priya, acme).

## words the build refuses (legal, until the owner clears wording)

Do not write "use your Claude/ChatGPT/Gemini/Grok subscription", "no API key", "subscription instead of API", "free Claude", or anything implying a vendor endorses or partners with Dusk Bot. Write "the AI you already sign in to", "works with the AI apps you already use", "billed by your AI provider on your plan with them". Pages about vendor terms state what the vendor's own page says, dated and linked, and tell people to check their provider's current terms.

## check

```sh
node seo/check.mjs seo/pages/<type>/<name>.json
```

It must print `all checks pass`. It checks lengths, required fields, words of the page's own (shared template text does not count), placeholder text, em dashes, the words above, links, dated sources and how close the page is to every other page (over 50% alike fails, over 30% warns: rewrite until there is no warning for your page).
