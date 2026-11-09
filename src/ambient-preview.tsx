// Development only: the notch island and the bot dock on a pretend desktop, each in a frame of its own as in the app,
// fed fixture bots. ?display=external shows a display without a notch. The page takes { type: "scene", scene } messages.
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { DOCK, dockLayout, islandLayout } from "../electron/ambient-geometry.mjs";
import { Dock } from "./ambient/Dock";
import { Island } from "./ambient/Island";
import { ambientLabels } from "./ambient/labels";
import type { AmbientBot, AmbientBridge, AmbientSnapshot, AmbientStatus, DockLayout, IslandLayout } from "./ambient/types";
import "./font-faces";

const params = new URLSearchParams(location.search);
const external = params.get("display") === "external";
const screen = external
  ? { id: 2, internal: false, label: "Studio Display", bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 25, width: 1512, height: 957 } }
  : { id: 1, internal: true, label: "Built-in Liquid Retina XDR Display", bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } };
const menuBar = screen.workArea.y;
const now = Date.now();
const min = 60_000;

const base: AmbientBot[] = [
  { id: "nova", threadId: "t-nova", name: "Nova", color: "blue", body: "blob", face: null, avatar: null, status: "idle", detail: "", line: "Booked the 9:40 to Lisbon and sent the receipt.", at: now - 3 * min, unread: false, asks: 0, approval: null, waits: null, question: null },
  { id: "quill", threadId: "t-quill", name: "Quill", color: "purple", body: "sparkle", face: null, avatar: null, status: "idle", detail: "", line: "Draft of the launch post is in your docs.", at: now - 18 * min, unread: false, asks: 0, approval: null, waits: null, question: null },
  { id: "rivet", threadId: "t-rivet", name: "Rivet", color: "orange", body: "hex", face: null, avatar: null, status: "idle", detail: "", line: "The footer is fixed and deployed.", at: now - 42 * min, unread: false, asks: 0, approval: null, waits: null, question: null },
  { id: "tally", threadId: "t-tally", name: "Tally", color: "green", body: "clover", face: null, avatar: null, status: "idle", detail: "", line: "October spend is 12% under budget.", at: now - 2 * 60 * min, unread: false, asks: 0, approval: null, waits: null, question: null },
  { id: "echo", threadId: "t-echo", name: "Echo", color: "yellow", body: "star", face: null, avatar: null, status: "idle", detail: "", line: "Three new replies to your thread.", at: now - 5 * 60 * min, unread: false, asks: 0, approval: null, waits: null, question: null },
  { id: "juno", threadId: "t-juno", name: "Juno", color: "pink", body: "heart", face: null, avatar: null, status: "idle", detail: "", line: "Your flight checks in tomorrow at 7.", at: now - 26 * 60 * min, unread: false, asks: 0, approval: null, waits: null, question: null },
];
const set = (id: string, fields: Partial<AmbientBot>) => (bot: AmbientBot) => (bot.id === id ? { ...bot, ...fields } : bot);
const mood = (status: AmbientStatus, detail = "") => base.map(set("nova", { status, detail, at: now - 20_000, unread: status === "done", waits: status === "needs-you" ? "approval" : null }));
const SCENES: Record<string, AmbientBot[]> = {
  quiet: base,
  empty: [],
  thinking: mood("thinking", "Thinking"),
  working: mood("working", "Reading itinerary.pdf"),
  talking: mood("talking", "Writing a reply"),
  done: mood("done"),
  "needs-you": mood("needs-you", "Wants to run a command"),
  error: mood("error"),
  busy: base
    .map(set("quill", { status: "needs-you", waits: "approval", detail: "Wants to run a command", asks: 1, at: now - 40_000, approval: { requestId: "r1", threadId: "t-quill", title: "npm run build" } }))
    .map(set("juno", { status: "needs-you", waits: "question", asks: 1, at: now - 4 * min, question: { requestId: "q1", threadId: "t-juno", title: "Aisle or window for the flight home?", choices: ["Aisle", "Window", "Either"] } }))
    .map(set("nova", { status: "working", detail: "Comparing 14 flights to Lisbon", at: now - 2 * min }))
    .map(set("tally", { status: "thinking", detail: "Thinking", at: now - 50_000 }))
    .map(set("rivet", { status: "done", unread: true, at: now - 6 * min }))
    .map(set("echo", { status: "error", line: "Couldn't reach Gmail: the sign-in expired.", at: now - 30 * min })),
};
const snapshot = (scene: string): AmbientSnapshot => ({ bots: SCENES[scene] ?? base, labels: ambientLabels(), lang: "en" });

