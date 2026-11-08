import { createContext, useContext } from "react";
import type { MobileOpenTarget } from "../../shared/mobile-link";

export type HapticKind = "light" | "soft" | "medium" | "selection" | "error" | "success";

export interface KeyboardFrame {
  /** Height the keyboard covers, in css px, 0 when hidden. */
  height: number;
  /** Starting to move (`will`) or settled (`did`). */
  phase: "will" | "did";
}

export interface ScanResult {
  text: string;
}

/** Everything the phone layer asks of the device. The native app supplies Capacitor plugins; the web preview and a
 * plain browser get the fallbacks in `webPlatform`. Capability flags, never user-agent guesses. */
export interface MobilePlatform {
  kind: "ios" | "android" | "web";
  native: boolean;
  haptic(kind: HapticKind): void;
  /** Native keyboard events; absent where the visual viewport is the only signal. */
  onKeyboard?(listener: (frame: KeyboardFrame) => void): () => void;
  hideKeyboard?(): void;
  setStatusBar?(style: "dark" | "light"): void;
  /** Android's hardware back; return true when handled. */
  onBack?(listener: () => boolean): () => void;
  /** Links the OS hands the app: openmausbot://pair, openmausbot://open. */
  onAppUrl?(listener: (url: string) => void): () => void;
  onResume?(listener: () => void): () => void;
  /** Non-secret key/value storage. */
  prefs: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  /** Keychain/Keystore. The web fallback keeps secrets in session memory only. */
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  scanQr?(): Promise<ScanResult | null>;
  openExternal(url: string): Promise<void>;
  share?(data: { title?: string; text?: string; url?: string }): Promise<void>;
  /** Push registration; resolves the device token or null when refused or unsupported. */
  registerPush?(): Promise<{ token: string; platform: "apns" | "fcm" } | null>;
  onNotificationOpen?(listener: (target: MobileOpenTarget) => void): () => void;
  deviceName(): string;
  appVersion: string;
}

const memorySecrets = new Map<string, string>();

function storageOf(kind: "localStorage" | "sessionStorage"): Storage | null {
  try { return globalThis[kind] ?? null; } catch { return null; }
}

export function webPlatform(): MobilePlatform {
  const local = storageOf("localStorage");
  return {
    kind: "web",
    native: false,
    haptic(kind) {
      // android chrome honours vibrate; ios safari ignores it, which is the honest answer for a browser
      const pattern = kind === "error" ? [12, 40, 12] : kind === "medium" ? 14 : kind === "selection" ? 4 : 8;
      try { navigator.vibrate?.(pattern); } catch {}
      if (import.meta.env.DEV) document.documentElement.dataset.lastHaptic = `${kind}:${Date.now()}`;
    },
    prefs: {
      get: async (key) => local?.getItem(key) ?? null,
      set: async (key, value) => { local?.setItem(key, value); },
      remove: async (key) => { local?.removeItem(key); },
    },
    secrets: {
      get: async (key) => memorySecrets.get(key) ?? null,
      set: async (key, value) => { memorySecrets.set(key, value); },
      remove: async (key) => { memorySecrets.delete(key); },
    },
    openExternal: async (url) => { window.open(url, "_blank", "noopener"); },
    share: typeof navigator !== "undefined" && "share" in navigator
      ? async (data) => { await navigator.share(data).catch(() => {}); }
      : undefined,
    deviceName: () => (/iphone/i.test(navigator.userAgent) ? "iPhone" : /android/i.test(navigator.userAgent) ? "Android phone" : "Phone browser"),
    appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
  };
}

export const PlatformContext = createContext<MobilePlatform | null>(null);

export function usePlatform(): MobilePlatform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("usePlatform outside the mobile root");
  return platform;
}
