// The notch island drawn inside a page, on its own pretend feed: for setup to show what turning it on gives. It is the
// real island (Island.tsx) with a bridge that answers itself, so it opens under the pointer, its bots take turns working,
// replying and asking, and an answer tapped here plays out. Self-contained: pass `bots` and `labels` to show other data.
import { useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { t } from "@/lib/i18n";
import { toolLabel } from "@/components/ApprovalCard";
import { islandLayout } from "../../electron/ambient-geometry.mjs";
import { Island } from "./Island";
import { ambientLabels } from "./labels";
import type { AmbientAct, AmbientBot, AmbientBridge, AmbientSnapshot, IslandLayout } from "./types";
import type { AmbientLabels } from "./say";
import "./ambient.css";

/** How long each step of the demo holds. */
export const SHOWCASE_STEP_MS = 2600;
/** A 14 inch MacBook Pro at its default scale, and a display without a notch. */
const BUILT_IN = { id: 1, internal: true, label: "Built-in Liquid Retina XDR Display", bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } };
const EXTERNAL = { id: 2, internal: false, label: "Display", bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 25, width: 1512, height: 957 } };

export interface IslandShowcaseProps {
  /** The bots to show; a small made-up team in the person's language otherwise. With `autoplay`, steps go through them. */
  bots?: AmbientBot[];
  labels?: AmbientLabels;
  /** Around a notch (the default) or a floating pill. */
  kind?: "notch" | "pill";
  size?: "small" | "medium" | "large";
  /** Holds the panel open; otherwise it opens under the pointer, as on the desktop. */
  open?: boolean;
  /** The bots take turns working, replying and asking (on by default); it holds still under the pointer. */
  autoplay?: boolean;
  /** Drawn width in px; the island scales to it from its real 560. */
  width?: number;
  /** Drawn height in px: how much of the panel shows below the top edge. */
  height?: number;
  className?: string;
  onAct?: (act: AmbientAct) => void;
}

const MIN = 60_000;

/** The made-up team: nobody's real data, in the person's language. */
export function showcaseBots(now = Date.now()): AmbientBot[] {
  const bot = (id: string, name: string, color: AmbientBot["color"], body: string, fields: Partial<AmbientBot> = {}): AmbientBot => ({
    id, threadId: `demo-${id}`, name, color, body, face: null, avatar: null, status: "idle", detail: "", line: "", at: now - 20 * MIN, unread: false, asks: 0,
    approval: null, waits: null, question: null, step: null, ...fields,
  });
  return [
    bot("nova", "Nova", "blue", "blob"),
    bot("quill", "Quill", "purple", "sparkle", { line: t("ambient.demo.replied") }),
    bot("juno", "Juno", "pink", "heart"),
    bot("rivet", "Rivet", "orange", "hex"),
  ];
}

type Step = (bots: AmbientBot[], now: number) => AmbientBot[];
const set = (id: string, fields: Partial<AmbientBot>) => (bot: AmbientBot) => (bot.id === id ? { ...bot, ...fields } : bot);
const working = (detail: string, step: AmbientBot["step"] = "web"): Partial<AmbientBot> => ({ status: "working", detail, step, unread: false });
const question = (bot: AmbientBot): Partial<AmbientBot> => ({
  status: "needs-you", waits: "question", asks: 1, detail: "", unread: false,
  question: { requestId: `q-${bot.id}`, threadId: bot.threadId, title: t("ambient.demo.question"), choices: [t("ambient.demo.aisle"), t("ambient.demo.window")], custom: true },
});

/** One loop of the demo: someone starts, someone thinks, someone replies, someone asks. */
const STEPS: Step[] = [
  (bots) => bots,
  (bots, now) => bots.map(set(bots[0]!.id, { ...working(t("ambient.demo.working")), at: now })),
  (bots, now) => bots.map(set(bots[3]?.id ?? "", { status: "thinking", detail: t("ambient.status.thinking"), step: "thinking", at: now })),
  (bots, now) => bots.map(set(bots[1]?.id ?? "", { status: "done", unread: true, at: now })),
  (bots, now) => bots.map((bot) => (bot.id === bots[2]?.id ? { ...bot, ...question(bot), at: now } : bot)),
  (bots, now) => bots.map(set(bots[3]?.id ?? "", {
    status: "needs-you", waits: "approval", asks: 1, detail: t("ambient.wantsTo", { action: toolLabel("Bash") }), step: null, at: now,
    approval: { requestId: `r-${bots[3]?.id}`, threadId: bots[3]?.threadId ?? "", title: "npm run build" },
  })),
];

