import type { MobilePushRegistration } from "../../../shared/mobile-link";
import type { MobilePlatform } from "../platform";
import { createConnectionStore } from "./connections";

const pending = new WeakMap<MobilePlatform, Promise<void>>();

export function registerPushForConnection(platform: MobilePlatform): Promise<void> {
  const existing = pending.get(platform);
  if (existing) return existing;
  const work = (async () => {
    if (!platform.native || !platform.registerPush) return;
    const active = await createConnectionStore(platform).active();
    if (!active?.record.deviceId || !active.record.capabilities.notifications) return;
    const registration = await platform.registerPush();
    if (!registration) return;
    const body: MobilePushRegistration = {
      service: registration.platform, token: registration.token,
      ...(registration.platform === "apns" ? { environment: import.meta.env.DEV ? "sandbox" : "production" } : {}),
    };
    const value = JSON.stringify(body);
    const key = `omb.mobile.push.${active.record.id}`;
    if (await platform.prefs.get(key) === value) return;
    if ((await createConnectionStore(platform).active())?.record.id !== active.record.id) return;
    const response = await fetch("/api/mobile/push", { method: "PUT", headers: { "Content-Type": "application/json" }, body: value, signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
    if (response.ok) await platform.prefs.set(key, value);
  })().catch(() => {}).finally(() => pending.delete(platform));
  pending.set(platform, work);
  return work;
}
