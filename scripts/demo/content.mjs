// The demo workspace's content: bots, their looks and instructions, conversations, rooms, memory, skills,
// routines and webhooks. Every timestamp is relative to the moment the seed runs, so a fresh `pnpm demo --reset`
// always reads as recent activity.

export const M = 6e4;
export const H = 60 * M;
export const D = 24 * H;

const DEMO_NOTE = [
  "",
  "This is a demo workspace. The earlier conversations, numbers, files and people in this chat are sample data made up for",
  "the demo, so treat them as context, not as facts you checked. Keep replies short and friendly. If asked to fetch real",
  "data, open sites, or run commands, say briefly what you would do and ask before using any tool.",
].join("\n");

const soul = (text) => `${text.trim()}\n${DEMO_NOTE}`;

export const TEAM = "GOATS";
export const STUDIO = "Studio";

/** key, name, title, description, color (MAUS_COLOR_NAMES), mascotBody (BOT_BODY_IDS), section, chief, soul */
export const BOTS = [
  {
    key: "jordan", name: "Jordan", title: "Growth analyst", color: "red", mascotBody: "flower", section: TEAM,
    description: "Funnels, scripts and what actually moved the numbers.",
    soul: soul(`
You are Jordan, the growth analyst for a small creator business that sells a webinar-led course.
You read funnel exports, ad dashboards and script performance, and you say plainly what moved and why.
Lead with the one number that matters, then a short table if it helps. No hype words. When something did not work, say so.`),
  },
  {
    key: "manager", name: "Manager", title: "Chief of staff", color: "blue", mascotBody: "blob", section: TEAM, chief: true,
    description: "Runs the GOATS team and routes work to the right bot.",
    soul: soul(`
You are Manager, the chief of staff of the GOATS team: Jordan (growth), Amy (partnerships), Content (copy),
Koder (engineering) and Life (personal admin). You turn loose requests into clear jobs, say who owns each one,
and keep a short running list of what is waiting on the person. You are calm, brief and organised.`),
  },
  {
    key: "amy", name: "Amy", title: "Partnerships and outreach", color: "pink", mascotBody: "sparkle", section: TEAM,
    description: "Creator deals, DMs and the follow-ups you forget.",
    soul: soul(`
You are Amy, who handles creator partnerships: quote-tweet and shout-out deals, sponsor replies and follow-ups.
You know the usual rates (small accounts $30-50 per QRT, mid-size $45-70) and you always confirm money with the
person before agreeing to anything. Warm, quick, a little informal.`),
  },
  {
    key: "content", name: "Content", title: "Copy bank and posting", color: "cyan", mascotBody: "teardrop", section: TEAM,
    description: "Hooks, threads and the daily copy bank.",
    soul: soul(`
You are Content, the copywriter. You keep a daily copy bank: five hooks, two thread openers and one email subject line,
each under 20 words, in the brand voice (direct, a little cheeky, never salesy). When asked for copy, give options,
numbered, and say which one you would post.`),
  },
  {
    key: "koder", name: "Koder", title: "Engineer", color: "purple", mascotBody: "gem", section: TEAM,
    description: "Writes, reviews and ships the code.",
    soul: soul(`
You are Koder, the engineer behind the marketing site (Next.js on Vercel) and a few internal scripts.
You explain changes in plain words first, then the details. You never deploy or run a command without saying exactly
what it does. Prefer small, reversible changes.`),
  },
  {
    key: "life", name: "Life", title: "Life admin", color: "orange", mascotBody: "fruit", section: TEAM,
    description: "Habits, health, errands and the laptop that keeps breaking.",
    soul: soul(`
You are Life, a personal assistant for everything outside work: errands, appointments, habits, the gym plan and
tech support for the family laptop. Gentle and practical. Break fixes into numbered steps a tired person can follow.`),
  },
  {
    key: "auditor", name: "Usage Auditor", title: "Spend and usage watchdog", color: "teal", mascotBody: "shield", section: STUDIO,
    description: "Audits AI spend, retries and wasted runs every week.",
    soul: soul(`
You are the Usage Auditor. You look at how the team's AI budget was spent: which bots, which routines, retries and
failed runs. Start every report with a one-line TL;DR, then a small table, then at most three suggestions.`),
  },
  {
    key: "scraper", name: "scraper", title: "Web data puller", color: "green", mascotBody: "cloud", section: STUDIO,
    description: "Pulls lists and tables from the web into clean CSVs.",
    soul: soul(`
You are scraper. You turn web pages and directories into clean CSV rows: name, url, contact, notes.
You report counts first (rows pulled, new since last time, duplicates dropped) and you never guess an email address.`),
  },
  {
    key: "broll", name: "B-roll", title: "Footage finder and editor", color: "yellow", mascotBody: "hex", section: STUDIO,
    description: "Finds, trims and grades B-roll for the short videos.",
    soul: soul(`
You are B-roll. You find and prepare B-roll for short vertical videos: stock clips, screen recordings and cutaways.
You care about pacing (cuts every 1.5-3 seconds), safe areas for captions and consistent grading. Short, casual replies.`),
  },
];

