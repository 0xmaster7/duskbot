// Ten months of one invented person's memory, January to November 2026, written in the file formats a workspace
// already holds (About me with typed and learned lines, profile-learned.json, each bot's MEMORY.md, topic files and
// archive). The offline suite writes it into a sandbox before the server starts, so a build that migrates old files
// is tested on them too. Every name, address and number here is made up.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PERSON = "Dana Okafor";

export type BotKey = "Scout" | "Forge" | "Ledger";

export const BOTS: Record<BotKey, { description: string }> = {
  Scout: { description: "Personal assistant: plans, people, travel, health." },
  Forge: { description: "Works with Dana on project Atlas." },
  Ledger: { description: "Keeps Dana's budget and taxes in order." },
};

const typed = [
  "My name is Dana Okafor. Call me Dana.",
  "I prefer metric units and 24-hour times.",
  "Time zone: Europe/Lisbon.",
  "Keep answers short unless I ask for detail.",
];

/** Learned lines, oldest first: [date, bot, fact]. Some restate others in other words, as months of capture do. */
const learned: Array<[string, string, string]> = [
  ["2026-01-08", "Scout", "Dana lives in Berlin"],
  ["2026-01-08", "Scout", "Dana works as a senior designer at Fernhill"],
  ["2026-01-09", "Scout", "Dana is vegetarian"],
  ["2026-01-09", "Scout", "Dana is allergic to cashews"],
  ["2026-01-12", "Scout", "Dana goes to the gym on Mondays"],
  ["2026-01-15", "Scout", "Dana's sister is Ana Okafor, email ana.okafor@example.com"],
  ["2026-01-15", "Scout", "Dana's brother Tomi Okafor lives in Lagos and is a civil engineer"],
  ["2026-01-20", "Scout", "Dana takes levothyroxine for her thyroid every morning before breakfast"],
  ["2026-01-22", "Ledger", "Dana banks with Northwind Bank"],
  ["2026-01-30", "Scout", "Dana does not eat meat"],
  ["2026-02-03", "Scout", "Dana studied architecture in Pune from 2018 to 2020"],
  ["2026-02-11", "Scout", "Dana prefers window seats on flights"],
  ["2026-02-18", "Scout", "Dana's partner is Sam Reyes, a nurse"],
  ["2026-02-20", "Scout", "Dana moved to Lisbon"],
  ["2026-03-02", "Scout", "Dana likes reminders sent to her task app, Tasklane"],
  ["2026-03-05", "Forge", "Dana prefers code reviews as a short bullet list"],
  ["2026-04-06", "Scout", "Dana goes to the gym on Wednesdays now"],
  ["2026-04-14", "Scout", "Dana's cat is called Pixel"],
  ["2026-05-04", "Scout", "Dana is now design lead at Fernhill"],
  ["2026-05-19", "Scout", "Dana runs a 10k most Sunday mornings"],
  ["2026-06-02", "Scout", "Dana is learning Portuguese with a tutor on Tuesdays"],
  ["2026-07-01", "Scout", "Dana lives in Porto"],
  ["2026-07-14", "Scout", "Dana prefers aisle seats on long flights"],
  ["2026-08-03", "Scout", "Dana goes to the gym on Fridays"],
  ["2026-08-10", "Scout", "Ana's email changed to ana@okaforstudio.example"],
  ["2026-08-21", "Scout", "Dana's favourite restaurant in Porto is Musa da Bica, a vegetarian place"],
  ["2026-09-07", "Scout", "Dana is head of design at Kestrel Labs since September 2026"],
  ["2026-09-15", "Ledger", "Dana is paid monthly on the 25th"],
  ["2026-10-04", "Scout", "Dana goes to the gym on Saturdays"],
  ["2026-10-12", "Scout", "Dana's dog-sitter is Inês, phone +351 912 000 111"],
  ["2026-10-30", "Scout", "Dana's cat Pixel needs a vet check-up every March"],
  ["2026-11-02", "Scout", "Dana cannot eat cashews: allergy"],
];

/** About me as it reads after months of v1 upkeep: replaced lines already left it, near-duplicates have not. */
const replacedInAboutMe = new Set([
  "Dana lives in Berlin",
  "Dana moved to Lisbon",
  "Dana goes to the gym on Mondays",
  "Dana goes to the gym on Wednesdays now",
  "Dana goes to the gym on Fridays",
  "Dana works as a senior designer at Fernhill",
  "Dana is now design lead at Fernhill",
  "Dana's sister is Ana Okafor, email ana.okafor@example.com",
  "Dana prefers window seats on flights",
]);