export function IslandShowcase({ bots, labels, kind = "notch", size = "medium", open = false, autoplay = true, width = 560, height = 300, className, onAct }: IslandShowcaseProps) {
  const team = useMemo(() => bots ?? showcaseBots(), [bots]);
  const words = useMemo(() => labels ?? ambientLabels(), [labels]);
  const layout = useMemo<IslandLayout>(() => {
    const placed = islandLayout(kind === "notch" ? BUILT_IN : EXTERNAL, { platform: "darwin", size });
    return { surface: "island", width: placed.window.width, height: placed.window.height, collapsed: placed.collapsed, tile: placed.tile, size: placed.size };
  }, [kind, size]);

  // the demo's own state: the step it is on, plus whatever was answered or stopped here
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState<Record<string, Partial<AmbientBot>>>({});
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!autoplay || held) return;
    const timer = setInterval(() => setStep((was) => (was + 1) % STEPS.length), SHOWCASE_STEP_MS);
    return () => clearInterval(timer);
  }, [autoplay, held]);
  useEffect(() => { if (!autoplay) setStep(0); }, [autoplay]);
  // a new loop starts from the team as given
  useEffect(() => { if (step === 0) setTouched({}); }, [step]);

  const now = useMemo(() => Date.now(), [step, touched]);
  const shown = useMemo(() => {
    let list = team;
    if (autoplay) for (let index = 1; index <= step; index++) list = STEPS[index]!(list, now);
    return list.map((bot) => (touched[bot.id] ? { ...bot, ...touched[bot.id] } : bot));
  }, [team, autoplay, step, touched, now]);

  const feed = useRef<{ state: Set<(value: AmbientSnapshot) => void>; layout: Set<(value: IslandLayout) => void> }>({ state: new Set(), layout: new Set() });
  const snapshot: AmbientSnapshot = useMemo(() => ({ bots: shown, labels: words, lang: "" }), [shown, words]);
  const latest = useRef({ snapshot, layout, onAct });
  latest.current = { snapshot, layout, onAct };
  useEffect(() => { for (const cb of feed.current.state) cb(snapshot); }, [snapshot]);
  useEffect(() => { for (const cb of feed.current.layout) cb(layout); }, [layout]);

  const bridge = useMemo<AmbientBridge>(() => ({
    surface: "island",
    onState: (cb) => { feed.current.state.add(cb); return () => { feed.current.state.delete(cb); }; },
    onLayout: (cb) => { feed.current.layout.add(cb as (value: IslandLayout) => void); return () => { feed.current.layout.delete(cb as (value: IslandLayout) => void); }; },
    pointer: (on) => setHeld(on),
    open: () => {},
    act: (act) => {
      latest.current.onAct?.(act);
      if (act.kind === "new-bot") return;
      // the demo plays the answer out: the bot gets back to work, then replies
      const after: Partial<AmbientBot> = act.kind === "stop"
        ? { status: "idle", detail: "", step: null }
        : { ...working(act.kind === "reply" ? t("ambient.status.working") : t("ambient.demo.working"), "tool"), question: null, approval: null, waits: null, asks: 0 };
      setTouched((was) => ({ ...was, [act.botId]: { ...after, at: Date.now() } }));
    },
    order: () => {},
    ready: () => queueMicrotask(() => {
      for (const cb of feed.current.layout) cb(latest.current.layout);
      for (const cb of feed.current.state) cb(latest.current.snapshot);
    }),
  }), []);

  const scale = width / layout.width;
  return (
    <div
      className={`amb-root amb-showcase${className ? ` ${className}` : ""}`}
      data-island-showcase=""
      style={{ position: "relative", width, height, overflow: "hidden" }}
      onFocus={() => setHeld(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false); }}
    >
      <div style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <MotionConfig reducedMotion="user">
          <Island bridge={bridge} embedded forceOpen={open} />
        </MotionConfig>
      </div>
    </div>
  );
}
