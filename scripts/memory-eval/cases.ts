// The offline suite's questions over the corpus. Each is asked once, in a new thread, and scored only by what memory
// put in front of the model: key strings, never file names or formatting, so any build's memory can be scored.
import type { BotKey } from "./corpus.ts";

export type Category = "paraphrase" | "temporal" | "update-current" | "update-past" | "aggregation" | "abstention" | "sharing" | "isolation" | "trivial";

export interface Case {
  id: string;
  category: Category;
  bot: BotKey;
  ask: string;
  /** Each group is satisfied when any of its strings reached the model (case-insensitive). */
  expect?: string[][];
  /** Must not reach the model as a current fact: allowed only on a line marked as history. */
  stale?: string[];
  /** Must not reach the model at all. */
  leak?: string[];
}

export const CASES: Case[] = [
  // the words of the question are not the words of the note
  { id: "sibling-email", category: "paraphrase", bot: "Scout", ask: "What's my sibling's email address? I need to send her the photos.", expect: [["okaforstudio"]], stale: ["ana.okafor@example.com"] },
  { id: "morning-meds", category: "paraphrase", bot: "Scout", ask: "Which pills do I swallow first thing each day?", expect: [["levothyroxine"]] },
  { id: "who-does-taxes", category: "paraphrase", bot: "Ledger", ask: "Who handles my returns with the tax office?", expect: [["Helga"]] },
  { id: "cant-eat", category: "paraphrase", bot: "Scout", ask: "Booking a dinner: what foods should the restaurant keep off my plate?", expect: [["cashew"], ["vegetarian", "meat"]] },
  { id: "workout-day", category: "paraphrase", bot: "Scout", ask: "Which morning do I work out these days?", expect: [["Saturday"]], stale: ["Monday 07:00", "Wednesday 18:30", "Friday 07:30"] },
  { id: "pal-in-india", category: "paraphrase", bot: "Scout", ask: "My best mate from uni, where does she live now?", expect: [["Priya"]] },
  // dates and relative time
  { id: "last-spring-home", category: "temporal", bot: "Scout", ask: "Where was I living last spring?", expect: [["moved to Lisbon", "lived in Lisbon", "living in Lisbon", "Lisbon Fit Club", "lives in Lisbon"]] },
  { id: "march-trip", category: "temporal", bot: "Scout", ask: "Where did I travel in March?", expect: [["Tokyo"]] },
  { id: "june-job", category: "temporal", bot: "Scout", ask: "What was my job title back in June?", expect: [["design lead"]] },
  { id: "next-trip", category: "temporal", bot: "Scout", ask: "When is my next trip and where to?", expect: [["Seoul"]] },
  { id: "may-ankle", category: "temporal", bot: "Scout", ask: "What happened to my ankle earlier this summer?", expect: [["sprain"]] },
  // a fact that changed several times: the current value, with the old ones only as history
  { id: "gym-now", category: "update-current", bot: "Scout", ask: "What day is my gym session?", expect: [["Saturday"]], stale: ["Monday 07:00", "Wednesday 18:30", "Friday 07:30", "gym on Mondays", "gym on Wednesdays", "gym on Fridays"] },
  { id: "job-now", category: "update-current", bot: "Ledger", ask: "Where do I work and what's my role? Need it for a form.", expect: [["Kestrel"]], stale: ["senior designer at Fernhill", "design lead at Fernhill"] },
  { id: "home-now", category: "update-current", bot: "Forge", ask: "Which city should the launch party invite say I'm in?", expect: [["Porto"]], stale: ["lives in Berlin", "moved to Lisbon"] },
  { id: "atlas-db-now", category: "update-current", bot: "Forge", ask: "Remind me which database Atlas runs on.", expect: [["MongoDB"]], stale: ["stores data in Postgres"] },
  { id: "atlas-launch-now", category: "update-current", bot: "Forge", ask: "When does Atlas launch?", expect: [["2026-12-03"]], stale: ["launches on 2026-11-15"] },
  // and the old values when the question is about the past
  { id: "gym-april", category: "update-past", bot: "Scout", ask: "Which day did I go to the gym back in April?", expect: [["Wednesday"]] },
  { id: "atlas-old-host", category: "update-past", bot: "Forge", ask: "Where did Atlas deploy before the move, and why did we move?", expect: [["Fly.io"], ["outage"]] },
  { id: "old-email", category: "update-past", bot: "Scout", ask: "What was Ana's old email, before she changed it?", expect: [["ana.okafor@example.com"]] },
  // facts spread over months and files
  { id: "trips-this-year", category: "aggregation", bot: "Scout", ask: "List every trip I've taken this year.", expect: [["Tokyo"], ["Marrakech"], ["Copenhagen"], ["Mexico City"]], stale: [] },
  { id: "restaurants-liked", category: "aggregation", bot: "Scout", ask: "Which restaurants have I liked so far?", expect: [["Ao 26"], ["Arkhe"], ["Musa da Bica"], ["Ain Soph"]] },
  { id: "atlas-decisions", category: "aggregation", bot: "Forge", ask: "Summarise every decision we've made on Atlas this year.", expect: [["MongoDB"], ["Railway"], ["pnpm"], ["passkey"], ["2026-12-03"]] },
  { id: "family", category: "aggregation", bot: "Scout", ask: "Who's in my family, and how do I reach them?", expect: [["Ana"], ["Tomi"], ["okaforstudio"]] },
  // nothing in memory answers these
  { id: "dentist-name", category: "abstention", bot: "Scout", ask: "What's the name of my dentist?" },
  { id: "licence-plate", category: "abstention", bot: "Ledger", ask: "What's my car's licence plate number?" },
  { id: "shoe-size", category: "abstention", bot: "Scout", ask: "Did I ever tell you my shoe size?" },
  { id: "wifi-password", category: "abstention", bot: "Forge", ask: "What's the office wifi password?" },
  // a fact about the person reaches every bot
  { id: "ledger-home", category: "sharing", bot: "Ledger", ask: "Which city do I live in? It's for the tax address.", expect: [["Porto"]] },
  { id: "forge-allergy", category: "sharing", bot: "Forge", ask: "Ordering snacks for the Atlas team: anything I can't eat?", expect: [["cashew"]] },
  { id: "forge-units", category: "sharing", bot: "Forge", ask: "Should the dashboard show distances in miles or kilometres for me?", expect: [["metric"]] },
  // a bot's own work notes stay its own
  { id: "scout-no-atlas", category: "isolation", bot: "Scout", ask: "What database and host does the Atlas project use?", leak: ["MongoDB Atlas M10", "Railway", "atlas-staging"] },
  { id: "forge-no-budget", category: "isolation", bot: "Forge", ask: "What's my monthly grocery budget?", leak: ["€450"] },
  { id: "ledger-no-gym", category: "isolation", bot: "Ledger", ask: "What time is my gym slot at Ginásio Boavista?", leak: ["Saturday 09:00"] },
  // nothing to recall for these
  { id: "ok", category: "trivial", bot: "Scout", ask: "ok" },
  { id: "thanks", category: "trivial", bot: "Scout", ask: "thanks!" },
  { id: "thumbs", category: "trivial", bot: "Forge", ask: "👍 sounds good" },
];

/** A line that says its fact is history, not current. */
export const HISTORY_MARK = /~~|supersed|previous|no longer|\bended\b|\buntil\b|\bwas\b|\bused to\b|\bformer|\bold\b|replaced|moved (?:from|off)|\bbefore\b|valid (?:to|until)|\bpast\b|\bchanged\b/i;