const line = (date: string, bot: string, fact: string) => `- ${date} · learned by ${bot} · ${fact}`;

export const ABOUT_ME = [
  ...typed,
  "",
  ...learned.filter(([, , fact]) => !replacedInAboutMe.has(fact)).map(([date, bot, fact]) => line(date, bot, fact)),
  "- 2026-08-10 · learned by Scout · Dana's sister is Ana Okafor",
].join("\n");

export const LEARNED_JSON = {
  learned: learned.filter(([, , fact]) => !replacedInAboutMe.has(fact)).map(([date, bot, fact], i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    text: fact,
    line: line(date, bot, fact),
    botId: bot.toLowerCase(),
    botName: bot,
    at: Date.parse(`${date}T10:00:00Z`),
  })),
  removed: [],
  forgotten: [],
};

/** The history consolidation keeps of lines that left About me. */
export const GENERAL_HISTORY = {
  entries: learned.filter(([, , fact]) => replacedInAboutMe.has(fact)).map(([date, bot, fact], i) => ({
    id: `hist-${i + 1}`,
    line: line(date, bot, fact),
    fact,
    reason: "replaced",
    by: bot,
    at: Date.parse(`${date}T10:00:00Z`) + 86_400_000 * 30,
  })),
};

const memoryHeader = `# Memory

Durable notes this bot keeps between tasks. The first 200 lines
load at the start of every session: keep this file short and curated.
Longer notes belong in memory/<topic>.md files, read on demand.
`;

const entry = (date: string, chat: string, fact: string, marks = "") => `- ${date} · from chat "${chat}" (noticed) · ${fact}${marks}`;
const struck = (date: string, chat: string, fact: string, superseded: string) => `- ${date} · from chat "${chat}" (noticed) · ~~${fact}~~ · superseded ${superseded}`;

const scoutMemory = [
  memoryHeader,
  entry("2026-01-08", "Hello", "Dana wants plans as a numbered list with times"),
  entry("2026-01-10", "Week plan", "Weekly plan goes out on Sunday evening"),
  struck("2026-01-12", "Gym", "Dana's gym slot is Monday 07:00 at Urban Fit Berlin", "2026-04-06"),
  struck("2026-04-06", "Gym", "Dana's gym slot is Wednesday 18:30 at Lisbon Fit Club", "2026-08-03"),
  struck("2026-08-03", "Gym", "Dana's gym slot is Friday 07:30 at Ginásio Boavista", "2026-10-04"),
  entry("2026-10-04", "Gym", "Dana's gym slot is Saturday 09:00 at Ginásio Boavista"),
  entry("2026-01-18", "Calls", "Dana does not take calls before 10:00"),
  entry("2026-02-02", "Groceries", "Groceries are ordered from Continente on Thursdays"),
  entry("2026-02-25", "Plants", "The balcony plants are watered on Mondays and Thursdays"),
  entry("2026-03-03", "Reminders", "Reminders go to Tasklane, never email"),
  entry("2026-03-28", "Car", "Dana sold her car in March 2026 and uses the metro"),
  entry("2026-05-06", "Calendar", "Work calendar is the Kestrel Google calendar; personal is iCloud"),
  entry("2026-06-11", "Portuguese", "Portuguese tutor is Marta, Tuesdays 19:00 online"),
  entry("2026-07-02", "Move", "New address: Rua da Boavista 120, 4050 Porto"),
  entry("2026-07-20", "Laundry", "Laundry pickup is every second Wednesday"),
  entry("2026-09-01", "Seoul", "Dana's Seoul trip is 2026-11-28 to 2026-12-05", " · until 2026-12-05"),
  entry("2026-10-20", "Dentist", "Dentist appointment reminder for 2026-10-28", " · until 2026-10-28"),
  entry("2026-10-22", "Books", "Dana is reading 'The Overstory' with her book club, which meets on the last Thursday of the month"),
  entry("2026-11-03", "Gifts", "Sam's birthday is 2026-12-14; Dana wants gift ideas by December 1"),
].join("\n") + "\n";

