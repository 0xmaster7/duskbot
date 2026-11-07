import { useEffect, useRef } from "react";
import { listenLiveFrames } from "@/lib/live-events";
import { effectivePlace } from "@/lib/place";
import { writeComputerPanelView } from "@/lib/computer-panel-view";
import { api, type Action, type Bot } from "@/state/store";

export function useComputerPanelActivity({ bot, active, settingsOpen, targetKey, dispatch }: {
  bot: Bot | undefined;
  active: boolean;
  settingsOpen: boolean;
  targetKey?: string;
  dispatch: (action: Action) => void;
}) {
  const current = useRef({ bot, active, settingsOpen });
  current.current = { bot, active, settingsOpen };
  const activity = useRef(new Map<string, { resource: string; state: string; opened: boolean }>());
  const open = () => {
    const view = current.current;
    const selected = view.bot;
    if (!view.active || !selected || view.settingsOpen) return;
    const place = effectivePlace(selected, selected.tasks?.find(task => task.threadId === selected.threadId));
    if (place === "off" || place === "browser" || place === "local") return;
    const state = activity.current.get(selected.id);
    if (!state || state.opened || (state.state !== "starting" && state.state !== "ready")) return;
    state.opened = true;
    writeComputerPanelView(selected.id, "computer");
    dispatch({ type: "toggleComputer", open: true });
  };
  const openCurrent = useRef(open);
  openCurrent.current = open;
  useEffect(() => listenLiveFrames({
    onFrame: frame => {
      if (frame.kind !== "computer-state" && frame.kind !== "computer") return;
      const resource = frame.kind === "computer-state" ? frame.resourceKey : frame.botId;
      const state = frame.kind === "computer-state" ? frame.state : "starting";
      const previous = activity.current.get(frame.botId);
      const sameCycle = (previous?.resource === resource || previous?.resource === frame.botId) && (previous.state === "starting" || previous.state === "ready");
      activity.current.set(frame.botId, { resource, state, opened: sameCycle && previous.opened });
      if (activity.current.size > 500) activity.current.delete(activity.current.keys().next().value!);
      openCurrent.current();
    },
  }), []);
  useEffect(() => {
    if (!bot || !active) return;
    const place = effectivePlace(bot, bot.tasks?.find(task => task.threadId === bot.threadId));
    if (place !== "auto" && place !== "cloud" && place !== "vm") return;
    const controller = new AbortController();
    const previous = activity.current.get(bot.id);
    void api(`/api/bots/${bot.id}/${place === "vm" ? "local-computer" : "computer"}?threadId=${encodeURIComponent(bot.threadId)}`, { signal: controller.signal }).then(status => {
      if (controller.signal.aborted || activity.current.get(bot.id) !== previous) return;
      if (status.surface && status.surface !== "cloud" && status.surface !== "vm") return;
      const state = status.ready ? "ready" : status.state === "starting" ? "starting"
        : status.container === "stopped" || status.container === "missing" ? "stopped" : null;
      if (!state) return;
      const resource = status.resourceKey ?? bot.id;
      activity.current.set(bot.id, { resource, state, opened: Boolean(previous && previous.resource === resource && (previous.state === "starting" || previous.state === "ready") && previous.opened) });
      openCurrent.current();
    }).catch(() => {});
    return () => controller.abort();
  }, [bot?.id, bot?.threadId, bot?.computer, targetKey, active]);
  useEffect(() => openCurrent.current(), [bot?.id, bot?.threadId, bot?.computer, active, settingsOpen]);
}
