import type { MobilePlatform } from "../platform";
import { BACKGROUND_HEADERS } from "@/lib/cloud-power";

/** under the host's 60 s lease, so a phone with the app open never counts as away between two of these */
export const PRESENCE_BEAT_MS = 25_000;

function say(away: boolean) {
  void fetch("/api/mobile/presence", { method: "PUT", headers: { "Content-Type": "application/json", ...BACKGROUND_HEADERS }, body: JSON.stringify({ away }), keepalive: true, signal: AbortSignal.timeout(10_000) })
    .then((response) => response.body?.cancel())
    .catch(() => {});
}

/** Tells the workspace whether the app is open, so it pushes only while the phone is away. Returns the stop. */
export function reportPresence(platform: Pick<MobilePlatform, "onPause" | "onResume">, doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document): () => void {
  let beat: ReturnType<typeof setInterval> | undefined;
  let here: boolean | undefined;
  const set = (open: boolean) => {
    if (here === open) return;
    here = open;
    clearInterval(beat);
    beat = open ? setInterval(() => say(false), PRESENCE_BEAT_MS) : undefined;
    say(!open);
  };
  set(doc.visibilityState !== "hidden");
  const visibility = () => set(doc.visibilityState !== "hidden");
  const stops = [platform.onPause?.(() => set(false)), platform.onResume?.(() => set(true))];
  doc.addEventListener("visibilitychange", visibility);
  return () => {
    clearInterval(beat);
    doc.removeEventListener("visibilitychange", visibility);
    for (const stop of stops) stop?.();
  };
}
