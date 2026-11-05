// Dev-only gallery of a Simple mode transcript, served at /chat-transcript-preview.html; not in the packaged app. It
// mounts the real ChatView over a fixed store, with no server behind it.
// ?state=done|working|question|approval|empty&skin=grok|grok-dark|midnight&tools=1
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "@/components/ChatView";
import { loadLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { applySkinChoice, SKIN_IDS, type SkinId } from "@/lib/skins";
import { initialState, StoreContext, type AppState, type Bot, type Message } from "@/state/store";
import "./styles.css";

const params = new URLSearchParams(location.search);
const stateName = params.get("state") ?? "done";
const skin = params.get("skin") ?? "grok";
setAdvancedMode(false);
applySkinChoice(SKIN_IDS.includes(skin as SkinId) ? (skin as SkinId) : "midnight");
await loadLocale("en");

const AT = new Date(new Date().setHours(11, 32, 0, 0)).getTime();
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

function rows(): Message[] {
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
  id: "jordan", name: "Jordan", title: "", description: "Writes and checks scripts for the channel.", color: "red", notifications: true, unread: false,
  threadId: "main", busy: stateName === "working", activity: stateName === "working" ? "working" : stateName === "question" || stateName === "approval" ? "waiting-on-you" : "idle",
  turnStartedAt: AT, messages: shown, activeLeafId: shown.at(-1)?.id, modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
  tasks: [{ threadId: "main", title: "Jordan", createdAt: AT - 86_400_000 }],
} as Bot;

const state: AppState = { ...initialState, bots: [bot], selectedId: bot.id, connected: true,
  config: { features: { showToolCalls: params.get("tools") === "1" } } as unknown as AppState["config"] };
const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!new URL(url, location.href).pathname.startsWith("/api/")) return realFetch(input, init);
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreContext.Provider value={value}>
      <div className="flex h-dvh w-full overflow-hidden bg-app text-ink"><div className="flex min-w-0 flex-1 flex-col"><ChatView bot={bot} /></div></div>
    </StoreContext.Provider>
  </StrictMode>,
);
