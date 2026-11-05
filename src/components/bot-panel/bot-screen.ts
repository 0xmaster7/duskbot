import { useEffect, useState } from "react";

import { listenLiveFrames } from "@/lib/live-events";
import { effectivePlace, type EffectivePlace, type Place } from "@/lib/place";
import { usePageVisible } from "@/lib/page-visible";
import { api, useStore, type Bot } from "@/state/store";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { screenFramePreview } from "../ScreenFrame";

/** how often the tab takes a fresh frame of this computer while it shows */
export const LOCAL_FRAME_MS = 3000;
/** empty answers in a row before this computer's screen counts as not shareable (macOS screen recording is off) */
export const LOCAL_MISSES = 2;

export interface BotScreen {
  /** where the screen comes from: the chosen place, or the one Auto picked; undefined while Auto is still asking */
  place: EffectivePlace | undefined;
  /** the newest frame of that place, or the latest screen the bot posted */
  src: string | null;
  /** this computer's screen is being fetched for the first time */
  loading: boolean;
  /** this computer answered with no picture, so it cannot be shown here */
  blocked: boolean;
}

const AUTO_SURFACES: ReadonlySet<string> = new Set(["cloud", "vm", "local", "browser", "off"]);

/** The screen the bot's Computer tab shows: this computer's own screen through the desktop app, a cloud desktop's live
 * frames, or else the last screen the bot posted in its conversation. */
export function useBotScreen(bot: Bot): BotScreen {
  const { flushBotPatches } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const pageVisible = usePageVisible();
  const liveTask = bot.tasks?.find((task) => task.threadId === bot.threadId);
  const chosen = effectivePlace(bot, liveTask);
  const autoKey = `${bot.id}:${bot.threadId}:${bot.cloudBackend ?? "box"}`;
  const [auto, setAuto] = useState<{ key: string; surface: Place | "off" | undefined } | null>(null);
  const place: EffectivePlace | undefined = chosen !== "auto" ? chosen : auto?.key === autoKey ? auto.surface ?? "auto" : undefined;

  // auto is the server's call: ask it once the chosen place has been saved
  useEffect(() => {
    if (chosen !== "auto") return;
    const controller = new AbortController();
    void flushBotPatches(bot.id)
      .then(() => api(`/api/bots/${bot.id}/computer?threadId=${encodeURIComponent(bot.threadId)}`, { signal: controller.signal }))
      .then((status: { surface?: string }) => {
        if (controller.signal.aborted) return;
        const surface = status.surface && AUTO_SURFACES.has(status.surface) ? status.surface as Place | "off" : undefined;
        setAuto((previous) => previous?.key === autoKey && previous.surface === surface ? previous : { key: autoKey, surface });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuto((previous) => previous?.key === autoKey && !previous.surface ? previous : { key: autoKey, surface: undefined });
      });
    return () => controller.abort();
  }, [chosen, autoKey, bot.id, bot.threadId, flushBotPatches]);

  const platform = capabilities.host.platform;
  const capturesHere = place === "local" && typeof window !== "undefined" && Boolean(window.ogb?.screenFrame)
    && (platform === "darwin" || platform === "win32");
  const [local, setLocal] = useState<{ key: string; src: string | null; misses: number } | null>(null);
  const localKey = `${bot.id}:local`;
  useEffect(() => {
    if (!capturesHere || !pageVisible) return;
    let alive = true;
    let inFlight = false;
    const shoot = async () => {
      if (inFlight) return;
      inFlight = true;
      const url = await window.ogb!.screenFrame().catch(() => null);
      inFlight = false;
      if (!alive) return;
      setLocal((previous) => {
        const before = previous?.key === localKey ? previous : { key: localKey, src: null, misses: 0 };
        return url ? { key: localKey, src: url, misses: 0 } : { ...before, misses: before.misses + 1 };
      });
    };
    void shoot();
    const timer = window.setInterval(() => void shoot(), LOCAL_FRAME_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [capturesHere, pageVisible, localKey]);

  const [cloud, setCloud] = useState<{ key: string; src: string } | null>(null);
  const cloudKey = `${bot.id}:${bot.threadId}:cloud`;
  useEffect(() => {
    if (place !== "cloud") return;
    return listenLiveFrames({
      screens: true,
      onFrame: (frame) => {
        if (frame.kind !== "screen" || frame.botId !== bot.id || frame.threadId !== bot.threadId) return;
        setCloud({ key: cloudKey, src: `data:${frame.mime ?? "image/png"};base64,${frame.png}` });
      },
    });
  }, [place, bot.id, bot.threadId, cloudKey]);

  const localNow = capturesHere && local?.key === localKey ? local : null;
  const cloudNow = place === "cloud" && cloud?.key === cloudKey ? cloud.src : null;
  const posted = [...bot.messages].reverse().find((message) => message.kind === "screen" && (message.hasImage || message.png));
  const postedSrc = posted ? screenFramePreview({ threadId: bot.threadId, messageId: posted.id }, posted.mime).src : null;
  // this computer always shows itself as it is now, never an older posted frame
  const src = capturesHere ? localNow?.src ?? null : cloudNow ?? (place === "off" ? null : postedSrc);
  return {
    place,
    src,
    loading: capturesHere && !localNow?.src && (localNow?.misses ?? 0) < LOCAL_MISSES,
    blocked: capturesHere && !localNow?.src && (localNow?.misses ?? 0) >= LOCAL_MISSES,
  };
}
