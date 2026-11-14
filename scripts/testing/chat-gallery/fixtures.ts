// The chat gallery's transcripts: every row kind the chat can draw, in its states, as the store holds them. Each
// scenario is one conversation, so the layout check sees each card between real bubbles, not alone on a page.
import type { Message } from "../../../src/state/store";
import { CUSTOM_SECRET_TARGET } from "../../../shared/credential-request";
import { WIDGET_SAMPLES } from "../../../shared/widget-samples";
import { parseWidgetInput, widgetToText, type WidgetPayload } from "../../../shared/widget";

export const GALLERY_IMAGE = "gallery-photo.png";
export const GALLERY_WIDE_IMAGE = "gallery-wide.png";

const LONG_WORD = "supercalifragilisticexpialidocious".repeat(4);
const LONG_URL = `https://example.com/a/very/long/path/${"segment-".repeat(20)}end?query=${"x".repeat(60)}`;
const LONG_SENTENCE = "This is a deliberately long line of plain words that keeps going so the card has to wrap it across several lines without pushing anything sideways or under the next row. ".repeat(2).trim();

export interface GalleryScenario {
  id: string;
  /** What the scenario shows, for the screenshot index. */
  title: string;
  messages: (botId: string, threadId: string) => Message[];
  busy?: boolean;
}

let clock = 0;
const base = Date.UTC(2026, 10, 14, 9, 0, 0);
const at = () => base + (clock += 30_000);
const ids = new Map<string, number>();
const id = (prefix: string) => { const n = (ids.get(prefix) ?? 0) + 1; ids.set(prefix, n); return `${prefix}-${n}`; };

const user = (text: string, extra: Partial<Message> = {}): Message => ({ id: id("u"), role: "user", kind: "text", text, at: at(), ...extra });
const bot = (text: string, extra: Partial<Message> = {}): Message => ({ id: id("b"), role: "bot", kind: "text", text, at: at(), turnTerminal: true, ...extra });
const row = (kind: Message["kind"], extra: Partial<Message>): Message => ({ id: id(kind), role: "bot", kind, at: at(), ...extra });