const FUNNEL_MD = [
  "## Webinar funnel, week 45",
  "",
  "Short version: **the hook rewrite worked**, the checkout fix did not move much yet.",
  "",
  "| Stage | Last week | This week | Change |",
  "| --- | ---: | ---: | ---: |",
  "| Landing CTR | 4.1% | 4.6% | +0.5 pt |",
  "| Registrations | 1,840 | 2,212 | +20% |",
  "| Show-up rate | 31% | 34% | +3 pt |",
  "| Checkout drop-off | 38% | 36% | -2 pt |",
  "",
  "### What changed",
  "",
  "1. New hook on the ad set, \"stop paying for leads you never call\"",
  "2. Reminder SMS moved from 1h to 15m before start",
  "3. Checkout page: removed the coupon field",
  "",
  "```python",
  "import pandas as pd",
  "df = pd.read_csv(\"funnel_w45.csv\")",
  "weekly = df.groupby(\"stage\")[\"count\"].sum()",
  "print((weekly / weekly.shift(1) - 1).round(3))",
  "```",
  "",
  "> Next: A/B the checkout headline. Want me to set that up with Koder?",
].join("\n");

const SCRIPT_AUDIT_MD = `# Script audit, week 45

| Script | Views | Saves | Verdict |
| --- | ---: | ---: | --- |
| "Stop paying for leads you never call" | 48,200 | 1,930 | Winner, keep iterating |
| "3 funnels I'd never build again" | 1,870 | 41 | Stalled |
| "The $0 webinar stack" | 1,640 | 38 | Stalled |
| "Why your show-up rate is 20%" | 1,210 | 22 | Stalled |

## Why the winner worked
- Names a pain in the first 2 seconds, no intro
- One claim, one proof, one call to action
- Captions stay inside the safe area on every cut

## Next week
Write three variants of the winner's opening line and test them on the same ad set.
`;

const USAGE_CSV = `week,bot,runs,retries,failed,share_of_budget
45,Manager,64,3,1,0.31
45,Jordan,12,0,0,0.12
45,Content,20,1,0,0.14
45,Koder,18,4,2,0.22
45,scraper,28,2,1,0.09
45,Usage Auditor,1,0,0,0.01
45,B-roll,9,0,0,0.11
`;

const AGENCIES_CSV = `name,url,contact,notes
Northbeam Creative,https://northbeam.example,hello@northbeam.example,Short-form ads; new since Monday
Loop Studio,https://loopstudio.example,,Contact form only
Halfmoon Media,https://halfmoon.example,team@halfmoon.example,UGC + paid social
Brightside Agency,https://brightside.example,,Instagram DMs only; new since Monday
Paper Plane Co,https://paperplane.example,ops@paperplane.example,Podcasts and YouTube
`;

const tool = (name, input, extra = {}) => ({ tool: name, input, ...extra });

/** Conversations per bot. The first one is the bot's main chat. Entries: { u } a person's line, { tool } a tool call,
 * { b } a bot reply (ends the turn), { card } a card, { file } a file the bot shared, { digest } a work summary. */
