// Mounted once in the app: while the island or the dock is on, it sums up the bots for them (from the store and the
// live stream this page already reads, never a request of its own) and carries out what they ask.
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, type AppState } from "@/state/store";
import { onAnyTurnLive, turnLive } from "@/state/turn-status";
import { activeLocale } from "@/lib/i18n";
import { openCreateBot } from "@/lib/create-bot-request";
import { pendingApprovals } from "@/components/PendingApproval";
import { sidebarPreviewMessages } from "@/components/sidebar-preview";
import { ambientSnapshot, answerableInPlace } from "./summary";
import type { AmbientAct } from "./types";

/** Summaries go out at most this often: a streaming reply changes a bot's status line many times a second. */
export const PUBLISH_MS = 160;

type Dispatch = ReturnType<typeof useStore>["dispatch"];

/** Checked again here: the island may only answer a plain approval the page itself still shows as open. */
export function runAmbientAct(act: AmbientAct, state: AppState, dispatch: Dispatch): void {
  if (act.kind === "new-bot") return openCreateBot();
  const bot = state.bots.find((entry) => entry.id === act.botId);
  if (!bot) return;
  if (act.kind === "reply") {
    if (act.text.trim()) dispatch({ type: "send", botId: bot.id, threadId: act.threadId, text: act.text.trim() });
    return;
  }
  const pending = pendingApprovals(sidebarPreviewMessages(bot)).find((entry) => entry.requestId === act.requestId);
  if (!pending || !answerableInPlace(pending) || act.threadId !== bot.threadId) return;
  dispatch({ type: "decideRequest", threadId: act.threadId, requestId: act.requestId, behavior: act.kind, message: act.kind === "deny" ? "Denied by the user." : undefined });
}

export function AmbientPublisher() {
  const { state, dispatch } = useStore();
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.ambient;
  const [wanted, setWanted] = useState(false);
  const latest = useRef(state);
  latest.current = state;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef("");

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge.wanted().then((next) => { if (live) setWanted(next); }, () => {});
    const off = bridge.onWanted(setWanted);
    return () => { live = false; off(); };
  }, [bridge]);

  const schedule = useCallback(() => {
    if (timer.current || !bridge) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const { bots, instances } = latest.current;
      const snapshot = ambientSnapshot(bots, instances, turnLive, activeLocale());
      const key = JSON.stringify(snapshot);
      if (key === sent.current) return;
      sent.current = key;
      bridge.publish(snapshot);
    }, PUBLISH_MS);
  }, [bridge]);

  useEffect(() => {
    if (!wanted) { sent.current = ""; return; }
    schedule();
  }, [wanted, state.bots, state.instances, schedule]);
  useEffect(() => (wanted ? onAnyTurnLive(schedule) : undefined), [wanted, schedule]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => bridge?.onAct((act) => runAmbientAct(act, latest.current, dispatch)), [bridge, dispatch]);
  return null;
}
