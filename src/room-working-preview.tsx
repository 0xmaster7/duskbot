// Dev-only gallery of a room's working lines and of every mascot body at its small sizes, served at
// /room-working-preview.html; not in the packaged app. It mounts the real GroupView over a fixed store, with no server.
// ?working=0|1|2|3 bots at work in the room, &long=1 with enough history to scroll, &panel=1 with the Room panel open; ?gallery=1 draws every body at 16, 20 and 28px instead.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GroupView } from "@/components/GroupView";
import { BotAvatar } from "@/components/Avatar";
import { RoomPanel } from "@/components/room-panel/RoomPanel";
import { loadLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { applySkinChoice } from "@/lib/skins";
import { noteTurnEvent } from "@/state/turn-status";
import { initialState, StoreContext, type AppState, type Bot, type Group, type Message } from "@/state/store";
import { GROK_BODY_IDS } from "../shared/grok-bodies";
import "./font-faces";
import "./styles.css";

const params = new URLSearchParams(location.search);
const working = Number(params.get("working") ?? "0");
setAdvancedMode(false);
applySkinChoice("grok");
await loadLocale("en");

const AT = new Date(new Date().setHours(9, 30, 0, 0)).getTime();
const bot = (id: string, name: string, color: Bot["color"], mascotBody: string): Bot => ({
  id, name, color, mascotBody, title: "", description: "", notifications: true, unread: false, threadId: `${id}-main`, messages: [],
  modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
} as Bot);
const bots = [bot("quill", "Quill", "purple", "leaf"), bot("echo", "Echo", "pink", "heart"), bot("nova", "Nova", "blue", "crystal"), bot("moss", "Moss", "brown", "pebble"), bot("rivet", "Rivet", "silver", "cylinder")];
const from = (b: Bot) => ({ botId: b.id, name: b.name, color: b.color });
const message = (id: string, minutes: number, fields: Partial<Message>): Message =>
  ({ id, at: AT + minutes * 60_000, role: "bot", kind: "text", text: "", ...fields }) as Message;
const filler: Message[] = params.get("long") === "1"
  ? Array.from({ length: 14 }, (_, i) => message(`f${i}`, -60 + i, i % 2 ? { from: from(bots[i % 4]!), text: "Yesterday's numbers are in, the spring banner did well on mobile." } : { role: "user", text: "Nice, keep going." }))
  : [];
const rows: Message[] = [
  ...filler,
  message("u1", 0, { role: "user", text: "Morning team. Quick standup: what is everyone on today?" }),
  message("q1", 0.5, { from: from(bots[0]!), text: "Finishing the product copy for the spring drop. Two descriptions left." }),
  message("q2", 0.6, { from: from(bots[0]!), text: "Should be done before lunch." }),
].map((one, index, all) => ({ ...one, parentId: all[index - 1]?.id }));
const workingIds = ["echo", "nova", "moss"].slice(0, working);
const group: Group = {
  id: "standup", threadId: "standup-thread", name: "Test shop standup", memberIds: bots.map((b) => b.id),
  defaultResponder: { kind: "auto" }, bulletin: "", unread: false, createdAt: AT - 86_400_000, setupCompletedAt: 1,
  messages: rows, working: working > 0, busyBotId: workingIds[0] ?? null, turnStartedAt: working > 0 ? Date.now() - 4000 : undefined,
  ...(working > 1 ? { busyBotIds: workingIds } : {}),
} as Group;
if (working > 0) noteTurnEvent({ type: "content.delta", threadId: group.threadId, turnId: "t1", streamKind: "assistant_text", delta: "" } as never);

const state: AppState = { ...initialState, bots, groups: [group], selectedId: group.id, connected: true } as AppState;
const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

function Gallery() {
  return (
    <div className="flex flex-col gap-6 p-6 text-[12px] text-ink-secondary">
      {[16, 20, 28].map((size) => (
        <div key={size} className="flex flex-col gap-2">
          <div>{size}px</div>
          <div className="flex flex-wrap gap-3">
            {GROK_BODY_IDS.map((body, index) => (
              <div key={body} className="flex flex-col items-center gap-1">
                <span className="inline-flex outline outline-1 outline-ink/10">
                  <BotAvatar bot={{ name: body, color: (["purple", "pink", "blue", "brown", "green", "teal", "orange"] as const)[index % 7], mascotBody: body as Bot["mascotBody"] }} size={size} animated={false} />
                </span>
                <span className="text-[10px]">{body}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
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
    <StoreContext.Provider value={value}>
      {params.get("gallery") === "1" ? <div className="min-h-dvh bg-app text-ink"><Gallery /></div> : (
        <div className="flex h-dvh w-full overflow-hidden bg-app text-ink"><div className="flex min-w-0 flex-1 flex-col"><GroupView group={group} /></div>{params.get("panel") === "1" && <div className="relative w-[320px] shrink-0"><RoomPanel group={group} /></div>}</div>
      )}
    </StoreContext.Provider>
  </StrictMode>,
);