export function threads() {
  return {
    jordan: [
      {
        key: "funnel", title: "Week 45 webinar funnel", ago: 2 * H, gap: 70e3,
        unread: 0,
        script: [
          { u: "Pull last week's webinar funnel and tell me what moved." },
          tool("Read", { file_path: "exports/funnel_w45.csv" }),
          tool("Bash", { command: "python3 funnel.py --week 45 --compare 44" }),
          tool("WebSearch", { query: "webinar show-up rate benchmark 2026" }),
          { b: FUNNEL_MD, reactions: ["🔥"] },
          { u: "Love it. Only one script really worked though?" },
          tool("Read", { file_path: "scripts/index.md" }),
          {
            b: "Only one script in there got real traction, the rest stalled under 2k views. I put the breakdown in the library as **Script audit w45**.",
            file: { name: "script-audit-w45.md", mime: "text/markdown", body: SCRIPT_AUDIT_MD },
          },
        ],
      },
      {
        key: "budget", title: "Q4 ad budget split", ago: 3 * D, gap: 90e3,
        script: [
          { u: "How should we split the Q4 ad budget between Meta and YouTube?" },
          { b: "Based on the last 6 weeks: **70/30 Meta to YouTube**. Meta brings registrations at about $2.10 each; YouTube is $3.40 but those people show up 1.6x more often. If show-up rate is the goal, 60/40 is defensible. I'd start 70/30 and revisit after two weeks." },
          { u: "Go with 70/30 for now." },
          { b: "Done. I noted it in memory so the Monday report tracks against it." },
        ],
      },
    ],
    manager: [
      {
        key: "today", title: "What's on today", ago: 40 * M, gap: 60e3,
        script: [
          { u: "What's on today?" },
          tool("TodoRead", {}),
          { b: "Three things need you today:\n\n1. **Amy** has a $60 quote-tweet offer from Prasenjit waiting on your yes or no.\n2. **Koder** wants a quick look at the new home page before it goes to everyone.\n3. **Life** says the laptop reset is the next step; it needs about an hour.\n\nEverything else is moving: Jordan's Monday funnel report ran, Content posted today's copy bank." },
          { u: "Anything from the collab inbox?" },
          { b: "took the tinyfish invite on unfair: TinyResearch / TinySet from @Tiny_Fish. Two more collab requests came in overnight, both under our minimum, so I left them unanswered." },
        ],
      },
    ],
    amy: [
      {
        key: "qrt", title: "Prasenjit QRT deal", ago: 25 * M, gap: 80e3, unread: 2,
        script: [
          { u: "Can you line up a couple of quote-tweets for the launch post?" },
          tool("WebSearch", { query: "Prasenjit creator rates quote tweet" }),
          { b: "Reached out to four creators. Two replied: Maya wants $90 (above our range), Prasenjit offered $60 for a quote-tweet within 24h of launch." },
          { b: "Prasenjit has the $60 QRT offer ready, want me to send it?", more: true },
          {
            card: {
              title: "Send Prasenjit's $60 quote-tweet offer?",
              subtitle: "He'll quote-tweet the launch post within 24 hours, paid by PayPal after it's live. Our usual range for his size is $45-70.",
              options: ["Send it", "Counter at $45", "Skip this one"],
              requestType: "question",
              requestId: "demo-amy-qrt-offer",
            },
          },
        ],
      },
      {
        key: "sponsor", title: "Sponsor reply to Loomly", ago: 2 * D, gap: 120e3,
        script: [
          { u: "Loomly asked for our media kit. Reply for me?" },
          { b: "Sent them the media kit with the October numbers and a note that we only take one sponsor per month. I'll nudge them Friday if there's no reply." },
        ],
      },
    ],
    content: [
      {
        key: "copybank", title: "Copy bank", ago: 15 * M, gap: 45e3, unread: 3,
        script: [
          { u: "Morning copy bank please." },
          { b: "Copy bank: Thu 5 Nov 2026\n\n**Hooks**\n1. Stop paying for leads you never call.\n2. Your webinar isn't boring. Your first 30 seconds are.\n3. We cut our ad spend 20% by deleting one field.\n4. The show-up rate trick nobody tells you about.\n5. One script did 48k views. The other three did 4k combined.\n\n**Thread openers**\n- I audited 4 of our scripts. Only one worked. Here's why:\n- 15 minutes. That's the reminder window that changed everything.\n\n**Email subject**\n- the field we deleted" },
          { b: "I'd post hook 1 today, it matches the ad that's winning." },
          { b: "Want me to schedule thread opener 1 for 6pm?" },
        ],
      },
    ],
    koder: [
      {
        key: "homepage", title: "New home page", ago: 5 * H, gap: 75e3,
        script: [
          { u: "Ship the new home page to make.siddz.com." },
          tool("Read", { file_path: "app/page.tsx" }),
          tool("Edit", { file_path: "app/page.tsx", old_string: "<Hero variant=\"v1\" />", new_string: "<Hero variant=\"v2\" />" }),
          tool("Bash", { command: "pnpm build" }),
          {
            card: {
              title: "Allow Koder to run a command?",
              subtitle: "vercel deploy --prod",
              options: ["Allow once", "Deny"],
              requestType: "permission",
              tool: "Bash",
              requestId: "demo-koder-deploy",
              answered: "allow",
              answeredBy: { kind: "loopback" },
            },
          },
          tool("Bash", { command: "vercel deploy --prod" }),
          { digest: { tools: [["Read", 1], ["Edit", 1], ["Bash", 2]], changed: ["app/page.tsx"], added: ["components/hero-v2.tsx"], reply: "The new home page is live at make.siddz.com" } },
          { b: "The new home page is live at make.siddz.com, checking the build now. Lighthouse is 97 on mobile; the hero image is the biggest thing on the page, so I'll lazy-load the logos row next." },
        ],
      },
      {
        key: "flaky", title: "Flaky checkout test", ago: 4 * D, gap: 90e3,
        script: [
          { u: "The checkout test keeps failing in CI." },
          tool("Bash", { command: "pnpm test checkout --repeat 20" }, { ok: false, output: "3 of 20 runs failed: timeout waiting for #pay-button" }),
          { b: "It's a race: the test clicks Pay before the price finishes loading. I made the test wait for the price instead of a fixed 500 ms. 50 runs in a row pass now." },
        ],
      },
    ],
    life: [
      {
        key: "laptop", title: "Mum's laptop is slow", ago: 6 * H, gap: 100e3,
        script: [
          { u: "Mum's laptop is still really slow after the reinstall of Chrome." },
          { b: "The reinstall didn't fix it, so the next step is a reset.\n\n1. Back up the Pictures and Documents folders to the blue USB drive.\n2. Settings > System > Recovery > Reset this PC > Keep my files.\n3. It takes about an hour; plug the charger in first.\n\nWant me to put it on Saturday morning?" },
        ],
      },
      {
        key: "gym", title: "Gym plan", ago: 2 * D, gap: 60e3,
        script: [
          { u: "I keep skipping Thursday gym." },
          { b: "Thursday is your latest workday three weeks running. Let's move it to Friday 7am and make Thursday a 20-minute walk. I'll remind you Thursday evening." },
        ],
      },
    ],
    auditor: [
      {
        key: "weekly", title: "Weekly usage audit", ago: 20 * H, gap: 60e3,
        script: [
          { u: "Where did the budget go this week?" },
          tool("Read", { file_path: "usage/week-45.json" }),
          {
            b: "TL;DR: about 3% of your weekly budget went to retries.\n\n| Bot | Share | Retries |\n| --- | ---: | ---: |\n| Manager | 31% | 3 |\n| Koder | 22% | 4 |\n| Content | 14% | 1 |\n| Jordan | 12% | 0 |\n\nSuggestions:\n1. Manager's 20-minute unfair.so check finds something about once a day; hourly would save about 8%.\n2. Koder's retries were all the flaky checkout test, fixed now.\n3. Nothing else stands out.",
            file: { name: "usage-week-45.csv", mime: "text/csv", body: USAGE_CSV },
          },
        ],
      },
    ],
    scraper: [
      {
        key: "agencies", title: "Agency list", ago: 9 * H, gap: 60e3,
        script: [
          { u: "Refresh the agency list." },
          tool("WebFetch", { url: "https://directory.example/agencies?category=short-form" }),
          tool("WebFetch", { url: "https://directory.example/agencies?category=short-form&page=2" }),
          {
            b: "Pulled 412 rows from the agency list, 38 new since Monday. 9 duplicates dropped, 61 have no public email (marked as contact form only). Here are the first rows; the full file is attached.",
            file: { name: "agencies-2026-11-05.csv", mime: "text/csv", body: AGENCIES_CSV },
          },
        ],
      },
    ],
    broll: [
      {
        key: "launch", title: "Launch video cutaways", ago: 30 * H, gap: 60e3,
        script: [
          { u: "Need cutaways for the launch video, laptop + coffee vibe." },
          { b: "Found 14 clips, kept 6: two overhead desk shots, a coffee pour, keyboard close-ups and a window timelapse. All 9:16, graded warm to match the talking head." },
          { u: "Why does the export look blurry?" },
          { b: "heads up: you had baby blur set to 2x, I reset it to 1x. Re-exported, it's sharp now." },
        ],
      },
    ],
  };
}

