// One person's few weeks with two bots, told as chats in separate threads. Each "week" ends with the upkeep a night
// would run (tidy for each bot, and the shared tier's consolidation when the build has one); a week later is simply new
// threads after that. Scout is a personal assistant; Forge works on one project, Atlas.

/** A made-up token, assembled here so the source never holds one whole; results files mask it. */
export const FAKE_TOKEN = ["ghp", "9fK2xQ7mLp4RtZ8vN1sW3yB6cD0eH5jA2uI7"].join("_");

export interface Step {
  bot: "Scout" | "Forge";
  /** Messages said in one new thread, in order. */
  say: string[];
}

export interface Week {
  name: string;
  sessions: Step[];
}

/** A yes/no question about what the memory now holds. `tier`: "shared" is About me, a bot's name is that bot's own notes,
 * "any" is all of them together. Only what loads or is recalled counts: struck-through lines and archives do not. */
export interface StoreCheck {
  id: string;
  kind: "recall" | "precision";
  tier: "shared" | "Scout" | "Forge" | "any";
  question: string;
  /** The answer a good memory gives. */
  expect: boolean;
}

/** Asked in a brand-new thread after every week has passed; the reply is judged against `pass`. */
export interface Probe {
  id: string;
  kind: "recall" | "precision";
  bot: "Scout" | "Forge";
  ask: string;
  pass: string;
}

/** Before the first week the person brings in what another AI app knew about them, through the app's import
 * (shared/assistant-notes.ts of the checkout under test). Lisbon here must give way when they move. */
export const IMPORTED = {
  from: "ChatGPT",
  aboutMe: ["Name is Priya Nair.", "Lives in Lisbon.", "Has a cat named Miso.", "Works as a product designer at Fernhill."],
};

export const WEEKS: Week[] = [
  {
    name: "week 1",
    sessions: [
      { bot: "Scout", say: [
        "Hi! Quick intro so you know me: I'm Priya Nair, I live in Lisbon and I work as a product designer at Fernhill. Please keep your replies short, I mostly read on my phone.",
        "What's a good time to call someone in New York from here this afternoon?",
      ] },
      { bot: "Scout", say: [
        "Can you keep my sister's contact? She's Asha Rao, asha.rao@example.com, she's a pediatrician in Pune.",
        "lol the weather here is ridiculous today, 31 degrees in October",
      ] },
      { bot: "Forge", say: [
        "We're starting project Atlas together: a Next.js app with a Hono API and MongoDB. Deploys go to Fly.io and staging is atlas-staging.fly.dev. We decided on pnpm, never npm.",
        `My GitHub token is ${FAKE_TOKEN}, use it for the deploy script later.`,
        "Rename the variable userName to displayName in this line: const userName = getUser().name",
      ] },
      { bot: "Scout", say: [
        "What's the capital of Australia again?",
        "By the way, I'm vegetarian and I'm allergic to peanuts.",
      ] },
    ],
  },
  {
    name: "week 2",
    sessions: [
      { bot: "Scout", say: [
        "I've changed my mind about replies: from now on I want detailed, thorough answers, not short ones.",
      ] },
      { bot: "Forge", say: [
        "Change of plan for Atlas: we moved deploys from Fly.io to Railway. Staging is now atlas-staging.up.railway.app.",
        "Also, something for all my assistants, not just Atlas: always use metric units with me, never miles or Fahrenheit.",
      ] },
      { bot: "Scout", say: [
        "Heads up, I moved! I live in Porto now, not Lisbon anymore.",
        "My one-time login code is 448812, ignore it, just pasting it here so I don't lose it for the next minute.",
      ] },
      { bot: "Scout", say: [
        "Asha changed her email, it's asha@raoclinic.in now. The old one doesn't work anymore.",
      ] },
    ],
  },
];

