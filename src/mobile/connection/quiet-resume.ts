import { useEffect, useState } from "react";
import type { MobilePlatform } from "../platform";

/** a resumed app's live stream is usually back within this, so it keeps its connected look until then */
export const QUIET_RESUME_MS = 5_000;

/** Calls `quiet(true)` when the app comes back to the front and `quiet(false)` five seconds later. Returns the stop. */
export function watchQuietResume(platform: Pick<MobilePlatform, "onResume">, quiet: (on: boolean) => void,
  doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resumed = () => {
    clearTimeout(timer);
    quiet(true);
    timer = setTimeout(() => quiet(false), QUIET_RESUME_MS);
  };
  const visibility = () => { if (doc.visibilityState === "visible") resumed(); };
  const stop = platform.onResume?.(resumed);
  doc.addEventListener("visibilitychange", visibility);
  return () => {
    clearTimeout(timer);
    stop?.();
    doc.removeEventListener("visibilitychange", visibility);
  };
}

/** True for the first five seconds after a resume: "Reconnecting" waits that long before it shows. */
export function useQuietResume(platform: Pick<MobilePlatform, "onResume">): boolean {
  const [quiet, setQuiet] = useState(false);
  useEffect(() => watchQuietResume(platform, setQuiet), [platform]);
  return quiet;
}