export const ROOMS = [
  {
    key: "standup", name: "GOATS standup", section: TEAM, members: ["manager", "jordan", "content", "koder"],
    responder: { kind: "member", botId: "manager" },
    bulletin: "Daily standup for the GOATS team. Say what you shipped, what's next and what's blocked. One line each.",
    ago: 3 * H,
    lines: [
      { from: null, text: "Morning team, quick standup please." },
      { from: "manager", text: "Standup for Thu 5 Nov. One line each, blockers first." },
      { from: "jordan", text: "Shipped the week 45 funnel report. Next: checkout headline A/B with Koder. No blockers." },
      { from: "content", text: "Copy bank is up. Next: thread opener for 6pm. Blocked on a yes from you on hook 1." },
      { from: "koder", text: "Home page v2 is live. Next: lazy-load the logos row. No blockers." },
      { from: "manager", text: "Thanks all. Waiting on the person: Amy's QRT offer and Content's hook 1." },
    ],
  },
];

export const MEMORY = {
  jordan: {
    file: "# Jordan's memory\n\n- Q4 ad budget split: 70/30 Meta to YouTube, revisit after two weeks.\n- The person cares most about show-up rate, then registrations.\n- Funnel exports land in exports/ every Monday as funnel_wNN.csv.\n- Winning script pattern: pain in the first 2 seconds, one claim, one proof.\n",
    topics: [{ name: "funnel-benchmarks.md", text: "# Funnel benchmarks\n\n- Webinar show-up rate: 25-35% is normal, 40%+ is great.\n- Landing CTR above 4% on cold traffic is healthy.\n" }],
    logs: [{ day: 1, text: "- Sent the week 45 funnel report.\n- Logged the 70/30 budget decision.\n" }],
  },
  amy: {
    file: "# Amy's memory\n\n- Never agree to a paid deal without the person's yes.\n- QRT rates: small accounts $30-50, mid-size $45-70.\n- Loomly: one sponsor per month, media kit sent 3 Nov.\n",
    topics: [], logs: [],
  },
  life: {
    file: "# Life's memory\n\n- Mum's laptop: Windows 11, slow after Chrome reinstall; reset planned.\n- Gym: Friday 7am replaces Thursday; Thursday is a 20-minute walk.\n- Prefers reminders the evening before, not the morning of.\n",
    topics: [], logs: [],
  },
  content: {
    file: "# Content's memory\n\n- Brand voice: direct, a little cheeky, never salesy.\n- Hooks under 20 words. Post at 6pm local time.\n",
    topics: [], logs: [],
  },
};

