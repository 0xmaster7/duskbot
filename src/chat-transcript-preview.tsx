// Dev-only gallery of a Simple mode transcript, served at /chat-transcript-preview.html; not in the packaged app. It
// mounts the real ChatView over a fixed store, with no server behind it.
// ?state=done|working|question|approval|empty|grok|grok-md|answered|cards|setup&skin=grok|grok-dark|midnight&tools=1&bot=amy&error=words
// state=grok mirrors the grok sandbox's Amy chat line for line, so the two can be compared pixel for pixel.
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "@/components/ChatView";
import { loadLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { applySkinChoice, SKIN_IDS, type SkinId } from "@/lib/skins";
import { initialState, StoreContext, type AppState, type Bot, type Message } from "@/state/store";
import "./font-faces";
import "./styles.css";

const params = new URLSearchParams(location.search);
const stateName = params.get("state") ?? "done";
const skin = params.get("skin") ?? "grok";
setAdvancedMode(false);
applySkinChoice(SKIN_IDS.includes(skin as SkinId) ? (skin as SkinId) : "midnight");
await loadLocale("en");

const AT = new Date(new Date().setHours(11, 32, 0, 0)).getTime();
const amy = params.get("bot") === "amy";
const botName = amy ? "Amy" : "Jordan";
const message = (id: string, minutes: number, fields: Partial<Message>): Message =>
  ({ id, at: AT + minutes * 60_000, role: "bot", kind: "text", text: "", ...fields }) as Message;
const step = (id: string, minutes: number, name: string, input: Record<string, unknown>, ok: boolean | undefined = true): Message =>
  message(id, minutes, { kind: "activity", turnId: "t1", tool: { name, input: JSON.stringify(input), ok } });

const REPLY = `Only one script in there got real praise from Jordan. The others got pushback or no reaction at all.

- **Anthropic IPO: Everything You Need to Know:** today at 5:52 PM IST he said "[Guys this was class script](https://slack.com/archives/C1/p1)". The pitch is pro-AI with no politics.
- **Why OpenAI Is Far Scarier Than BlackRock:** no praise. On the first draft he said "not provocative enough" and that it read like a report. See [the doc](https://docs.google.com/document/d/abc).
- **money waiting:** rutu \`$80\`, okara myndlab $150 at month end.

The channel only keeps messages back to about Oct 20, so anything older is gone.

\`\`\`bash
pnpm scripts:pull --channel jordan-lee-youtube
\`\`\``;

const FUNNEL = "## Weekly funnel\n\nConversions are **up 12%** week over week.\n\n- Landing page CTR: 4.1% -> 4.6%\n- Checkout drop-off: 38% -> 31%\n- Webinar signups: 212\n\n```\npython3 report.py --week 45\n```\n\nWant me to send this to Jordan?";
const RICH = "# Big heading\n\nIntro with `inline code` and a [Google doc](https://docs.google.com/document/d/abc) and https://example.org/raw.\n\n### Small heading\n\n1. First item\n2. Second item\n\n> A quoted line that wraps a bit to show the quote style.\n\n| Metric | Before | After |\n| --- | --- | --- |\n| CTR | 4.1% | 4.6% |\n| Drop-off | 38% | 31% |\n\n```bash\npnpm scripts:pull --channel jordan\n```\n\n---\n\n*italic* and ~~struck~~ text.";

function grokRows(): Message[] {
  const ask = { kind: "options", text: "Which channel should the Monday report go to?", card: { title: "Which channel should the Monday report go to?", subtitle: "Which channel should the Monday report go to?", options: ["Slack #growth", "Email", "Just here"], requestId: "rq", requestType: "question", ...(stateName === "answered" ? { answered: "answer", answeredText: "Email" } : {}) } } as Partial<Message>;
  const list: Message[] = [
    message("u1", 0, { role: "user", text: `Hey ${botName}, can you check what changed in the funnel this week?` }),
    message("a1", 1.5, { text: stateName === "grok-md" ? RICH : FUNNEL, turnId: "t1", turnTerminal: true }),
    message("u2", 3, { role: "user", text: "Nice. Yes, and set up a routine for every Monday." }),
    message("a2", 4.5, { text: "Done. I sent the summary to Jordan and created a Monday 9:00 routine.", turnId: "t2", turnTerminal: true }),
    message("w1", 6, ask),
  ];
  return list.map((one, index, all) => ({ ...one, parentId: all[index - 1]?.id }));
}

// state=cards: grok's Amy sandbox chat, its images, file cards, link, voice memo and a reaction
function cardRows(): Message[] {
  const id = (name: string) => `123e4567-e89b-12d3-a456-4266141740${name}`;
  const list: Message[] = [
    message("c1", 0, { role: "user", text: "Can you grab the screenshots from the launch thread?" }),
    message("c2", 1, { text: "Here are the two from the thread, the sunset one is the hero shot.", turnId: "c", turnTerminal: true,
      attachments: [{ kind: "image", path: `/attachments/${id("01")}.png`, mime: "image/png" }, { kind: "image", path: `/attachments/${id("02")}.png`, mime: "image/png" },
        { kind: "file", path: `/attachments/${id("03")}.pdf`, mime: "application/pdf", name: "Q4-sponsor-deck.pdf" }, { kind: "file", path: `/attachments/${id("04")}.xlsx`, mime: "application/vnd.ms-excel", name: "creator-rates.xlsx" }],
      reactions: [{ emoji: "❤️", by: "user", at: AT }] }),
    message("c3", 2, { role: "user", text: "And the repo link?" }),
    message("c4", 3, { text: "Also this one is worth a watch before the call: https://www.youtube.com/watch?v=dQw4w9WgXcQ", turnId: "d", turnTerminal: true }),
    message("c5", 3.2, { text: "Quick recap while you were out.", turnId: "e", turnTerminal: true,
      attachments: [{ kind: "audio", path: `/attachments/${id("05")}.mp3`, mime: "audio/mpeg", durationMs: 6000, text: "Quick recap while you were out: Prasenjit replied and the deck is ready." }] }),
    message("c6", 4, { role: "user", text: "ok send him the yes" }),
  ];
  return list.map((one, index, all) => ({ ...one, parentId: all[index - 1]?.id }));
}

function rows(): Message[] {
  if (stateName === "cards") return cardRows();
  // state=setup: a new bot's greeting and its first-run question card
  if (stateName === "setup") return [message("hi", 0, { text: `Hi, I'm ${botName}. What would you like me to do?`, setupOffer: true, turnId: "s", turnTerminal: true })];
  if (stateName === "grok" || stateName === "grok-md" || stateName === "answered") return grokRows();
  const base: Message[] = [
    message("intro", -400, { text: "took the tinyfish invite on unfair: TinyResearch / TinySet from @Tiny_Fish, $150 for a quote. their post goes up tonight at 10:30 PM IST, and from then you have 12 hours to quote it." }),
    message("ask", 0, { role: "user", text: "can you check some good scripts that jordan said class or REALLY liked from the jordanleeyoutube channel in slack, give links" }),
    message("progress", 0.2, { text: "Searching #jordan-lee-youtube for scripts Jordan loved.", turnId: "t1" }),
    step("s1", 0.3, "mcp__slack__search_messages", { query: "class script in:#jordan-lee-youtube" }),
    step("s2", 0.5, "WebFetch", { url: "https://docs.google.com/document/d/abc" }),
    step("s3", 0.6, "Read", { file_path: "/Users/me/scripts/anthropic-ipo.md" }),
  ];
  if (stateName === "working") base.push(step("s4", 0.7, "Bash", { command: "pnpm scripts:pull" }, undefined));
  else base.push(message("answer", 1, { text: REPLY, turnId: "t1", turnTerminal: true }));
  if (stateName === "question") {
    base.push(message("q", 40, { kind: "options", text: "send the reply to vitaliu?", card: { title: "send the reply to vitaliu?", subtitle: "send the reply to vitaliu?", options: ["send it", "skip"], requestId: "rq", requestType: "question" } }));
  }
  if (stateName === "approval") {
    base.push(message("ap", 40, { kind: "options", text: "git push origin main", card: { title: "Approval needed", subtitle: "git push origin fix/pricing-page-footer", options: ["Allow", "Deny"], requestId: "ra", requestType: "permission", tool: "Bash" } }));
  }
  return base.map((one, index, all) => ({ ...one, parentId: all[index - 1]?.id }));
}

const shown = stateName === "empty" ? [] : rows();
const bot: Bot = {
  id: amy ? "amy" : "jordan", name: botName, title: "", description: stateName === "setup" ? "" : "Writes and checks scripts for the channel.", color: amy ? "pink" : "red", notifications: true, unread: false,
  threadId: "main", busy: stateName === "working", activity: stateName === "working" ? "working" : stateName === "question" || stateName === "approval" || stateName === "grok" || stateName === "grok-md" ? "waiting-on-you" : "idle",
  turnStartedAt: AT, messages: shown, activeLeafId: shown.at(-1)?.id, modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
  tasks: [{ threadId: "main", title: botName, createdAt: AT - 86_400_000 }],
} as Bot;

const state: AppState = { ...initialState, bots: [bot], selectedId: bot.id, connected: true, error: params.get("error"), instances: [{ instanceId: "claude", capabilities: { agentsMcp: true } }] as unknown as AppState["instances"],
  config: { features: { showToolCalls: params.get("tools") === "1" } } as unknown as AppState["config"] };
const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

// &append=1: a reply arrives 1.5s after load, to record how a new row enters.
function Live() {
  const [shown, setShown] = useState(bot);
  useEffect(() => {
    if (params.get("append") !== "1") return;
    const timer = setTimeout(() => {
      const next = { ...message("late", 0, { text: "Here is one more reply that just arrived.", parentId: bot.messages.at(-1)?.id, turnId: "t9", turnTerminal: true }), at: Date.now() };
      setShown((current) => ({ ...current, messages: [...current.messages, next], activeLeafId: next.id }));
    }, 1500);
    return () => clearTimeout(timer);
  }, []);
  const live = useMemo(() => ({ ...value, state: { ...state, bots: [shown] } }), [shown]);
  return (
    <StoreContext.Provider value={live}>
      <div className="flex h-dvh w-full overflow-hidden bg-app text-ink"><div className="flex min-w-0 flex-1 flex-col"><ChatView bot={shown} /></div></div>
    </StoreContext.Provider>
  );
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!new URL(url, location.href).pathname.startsWith("/api/")) return realFetch(input, init);
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Live />
  </StrictMode>,
);