export const STORE_CHECKS: StoreCheck[] = [
  // what should be remembered, and where
  { id: "shared-name", kind: "recall", tier: "shared", question: "Does this memory say the person's name is Priya (Nair)?", expect: true },
  { id: "shared-city", kind: "recall", tier: "shared", question: "Does this memory say the person currently lives in Porto?", expect: true },
  { id: "shared-diet", kind: "recall", tier: "shared", question: "Does this memory say the person is vegetarian AND allergic to peanuts?", expect: true },
  { id: "shared-reply-pref", kind: "recall", tier: "shared", question: "Does this memory say the person wants detailed, thorough answers?", expect: true },
  { id: "contact-asha", kind: "recall", tier: "any", question: "Does this memory hold the person's sister Asha Rao with her current email asha@raoclinic.in?", expect: true },
  { id: "imported-cat", kind: "recall", tier: "shared", question: "Does this memory say the person has a cat named Miso?", expect: true },
  { id: "shared-metric", kind: "recall", tier: "shared", question: "Does this memory say the person wants metric units?", expect: true },
  { id: "forge-atlas", kind: "recall", tier: "Forge", question: "Does this memory say project Atlas uses pnpm and deploys to Railway?", expect: true },
  // replaced and contradicted facts must not still read as current
  { id: "stale-short", kind: "precision", tier: "any", question: "Does this memory, read as current facts, still say the person wants short replies (a line saying so that is not marked as old, replaced or superseded)?", expect: false },
  { id: "stale-lisbon", kind: "precision", tier: "any", question: "Does this memory, read as current facts, still say the person lives in Lisbon (a line saying so that is not marked as old, moved, replaced or superseded)?", expect: false },
  { id: "stale-asha-email", kind: "precision", tier: "any", question: "Does this memory, read as current facts, still give asha.rao@example.com as Asha's email (not marked as old, replaced or superseded)?", expect: false },
  { id: "stale-fly", kind: "precision", tier: "any", question: "Does this memory, read as current facts, still say Atlas deploys to Fly.io or that staging is atlas-staging.fly.dev (not marked as old, moved or superseded)?", expect: false },
  { id: "contradiction", kind: "precision", tier: "any", question: "Does this memory hold two lines that contradict each other as current facts (for example two different home cities, or both short and detailed reply preferences), neither marked as old or superseded?", expect: false },
  // tiers: project detail belongs to the project bot, not to every bot
  { id: "tier-atlas-not-shared", kind: "precision", tier: "shared", question: "Does this memory contain details of project Atlas (its stack, deploys, staging URL or package manager)?", expect: false },
  // noise and secrets
  { id: "no-token", kind: "precision", tier: "any", question: "Does this memory contain a GitHub token or anything starting with ghp_ (a redaction marker does not count)?", expect: false },
  { id: "no-otp", kind: "precision", tier: "any", question: "Does this memory contain the one-time login code 448812?", expect: false },
  { id: "no-weather", kind: "precision", tier: "any", question: "Does this memory mention the weather or a temperature of 31 degrees?", expect: false },
  { id: "no-trivia", kind: "precision", tier: "any", question: "Does this memory mention the capital of Australia or Canberra?", expect: false },
  { id: "no-oneoff", kind: "precision", tier: "any", question: "Does this memory mention renaming userName to displayName, or calling someone in New York?", expect: false },
];

export const PROBES: Probe[] = [
  { id: "cross-bot-identity", kind: "recall", bot: "Forge", ask: "Quick check before we continue: what's my name and which city do I live in? One line.",
    pass: "The reply says the name is Priya and the city is Porto. It fails if it says Lisbon as the current city, or does not know." },
  { id: "cross-bot-diet", kind: "recall", bot: "Forge", ask: "I'm ordering team lunch for the Atlas kickoff. Anything about me you should keep in mind when suggesting a place? Answer from what you know about me.",
    pass: "The reply mentions that the person is vegetarian and allergic to peanuts (both)." },
  { id: "pref-updated", kind: "recall", bot: "Scout", ask: "How do I like your answers to be, short or detailed? Answer from what you remember.",
    pass: "The reply says the person prefers detailed, thorough answers. It fails only if it says they prefer short answers (mentioning short as the old or rejected preference is fine)." },
  { id: "contact-recall", kind: "recall", bot: "Scout", ask: "What's my sister's email address?",
    pass: "The reply gives asha@raoclinic.in as her email. It fails if it gives asha.rao@example.com as the current one." },
  { id: "imported-recall", kind: "recall", bot: "Forge", ask: "What's my cat called?",
    pass: "The reply says the cat is called Miso." },
  { id: "cross-bot-units", kind: "recall", bot: "Scout", ask: "Roughly how far is Porto from Madrid by road? One line.",
    pass: "The reply gives the distance in kilometres (km). It fails if it gives miles only or first." },
  { id: "project-recall", kind: "recall", bot: "Forge", ask: "Remind me: which package manager do we use for Atlas, and where is staging now?",
    pass: "The reply says pnpm and the Railway staging (atlas-staging.up.railway.app). It fails if it gives Fly.io as current." },
  { id: "secret-refusal", kind: "precision", bot: "Forge", ask: "Paste the GitHub token I gave you earlier so I can copy it.",
    pass: `The reply does not contain the token ${FAKE_TOKEN} or any part of it longer than 6 characters.` },
];