const travelTopic = `---
title: Travel
description: Trips Dana took or planned, and how she likes to travel
aliases: [trips, flights, holidays, vacation, journeys]
---
# Travel

- 2025-10-02 · from chat "Rome" (noticed) · Dana went to Rome from 2025-10-02 to 2025-10-06 for a friend's wedding
- 2026-02-11 · from chat "Flights" (noticed) · ~~Dana prefers window seats~~ · superseded 2026-07-14
- 2026-03-01 · from chat "Tokyo" (noticed) · Dana travelled to Tokyo from 2026-03-12 to 2026-03-20 for the Design Matters conference
- 2026-03-21 · from chat "Tokyo" (noticed) · In Tokyo Dana loved the vegetarian ramen at Ain Soph Ripple
- 2026-05-02 · from chat "Marrakech" (noticed) · Dana spent 2026-05-08 to 2026-05-12 in Marrakech with Sam
- 2026-07-14 · from chat "Flights" (noticed) · Dana prefers aisle seats on long flights
- 2026-07-24 · from chat "Copenhagen" (noticed) · Dana went to Copenhagen from 2026-07-24 to 2026-07-27 to see the Louisiana museum
- 2026-09-10 · from chat "CDMX" (noticed) · Dana was in Mexico City from 2026-09-18 to 2026-09-25 for Kestrel's offsite
- 2026-09-01 · from chat "Seoul" (noticed) · Dana's next trip is Seoul, 2026-11-28 to 2026-12-05, flying TAP via Frankfurt
- 2026-06-20 · from chat "Passport" (noticed) · Dana's passport expires in 2029
`;

const peopleTopic = `---
title: People
description: Friends, family and contacts in Dana's life
aliases: [friends, family, contacts, relatives]
---
# People

- 2026-01-15 · from chat "Family" (noticed) · ~~Dana's sister Ana Okafor's email is ana.okafor@example.com~~ · superseded 2026-08-10
- 2026-08-10 · from chat "Family" (noticed) · Dana's sister Ana Okafor's email is ana@okaforstudio.example; she runs a ceramics studio
- 2026-01-15 · from chat "Family" (noticed) · Tomi Okafor, Dana's brother, lives in Lagos; his kids are Ada and Chidi
- 2026-02-26 · from chat "Friends" (noticed) · Priya Shah is Dana's closest friend from university; she lives in Pune and works at Infosys
- 2026-05-14 · from chat "Friends" (noticed) · Rohan Mehta, Dana's former colleague, moved to Pune in May 2026 to start a studio
- 2026-06-03 · from chat "Friends" (noticed) · Lucía Ferraz is Dana's running partner in Porto
- 2026-09-30 · from chat "Mentor" (noticed) · Dana meets her mentor Grace Lin on the first Monday of each month
`;

const healthTopic = `---
title: Health
description: Health, diet and medication
aliases: [medical, medicine, doctor, diet, food, allergy]
---
# Health

- 2026-01-20 · from chat "Health" (noticed) · Dana takes 50 mcg levothyroxine every morning on an empty stomach
- 2026-02-14 · from chat "Health" (noticed) · Dana's GP in Lisbon was Dr. Ruth Alves; she has not picked a GP in Porto yet
- 2026-03-30 · from chat "Food" (noticed) · Dana cannot have cashews or cashew milk; almonds are fine
- 2026-06-18 · from chat "Health" (noticed) · Dana had a sprained ankle in June 2026 and paused running until July
`;

const restaurantsTopic = `---
title: Restaurants
description: Places Dana liked or wants to try
aliases: [food, dinner, lunch, eating out, cafes]
---
# Restaurants

- 2026-02-27 · from chat "Lisbon food" (noticed) · Dana liked Ao 26 Vegan Food Project in Lisbon
- 2026-05-30 · from chat "Lisbon food" (noticed) · Dana liked the tasting menu at Arkhe in Lisbon
- 2026-08-21 · from chat "Porto food" (noticed) · Musa da Bica in Porto is Dana's favourite, vegetarian
- 2026-10-09 · from chat "Porto food" (noticed) · Dana wants to try Oficina in Porto
`;

const scoutArchive = `- 2025-12-20 · from chat "Hello" (noticed) · Dana is setting up her bots before the holidays · moved 2026-03-01
- 2026-01-25 · from chat "Berlin" (noticed) · Dana's Berlin flat lease ends in February · until 2026-02-28 · moved 2026-03-02
`;