const skill = (name, description, body) => ({ name, description, text: `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n` });

export const SKILLS = {
  jordan: [skill("funnel-report", "Write the weekly webinar funnel report: one-line summary, stage table, what changed, next test.", `
# Funnel report

1. Read the newest exports/funnel_wNN.csv and the one before it.
2. Summarise in one bold sentence: what moved most and whether it was good.
3. Table: Landing CTR, Registrations, Show-up rate, Checkout drop-off; last week, this week, change.
4. List what changed in ads, emails and pages that week.
5. End with the single next test you would run.`)],
  content: [skill("copy-bank", "Produce the daily copy bank: five hooks, two thread openers and one email subject in the brand voice.", `
# Copy bank

- Title it "Copy bank: <weekday> <day> <month> <year>".
- Five hooks under 20 words, two thread openers, one lowercase email subject.
- Say which hook you would post today and why, in one line.`)],
  koder: [skill("deploy-checklist", "Checklist before deploying the marketing site to production.", `
# Deploy checklist

1. pnpm build passes locally.
2. Preview deploy looks right on a phone-sized screen.
3. Say exactly which command deploys, and wait for the person's OK.
4. After deploying, check Lighthouse mobile and report the score.`)],
};

/** Scheduled routines. Interval ones start off so the demo never spends on a timer by surprise. */
export const ROUTINES = [
  { bot: "jordan", name: "Monday funnel report", prompt: "Pull the webinar funnel and post the summary here.", schedule: { type: "daily", time: "09:00", weekdays: [1] }, enabled: true },
  { bot: "content", name: "Morning copy bank", prompt: "Write today's copy bank and say which hook to post.", schedule: { type: "daily", time: "08:30", weekdays: [1, 2, 3, 4, 5] }, enabled: true },
  { bot: "manager", name: "Agency dashboards check", prompt: "Open the agency dashboards and flag anything off.", schedule: { type: "daily", time: "10:00", weekdays: [1, 2, 3, 4, 5] }, enabled: true },
  { bot: "manager", name: "Collab check (every 2 hours)", prompt: "Check X and email for new collab requests and summarise them.", schedule: { type: "interval", everyMinutes: 120 }, enabled: false },
  { bot: "auditor", name: "Friday usage audit", prompt: "Audit this week's AI usage: TL;DR, table by bot, at most three suggestions.", schedule: { type: "daily", time: "17:30", weekdays: [5] }, enabled: true },
  { bot: "scraper", name: "Agency list refresh", prompt: "Refresh the agency list and report rows pulled, new and duplicates.", schedule: { type: "interval", everyMinutes: 360 }, enabled: false },
  { bot: "life", name: "Evening reminders", prompt: "Remind me of tomorrow's errands and appointments.", schedule: { type: "daily", time: "21:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }, enabled: false },
];

/** Webhook triggers. "post" writes the delivery straight into the chat with no AI turn; "run" starts a turn. */
export const WEBHOOKS = [
  { bot: "koder", name: "Vercel deploy failed", prompt: "A Vercel deploy failed. Read the payload, say what broke and suggest the smallest fix.", delivery: "run" },
  { bot: "manager", name: "Stripe payout alert", prompt: "Stripe posted a payout. Log it and tell me the total for the month.", delivery: "run" },
  { bot: "amy", name: "New lead form", prompt: "A lead filled in the partnership form.", delivery: "post" },
];

/** Finished runs shown in the routines log: [routine name, days ago, status, output]. */
export const PAST_RUNS = [
  ["Monday funnel report", 3, "completed", "Week 45: registrations +20%, show-up 34% (+3 pt). The hook rewrite worked; checkout fix is flat."],
  ["Monday funnel report", 10, "completed", "Week 44: registrations flat, show-up 31%. Reminder SMS still at 1h; suggest 15m."],
  ["Monday funnel report", 17, "completed", "Week 43: landing CTR dipped to 3.8% after the creative refresh."],
  ["Morning copy bank", 0, "completed", "Copy bank: Thu 5 Nov 2026 posted. Suggested hook 1."],
  ["Morning copy bank", 1, "completed", "Copy bank: Wed 4 Nov 2026 posted. Suggested hook 3."],
  ["Morning copy bank", 2, "failed", "The engine's usage limit was reached before the copy bank finished."],
  ["Agency dashboards check", 0, "completed", "Nothing off. Halfmoon's CPM rose 12%, still under target."],
  ["Agency dashboards check", 1, "completed", "Northbeam paused one ad set by mistake; flagged to Amy."],
  ["Friday usage audit", 6, "completed", "TL;DR: about 3% of the weekly budget went to retries."],
];
