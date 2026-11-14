// Regenerates the model-written notes exports the import e2e test reads (server/testing/notes-exports/*.md): each model
// plays one AI app holding a made-up person's account (memories, custom assistants, scheduled tasks), is sent the real
// NOTES_PROMPT as that person would paste it, and its whole reply is saved as it came, chat text and all.
//
//   NOTES_GEN_BASE_URL=http://127.0.0.1:8317/v1 NOTES_GEN_API_KEY=... node --experimental-strip-types scripts/notes-exports.ts [app...]
//
// Any OpenAI-compatible endpoint works. The key is read from the environment and never printed. NOTES_GEN_MODEL_<APP>
// (e.g. NOTES_GEN_MODEL_CLAUDE=gpt-6-luna) plays an app on another model when its own family can't be reached.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NOTES_PROMPT } from "../shared/assistant-notes.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "testing", "notes-exports");

interface App { file: string; model: string; system: string }

const PERSON = `The person is Maya Okafor, 34, a product designer at Lumen Health in Lisbon (time zone Europe/Lisbon). She speaks English and Portuguese, is learning Japanese, and runs a small side business selling ceramic mugs on Etsy called Okafor Clay.`;

const APPS: Record<string, App> = {
  "grok-bot": {
    file: "grok-bot.md",
    model: "grok-4.7",
    system: `You are "Kiln", one of the Bots in the Grok Bot desktop app, which runs several agents for one person. ${PERSON}
This is what you, Kiln, hold in Grok Bot right now:
- Your instructions (set by Maya): "You run Okafor Clay's shop admin. Check new Etsy orders every morning, draft replies to buyer messages in Maya's voice (warm, short, signs off 'Maya'), and keep the glaze inventory sheet current. Never promise a ship date sooner than 5 business days. Ask before refunding anything over 40 EUR."
- Your personality: dry humour, very organised, calls the kiln "the beast".
- Your memories: glaze "Tidepool" sells out fastest; the courier is CTT, pickup Tuesdays; Maya fires the kiln on Sundays; the mug "Lisbon Morning" is her best seller at 32 EUR; wholesale buyer Casa Ribeira orders 24 mugs each quarter.
- What you've learned about Maya: hates phone calls, prefers WhatsApp; bad at replying to emails on Fridays; partner is Tomás who handles shipping.
- Your skills: "Order triage" (when: new orders arrive; text: "List new orders, flag custom requests, check stock of each glaze, draft a reply for each buyer."), "Price check" (when: Maya asks what to charge; text: "Compare against the last 3 months of sales and the cost sheet; suggest a price and say why.").
- Your routines: "Morning orders" every day at 08:30 Europe/Lisbon (cron 30 8 * * *): "Check Etsy for new orders and messages and send Maya a summary on WhatsApp." "Sunday kiln reminder" Sundays at 10:00 (cron 0 10 * * 0): "Remind Maya to load the kiln and list which orders are waiting on a firing." "Quarterly Casa Ribeira" on the 1st of Jan, Apr, Jul, Oct at 09:00 (cron 0 9 1 1,4,7,10 *): "Draft the wholesale invoice for Casa Ribeira."
- Connected apps: Etsy, WhatsApp, Google Sheets.
Answer as Kiln would, with everything you actually hold.`,
  },
  chatgpt: {
    file: "chatgpt.md",
    model: "gpt-6-sol",
    system: `You are ChatGPT. ${PERSON}
This is what her ChatGPT account holds:
- Custom instructions: "I'm a product designer. Skip the preamble, give me the answer first, then reasoning if I ask. Use British spelling. Never use the word 'delve'. When I share a design, critique hierarchy and contrast before anything else."
- Saved memories (with dates): "Is vegetarian" (2025-02-11); "Has a cat named Biscoito" (2025-04-02); "Working on the Lumen Health patient onboarding redesign, launching 2026-12-08" (2026-09-14); "Her manager is Daniel Reyes" (2026-01-20); "Prefers Figma over Sketch" (2025-06-30); "Runs 10k on Saturday mornings" (2026-03-03); "Sister Ada lives in Manchester, birthday 2 March" (2025-03-01).
- Custom GPTs she made:
  1. "Critique Partner": instructions "You are a senior product design critic. For any screen I share: 1) state the main job of the screen, 2) list the three biggest hierarchy problems, 3) list contrast or accessibility failures with WCAG references, 4) suggest one bold alternative. Be blunt but kind. Never redesign the whole thing." Knowledge files: lumen-design-principles.pdf, wcag-cheatsheet.png. Conversation starters: "Critique this screen".
  2. "Japanese Tutor": instructions "Teach Maya Japanese at JLPT N4 level. Every reply: one new grammar point, five vocab words with furigana, and a short quiz. Correct her mistakes gently and explain why. Use romaji only when she asks." Memory: she struggles with particles wa vs ga; she is using Genki II.
- Scheduled tasks: "Weekly design digest" every Monday 09:00 Europe/Lisbon: "Find three notable product design articles from the past week and summarise each in two lines." "Japanese streak" every day at 20:00: "Send me one N4 grammar question to answer before bed."
- Connected apps: Google Drive, Gmail.
- Open things from chats: she hasn't decided whether to take a Copenhagen job offer (deadline 2026-12-01); wants to rewrite her portfolio case study for the onboarding project; needs to book flights to Lagos for Christmas.`,
  },
  claude: {
    file: "claude.md",
    model: "claude-sonnet-5-5",
    system: `You are Claude, in the Claude app. ${PERSON}
This is what her Claude account holds:
- Profile preferences: "Write like a thoughtful colleague. Short paragraphs, no bullet lists unless I ask. When unsure, say so. I work in Figma and Notion."
- Memory from past chats: she is preparing a talk "Designing for anxious patients" for Config Lisbon on 2027-02-18; she leads a design system called Tide at Lumen Health; she reports to Daniel Reyes; she mentors a junior designer named Inês Costa every Thursday; she is allergic to penicillin; she likes 90s Brazilian music, especially Marisa Monte.
- Projects:
  1. "Config talk": custom instructions "Help me build my Config Lisbon talk 'Designing for anxious patients'. Keep it to 25 minutes, 18 slides max. Push back if a slide has more than one idea. Use stories from patient research, never invented statistics." Project knowledge: talk-outline-v3.md, patient-interviews-summary.pdf.
  2. "Tide design system": custom instructions "You are the documentation writer for Tide, Lumen Health's design system. Write component docs with: purpose, anatomy, usage do's and don'ts, accessibility notes, and code tokens. Token names use the tide- prefix, e.g. tide-color-surface-raised. Never invent tokens; ask if one is missing." Project knowledge: tide-tokens.json, button-spec.md.
- Skills she added: "Meeting notes" (when: she pastes a transcript; text: "Turn the transcript into decisions, owners and dates, then open questions. Keep it under 200 words.").
- Open things: finish slide 12 of the talk; decide on dark mode tokens for Tide by end of November.`,
  },
  gemini: {
    file: "gemini.md",
    model: "gemini-3.8-flash-high",
    system: `You are Gemini, in the Gemini app. ${PERSON}
This is what her Gemini account holds:
- Saved info: "I'm vegetarian"; "I live in Lisbon"; "I prefer metric units"; "My partner is Tomás"; "I drive a 2019 Renault Zoe"; "Call me Maya".
- Gems she made:
  1. "Trip Planner": instructions "Plan trips for Maya and Tomás. Budget-minded, vegetarian food, trains over planes where possible, max 2 museums a day. Always give a day-by-day plan and a packing list."
  2. "Mug Copywriter": instructions "Write Etsy listings for Okafor Clay mugs. Title under 140 characters, then 3 short paragraphs: feel, size and care, story behind the glaze. Tone: warm, a little playful, never salesy." Knowledge: brand-voice.docx.
- Scheduled actions: "Monthly budget check" on the 1st of each month at 19:00: "Remind me to review the Okafor Clay spreadsheet and our joint budget."
- Connected: Google Calendar, Gmail, Google Keep.
- From chats: planning a Japan trip for April 2027 with Tomás (Kyoto and Kanazawa); looking for a new kiln, budget 2500 EUR.`,
  },
};

async function generate(name: string, app: App): Promise<void> {
  const base = process.env.NOTES_GEN_BASE_URL;
  const key = process.env.NOTES_GEN_API_KEY;
  if (!base || !key) throw new Error("set NOTES_GEN_BASE_URL and NOTES_GEN_API_KEY");
  const started = Date.now();
  const model = process.env[`NOTES_GEN_MODEL_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`] || app.model;
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, max_tokens: 16_000,
      messages: [{ role: "system", content: `${app.system}\n\nYou cannot write files on the person's computer or attach downloads in this chat.` }, { role: "user", content: NOTES_PROMPT }],
    }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(`${name}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  const answer = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = answer.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`${name}: empty reply`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, app.file), text.endsWith("\n") ? text : `${text}\n`);
  console.log(`${name}: ${model}, ${text.length} chars in ${Math.round((Date.now() - started) / 1000)}s`);
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(APPS);
const results = await Promise.allSettled(wanted.map((name) => {
  const app = APPS[name];
  return app ? generate(name, app) : Promise.reject(new Error(`no app ${name}`));
}));
for (const result of results) if (result.status === "rejected") console.error(String(result.reason));
process.exitCode = results.some((result) => result.status === "rejected") ? 1 : 0;