function widget(name: string, settled?: WidgetPayload["settled"]): Message {
  const parsed = parseWidgetInput(WIDGET_SAMPLES[name]);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`);
  return row("widget", { text: widgetToText(parsed.value), widget: { v: 1, root: parsed.value, ...(settled ? { settled } : {}) } });
}

const secret = (overrides: Partial<NonNullable<Message["secret"]>> = {}): NonNullable<Message["secret"]> => ({
  target: CUSTOM_SECRET_TARGET, label: "Stripe API key", description: "Used to read this month's payouts.", placeholder: "sk_live_...",
  helpUrl: "", requestKey: id("secret-key"), delivery: "ref", reason: "I need it to read this month's payouts for the report.", ...overrides,
});

/** A real transcript is a chain: each line answers the one before it. Without it every root line reads as an edit of the others. */
const chained = (list: Message[]): Message[] => list.map((message, index) => ({ ...message, parentId: index ? list[index - 1]!.id : null }));

const RAW_SCENARIOS: GalleryScenario[] = [
  {
    id: "cards-pending",
    title: "Every card that waits on the person, each under a bot reply",
    messages: () => [
      user("Can you sort out the payouts report and book the call?"),
      bot("Sure. I need a couple of things from you first, so I'll ask for them below."),
      row("secret", { secret: secret() }),
      bot("I'll also need to sign in to the dashboard."),
      row("secret", { secret: secret({ delivery: "login", label: "Stripe dashboard", site: "dashboard.stripe.com", placeholder: "Password", reason: "Log in so I can download the payout CSV." }) }),
      bot("And please sign in to the bank yourself."),
      row("signin", { signIn: { url: "https://bank.example.com/login", site: "bank.example.com", reason: "The bank asks for a code only you get.", place: "browser" } }),
      bot("Connecting Gmail lets me send the summary."),
      row("connector", { connector: { slug: "gmail", label: "Gmail", description: "Read and send email as you.", status: "required", resumeKey: "r1" } }),
      row("connector", { connector: { slug: "notion", label: "Notion", description: "Create and edit pages.", status: "failed", resumeKey: "r1", error: "The connection was refused. Try again." } }),
      bot("Which day works for the call?"),
      row("options", { card: { title: "Which day works for the call?", subtitle: "I'll book 30 minutes.", options: ["Monday morning", "Tuesday after lunch", "Wednesday at 4pm"], requestType: "question" } }),
      bot("One more:"),
      row("options", { card: { title: LONG_SENTENCE, subtitle: LONG_SENTENCE, options: [LONG_SENTENCE, `A ${LONG_WORD}`, "Short"], requestType: "question" } }),
    ],
  },
  {
    id: "cards-settled",
    title: "The same cards once answered, refused, replaced or stopped",
    messages: () => [
      user("Did that work?"),
      bot("Yes, here's where everything landed."),
      row("secret", { secret: secret({ provided: true, resumed: true, kept: "vault", savedAt: base }) }),
      row("secret", { secret: secret({ dismissed: true }) }),
      row("secret", { secret: secret({ superseded: true }) }),
      row("secret", { secret: secret({ error: "The server could not keep this key. Try again." }) }),
      row("signin", { signIn: { url: "https://bank.example.com/login", site: "bank.example.com", place: "browser", done: true, resumed: true } }),
      row("signin", { signIn: { url: "https://bank.example.com/login", site: "bank.example.com", place: "browser", cancelled: true } }),
      row("signin", { signIn: { url: "https://bank.example.com/login", site: "bank.example.com", place: "browser", error: "The page closed before you signed in." } }),
      row("connector", { connector: { slug: "gmail", label: "Gmail", description: "Read and send email as you.", status: "connected", resumeKey: "r1", resumed: true } }),
      row("connector", { connector: { slug: "slack", label: "Slack", description: "Post messages.", status: "authorizing", resumeKey: "r2" } }),
      row("options", { card: { title: "Which day works for the call?", subtitle: "", options: ["Monday", "Tuesday"], requestType: "question", answered: "Tuesday" } }),
      row("options", { card: { title: "Which day works for the call?", subtitle: "", options: ["Monday", "Tuesday"], requestType: "question", expired: true } }),
      bot("All set."),
    ],
  },
  {
    id: "widgets",
    title: "Every bot widget sample, pending and settled",
    messages: () => [
      user("Show me the options."),
      ...Object.keys(WIDGET_SAMPLES).flatMap((name) => [bot(`Here is the ${name} widget.`), widget(name)]),
      bot("And one already answered:"),
      widget("dinnerChoice", { ref: "n2", label: "Pick", tone: "submit", at: base, values: { dish: "pasta" } }),
    ],
  },
  {
    id: "runs",
    title: "Routine runs, team goal runs, calls, published pages and notices",
    messages: () => [
      user("What ran overnight?"),
      bot("Three routines ran."),
      row("routine.run", { routineRun: { runId: "run-1", routineId: "rt-1", routineName: "Morning inbox sweep", status: "completed", summary: "Archived 14 newsletters and flagged 2 invoices." } }),
      row("routine.run", { routineRun: { runId: "run-2", routineId: "rt-2", routineName: LONG_SENTENCE, status: "failed", error: "The site asked for a code." } }),
      row("routine.run", { routineRun: { runId: "run-3", routineId: "rt-3", routineName: "Weekly report", status: "running" } }),
      row("goal.run", { goalRun: { runId: "g-1", goal: "Ship the pricing page", status: "working", coordinatorBotId: "b", coordinatorName: "Pepper", turnCount: 3, maxTurns: 20, startedAt: base } }),
      row("goal.run", { goalRun: { runId: "g-2", goal: LONG_SENTENCE, status: "needs-input", coordinatorBotId: "b", coordinatorName: "Pepper", turnCount: 20, maxTurns: 20, detail: "Which plan names do we keep?", startedAt: base, finishedAt: base + 600_000 } }),
      row("call", { call: { callId: "c-1", botId: "b", client: "desktop", startedAt: base, endedAt: base + 185_000, seconds: 185, endReason: "hung-up", title: "Planning the launch" } }),
      row("text", { publishedPage: { state: "live", title: "Launch checklist", url: "https://pages.example.com/launch", pageId: "a".repeat(24), usage: { pages: 3, limit: 5 } }, text: "Published Launch checklist" }),
      row("text", { publishedPage: { state: "limit", title: "Another page", message: "Your plan's pages are used up.", upgrade: true, plan: "free" }, text: "Could not publish" }),
      row("activity", { tool: { name: "notice: The engine restarted, so I picked up where I left off." } }),
      row("activity", { tool: { name: "recovery: Reconnected to the browser." } }),
      row("activity", { tool: { name: "error: The model provider is overloaded.", partial: true } }),
      row("text", { setupSuggestion: { kind: "helperKey" }, text: "Add a key so I can help faster." }),
      row("text", { setupSuggestion: { kind: "watch" }, text: "Want me to keep an eye on your day?" }),
      row("text", { setupSuggestion: { kind: "watch", answer: "on" }, text: "Want me to keep an eye on your day?" }),
      bot("Done for now."),
    ],
  },
  {
    id: "text",
    title: "Prose, markdown, code, tables, long words and links, right-to-left text",
    messages: () => [
      user(`A very long message from me with a link ${LONG_URL} and a ${LONG_WORD} that must wrap inside my bubble.`),
      bot([
        "## A heading",
        "",
        `Some prose with a long link ${LONG_URL} and a word ${LONG_WORD}.`,
        "",
        "- one\n- two with **bold**\n- three",
        "",
        "```ts\nconst message = \"" + "a_long_value_".repeat(20) + "\";\nconsole.log(message);\n```",
        "",
        "| Name | Amount | Note |\n| --- | ---: | --- |\n| Alpha | 1,200 | " + LONG_SENTENCE + " |\n| Beta | 30 | ok |",
        "",
        "> A quote that also runs long enough to wrap onto a second line in a narrow window.",
      ].join("\n")),
      user("مرحبا، هل يمكنك مساعدتي في هذا التقرير؟"),
      bot("בטח, הנה סיכום קצר של הדוח."),
      user("short"),
      bot("ok"),
    ],
  },
  {
    id: "media",
    title: "Pictures, a picture grid and files in bubbles",
    messages: () => [
      // a person's pictures and files ride in their words as the composer writes them (composeMessage)
      user(`Here's the screenshot.\n\n<attached-image path="${GALLERY_IMAGE}" name="screen.png" />\n\n<attached-file path="notes.txt" name="${"meeting-notes-".repeat(4)}.txt" />`, { media: { [GALLERY_IMAGE]: { w: 1200, h: 800 } } }),
      bot("Here are four takes.", { attachments: [GALLERY_IMAGE, GALLERY_WIDE_IMAGE, GALLERY_IMAGE, GALLERY_WIDE_IMAGE].map((path, index) => ({ kind: "image" as const, path, mime: "image/png", name: `take-${index}.png` })), media: { [GALLERY_IMAGE]: { w: 1200, h: 800 }, [GALLERY_WIDE_IMAGE]: { w: 2400, h: 600 } } }),
      bot("And the files.", { attachments: [
        { kind: "file", path: "report.pdf", mime: "application/pdf", name: "report.pdf" },
        { kind: "file", path: "data.csv", mime: "text/csv", name: `${"quarterly-numbers-".repeat(5)}.csv` },
      ] }),
      user("Thanks"),
    ],
  },
];

export const SCENARIOS: GalleryScenario[] = RAW_SCENARIOS.map((scenario) => ({ ...scenario, messages: (botId, threadId) => chained(scenario.messages(botId, threadId)) }));