const island = islandLayout(screen, { platform: "darwin", size: params.get("size") ?? "medium" });
const dock = dockLayout(screen, { count: (SCENES[params.get("scene") ?? "busy"] ?? base).length });
const islandLayoutMessage: IslandLayout = { surface: "island", width: island.window.width, height: island.window.height, collapsed: island.collapsed, tile: island.tile, size: island.size };
const dockLayoutMessage: DockLayout = { surface: "dock", width: dock.window.width, height: dock.window.height, body: dock.body, top: dock.top, dock: { ...DOCK }, order: [] };

function fakeBridge(surface: "island" | "dock", scene: string): AmbientBridge {
  const states = new Set<(value: AmbientSnapshot) => void>(), layouts = new Set<(value: IslandLayout | DockLayout) => void>();
  let current = snapshot(scene);
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "scene") return;
    current = snapshot(String(event.data.scene));
    for (const cb of states) cb(current);
  });
  const log = (...args: unknown[]) => console.info("[ambient]", ...args);
  return {
    surface,
    onState: (cb) => { states.add(cb); return () => { states.delete(cb); }; },
    onLayout: (cb) => { layouts.add(cb); return () => { layouts.delete(cb); }; },
    pointer: (on) => { document.documentElement.dataset.pointer = String(on); },
    open: (botId) => log("open", botId),
    act: (act) => log("act", act),
    order: (ids) => log("order", ids),
    ready: () => queueMicrotask(() => {
      for (const cb of layouts) cb(surface === "island" ? islandLayoutMessage : dockLayoutMessage);
      for (const cb of states) cb(current);
    }),
  };
}

function Desktop() {
  const frames = useRef<HTMLIFrameElement[]>([]);
  useEffect(() => {
    const relay = (event: MessageEvent) => { if (event.data?.type === "scene" && event.source === window) for (const frame of frames.current) frame.contentWindow?.postMessage(event.data, "*"); };
    window.addEventListener("message", relay);
    return () => window.removeEventListener("message", relay);
  }, []);
  const scene = params.get("scene") ?? "busy";
  const frameUrl = (surface: string) => `/ambient-preview.html?frame=${surface}&scene=${scene}${external ? "&display=external" : ""}${params.get("size") ? `&size=${params.get("size")}` : ""}`;
  return (
    <div style={{ position: "relative", width: 1512, height: 982, overflow: "hidden", fontFamily: "-apple-system, system-ui, sans-serif",
      background: "radial-gradient(120% 90% at 18% 12%, #f2c9a8 0%, #d98e73 26%, #7a5a8c 58%, #2f2d4e 100%)" }}>
      <div style={{ position: "absolute", inset: "0 0 auto 0", height: menuBar, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px",
        background: "rgb(30 24 40 / 0.28)", backdropFilter: "blur(30px)", color: "#fff", fontSize: 13, fontWeight: 500 }}>
        <span style={{ display: "flex", gap: 20 }}><b>MausBot</b><span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span></span>
        <span style={{ display: "flex", gap: 16 }}><span>100%</span><span>Sat 8 Nov  22:40</span></span>
      </div>
      {!external && <div style={{ position: "absolute", top: 0, left: (1512 - 192) / 2, width: 192, height: 37, background: "#000", borderRadius: "0 0 10px 10px" }} />}
      <iframe ref={(node) => { if (node) frames.current[0] = node; }} title="island" src={frameUrl("island")}
        style={{ position: "absolute", left: island.window.x, top: island.window.y, width: island.window.width, height: island.window.height, border: 0, background: "transparent", colorScheme: "dark" }} />
      <iframe ref={(node) => { if (node) frames.current[1] = node; }} title="dock" src={frameUrl("dock")}
        style={{ position: "absolute", left: dock.window.x, top: dock.window.y, width: dock.window.width, height: dock.window.height, border: 0, background: "transparent", colorScheme: "dark" }} />
    </div>
  );
}

const frame = params.get("frame");
const root = createRoot(document.getElementById("root")!);
if (frame === "island" || frame === "dock") {
  await import("./ambient/ambient.css");
  const bridge = fakeBridge(frame, params.get("scene") ?? "busy");
  root.render(<StrictMode><MotionConfig reducedMotion="user">{frame === "island" ? <Island bridge={bridge} /> : <Dock bridge={bridge} />}</MotionConfig></StrictMode>);
} else {
  document.body.style.margin = "0";
  root.render(<StrictMode><Desktop /></StrictMode>);
}
