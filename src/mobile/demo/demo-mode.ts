import { forgetTranscriptShelf } from "@/state/transcript-cache";
import { outboxKey } from "../connection/active";
import type { MobilePlatform } from "../platform";

/** The connection id the app runs under while it shows the built-in demo workspace. */
export const DEMO_CONNECTION = "demo";
const DEMO_KEY = "omb.mobile.demo";

type Prefs = Pick<MobilePlatform, "prefs">;

export async function demoOn(platform: Prefs): Promise<boolean> {
  return (await platform.prefs.get(DEMO_KEY).catch(() => null)) === "1";
}

/** Linking a real installation ends the demo without a restart. */
export async function forgetDemo(platform: Prefs): Promise<void> {
  await platform.prefs.remove(DEMO_KEY);
  await platform.prefs.remove(outboxKey(DEMO_CONNECTION));
  await forgetTranscriptShelf(DEMO_CONNECTION);
}

export async function enterDemo(platform: Prefs, reload: () => void = () => window.location.reload()): Promise<void> {
  await platform.prefs.set(DEMO_KEY, "1");
  reload();
}

export async function leaveDemo(platform: Prefs, reload: () => void = () => window.location.reload()): Promise<void> {
  await forgetDemo(platform);
  reload();
}