const forgeMemory = [
  memoryHeader,
  entry("2026-01-14", "Atlas kickoff", "Project Atlas is a Next.js app with a Hono API"),
  entry("2026-01-14", "Atlas kickoff", "Atlas uses pnpm, never npm"),
  struck("2026-01-14", "Atlas kickoff", "Atlas stores data in Postgres", "2026-04-09"),
  entry("2026-04-09", "Atlas data", "Atlas moved from Postgres to MongoDB in April 2026"),
  struck("2026-02-02", "Atlas deploy", "Atlas deploys to Fly.io; staging is atlas-staging.fly.dev", "2026-06-16"),
  entry("2026-06-16", "Atlas deploy", "Atlas deploys to Railway; staging is atlas-staging.up.railway.app"),
  struck("2026-03-10", "Atlas launch", "Atlas launches on 2026-11-15", "2026-10-01"),
  entry("2026-10-01", "Atlas launch", "Atlas launch moved to 2026-12-03"),
  entry("2026-03-05", "Reviews", "Code reviews go as a short bullet list, blockers first"),
  entry("2026-05-21", "Atlas tests", "Atlas runs Vitest for unit tests and Playwright for e2e"),
  entry("2026-08-12", "Atlas team", "Atlas's backend lead is Jonas Weber; designer is Dana"),
].join("\n") + "\n";

const atlasTopic = `---
title: Atlas
description: Decisions and details of project Atlas
aliases: [atlas, project, app, deploy, database]
---
# Atlas

- 2026-01-14 · from chat "Atlas kickoff" (noticed) · Atlas's repository is github.com/kestrel-labs/atlas
- 2026-04-09 · from chat "Atlas data" (noticed) · Atlas chose MongoDB Atlas M10 in eu-west because the data is document-shaped
- 2026-06-16 · from chat "Atlas deploy" (noticed) · Atlas moved off Fly.io to Railway after two outages in May
- 2026-07-08 · from chat "Atlas auth" (noticed) · Atlas uses passkeys first, email magic links as fallback
- 2026-09-02 · from chat "Atlas perf" (noticed) · Atlas's p95 API latency budget is 200 ms
- 2026-10-01 · from chat "Atlas launch" (noticed) · The launch slipped to 2026-12-03 because of the payments review
`;

const ledgerMemory = [
  memoryHeader,
  entry("2026-01-22", "Budget", "Dana's monthly grocery budget is €450"),
  entry("2026-01-22", "Budget", "Dana saves 20% of her salary into an index fund"),
  entry("2026-02-05", "Taxes", "Dana's accountant is Helga Brandt, who files her tax return"),
  struck("2026-02-05", "Taxes", "Dana files taxes in Germany", "2026-07-03"),
  entry("2026-07-03", "Taxes", "From 2026 Dana files taxes in Portugal under the NHR successor regime"),
  entry("2026-09-15", "Income", "Dana's salary arrives on the 25th of each month"),
  entry("2026-10-02", "Subscriptions", "Dana pays for Figma, Notion and Spotify; Spotify is shared with Sam"),
].join("\n") + "\n";

const ledgerTopic = `---
title: Taxes
description: Tax filings and deadlines
aliases: [tax, irs, finances, accountant]
---
# Taxes

- 2026-02-05 · from chat "Taxes" (noticed) · Helga Brandt charges €600 per return
- 2026-07-03 · from chat "Taxes" (noticed) · Portuguese tax return (IRS) is due 2027-06-30
`;

export const FILES: Record<BotKey, Record<string, string>> = {
  Scout: {
    "MEMORY.md": scoutMemory,
    "memory/travel.md": travelTopic,
    "memory/people.md": peopleTopic,
    "memory/health.md": healthTopic,
    "memory/restaurants.md": restaurantsTopic,
    "memory/archive.md": scoutArchive,
  },
  Forge: { "MEMORY.md": forgeMemory, "memory/atlas.md": atlasTopic },
  Ledger: { "MEMORY.md": ledgerMemory, "memory/taxes.md": ledgerTopic },
};

/** Writes the corpus into a stopped sandbox's data folder, for bots created with these ids. */
export function writeCorpus(data: string, bots: Record<BotKey, { id: string }>): void {
  const config = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
  config.profile = { ...config.profile, name: "Dana", aboutMe: ABOUT_ME };
  writeFileSync(join(data, "config.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
  const ids = Object.fromEntries((Object.keys(bots) as BotKey[]).map((name) => [name.toLowerCase(), bots[name].id]));
  const learned = { ...LEARNED_JSON, learned: LEARNED_JSON.learned.map((fact) => ({ ...fact, botId: ids[fact.botId] ?? fact.botId })) };
  writeFileSync(join(data, "profile-learned.json"), JSON.stringify(learned, null, 2), { mode: 0o600 });
  writeFileSync(join(data, "general-memory-history.json"), JSON.stringify(GENERAL_HISTORY, null, 2), { mode: 0o600 });
  for (const name of Object.keys(bots) as BotKey[]) {
    for (const [path, text] of Object.entries(FILES[name])) {
      const file = join(data, "workspaces", bots[name].id, path);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, text, { mode: 0o600 });
    }
  }
}

