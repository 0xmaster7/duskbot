import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { Preferences } from "@capacitor/preferences";
import { PushNotifications } from "@capacitor/push-notifications";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

/** The Keychain/Keystore plugin's own native methods. Its JS conveniences (setKeyPrefix, get, set) go through a lazily
 * loaded wrapper that never answers on Android with Capacitor 8.6, so the phone keeps tokens through these directly. */
const keystore = SecureStorage as unknown as {
  internalGetItem(options: { prefixedKey: string; sync: boolean }): Promise<{ data: string | null }>;
  internalSetItem(options: { prefixedKey: string; data: string; sync: boolean }): Promise<void>;
  internalRemoveItem(options: { prefixedKey: string; sync: boolean }): Promise<{ success: boolean }>;
};
const SECRET_PREFIX = "omb.";
import { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState } from "@capacitor-mlkit/barcode-scanning";
import type { CameraPermission, MobilePlatform } from "@/mobile/platform";
import type { MobileOpenTarget } from "../../../shared/mobile-link";

type PendingHandle = Promise<PluginListenerHandle>;
let overlayReady: Promise<void> | undefined;

export function cameraPermission(value: string): CameraPermission {
  return value === "granted" || value === "limited" ? "granted" : value === "denied" ? "denied" : "prompt";
}

export function distinctCodes(onCode: (text: string) => void): (text: string | undefined) => void {
  const seen = new Set<string>();
  return (text) => {
    if (typeof text !== "string" || seen.has(text)) return;
    seen.add(text);
    onCode(text);
  };
}

function unsubscribe(handles: PendingHandle[]): () => void {
  for (const handle of handles) void handle.catch(() => {});
  return () => {
    for (const handle of handles) void handle.then((value) => value.remove()).catch(() => {});
  };
}

function setScanning(on: boolean) {
  document.documentElement.classList.toggle("mobile-scanning", on);
}

async function ensureBarcodeModule(): Promise<boolean> {
  if ((await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available) return true;
  return new Promise((resolve) => {
    const handles: PendingHandle[] = [];
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe(handles)();
      resolve(available);
    };
    const timeout = setTimeout(() => finish(false), 60_000);
    void (async () => {
      handles.push(BarcodeScanner.addListener("googleBarcodeScannerModuleInstallProgress", ({ state }) => {
        if (state === GoogleBarcodeScannerModuleInstallState.COMPLETED) finish(true);
        else if (state === GoogleBarcodeScannerModuleInstallState.CANCELED || state === GoogleBarcodeScannerModuleInstallState.FAILED) finish(false);
      }));
      await Promise.all(handles);
      if (settled) return;
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      if ((await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available) finish(true);
    })().catch(() => finish(false));
  });
}

function notificationTarget(data: Record<string, unknown>): MobileOpenTarget {
  const target: MobileOpenTarget = {};
  const fields = { env: "environmentId", bot: "botId", group: "groupId", thread: "threadId", message: "messageId" } as const;
  for (const [field, key] of Object.entries(fields)) {
    if (typeof data[field] === "string") target[key] = data[field];
  }
  switch (data.view) {
    case "chat": case "computer": case "profile": case "routines": case "settings": case "notifications":
      target.view = data.view;
  }
  return target;
}

export async function nativePlatform(): Promise<MobilePlatform> {
  const kind = Capacitor.getPlatform() as "ios" | "android";
  if (kind === "android") {
    overlayReady ??= StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  }
  // a plugin that never answers must not hold the first paint: each startup read gets two seconds
  const bounded = <T,>(work: Promise<T>, label: string): Promise<T | undefined> => new Promise((resolve) => {
    const timer = setTimeout(() => { console.warn(`startup: ${label} did not answer`); resolve(undefined); }, 2000);
    work.then(resolve, () => resolve(undefined)).finally(() => clearTimeout(timer));
  });
  const [info, launch] = await Promise.all([
    bounded(App.getInfo(), "app info"),
    bounded(App.getLaunchUrl(), "launch url"),
    bounded(overlayReady ?? Promise.resolve(), "status bar"),
  ]);
  let pendingLaunchUrl = launch?.url;

  return {
    kind,
    native: true,
    appVersion: info?.version || __APP_VERSION__,
    deviceName: () => kind === "ios" ? "iPhone" : "Android phone",
    haptic(type) {
      void (async () => {
        switch (type) {
          case "light": case "soft":
            await Haptics.impact({ style: ImpactStyle.Light });
            break;
          case "medium":
            await Haptics.impact({ style: ImpactStyle.Medium });
            break;
          case "selection":
            await Haptics.selectionStart();
            await Haptics.selectionChanged();
            await Haptics.selectionEnd();
            break;
          case "error":
            await Haptics.notification({ type: NotificationType.Error });
            break;
          case "success":
            await Haptics.notification({ type: NotificationType.Success });
        }
      })().catch(() => {});
    },
    onKeyboard(listener) {
      return unsubscribe([
        Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => listener({ height: keyboardHeight, phase: "will" })),
        Keyboard.addListener("keyboardDidShow", ({ keyboardHeight }) => listener({ height: keyboardHeight, phase: "did" })),
        Keyboard.addListener("keyboardWillHide", () => listener({ height: 0, phase: "will" })),
        Keyboard.addListener("keyboardDidHide", () => listener({ height: 0, phase: "did" })),
      ]);
    },
    hideKeyboard() {
      void Keyboard.hide().catch(() => {});
    },
    setStatusBar(style) {
      void StatusBar.setStyle({ style: style === "dark" ? Style.Light : Style.Dark }).catch(() => {});
    },
    onBack(listener) {
      return unsubscribe([App.addListener("backButton", () => {
        if (listener() === false && kind === "android") void App.minimizeApp().catch(() => {});
      })]);
    },
    onAppUrl(listener) {
      const stop = unsubscribe([App.addListener("appUrlOpen", ({ url }) => listener(url))]);
      if (pendingLaunchUrl && listener(pendingLaunchUrl)) pendingLaunchUrl = undefined;
      return stop;
    },
    onResume(listener) {
      return unsubscribe([App.addListener("resume", listener)]);
    },
    prefs: {
      get: async (key) => (await Preferences.get({ key })).value,
      set: (key, value) => Preferences.set({ key, value }),
      remove: (key) => Preferences.remove({ key }),
    },
    secrets: {
      get: async (key) => {
        const { data } = await keystore.internalGetItem({ prefixedKey: SECRET_PREFIX + key, sync: false });
        return typeof data === "string" ? data : null;
      },
      set: (key, value) => keystore.internalSetItem({ prefixedKey: SECRET_PREFIX + key, data: value, sync: false }),
      remove: async (key) => { await keystore.internalRemoveItem({ prefixedKey: SECRET_PREFIX + key, sync: false }); },
    },
    async scanQr() {
      try {
        let permission = await BarcodeScanner.checkPermissions();
        if (permission.camera !== "granted" && permission.camera !== "limited") permission = await BarcodeScanner.requestPermissions();
        if (permission.camera !== "granted" && permission.camera !== "limited") return null;
        if (kind === "android" && !await ensureBarcodeModule()) return null;
        const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
        const text = barcodes[0]?.rawValue;
        return typeof text === "string" ? { text } : null;
      } catch {
        return null;
      }
    },
    camera: kind === "ios" && !Capacitor.isPluginAvailable("BarcodeScanner") ? undefined : {
      permission: async () => cameraPermission((await BarcodeScanner.checkPermissions()).camera),
      request: async () => cameraPermission((await BarcodeScanner.requestPermissions()).camera),
      openSettings: () => BarcodeScanner.openSettings(),
      async start({ onCode, onError }) {
        const handles: PluginListenerHandle[] = [];
        const deliver = distinctCodes(onCode);
        let stopped = false;
        let stopping: Promise<void> | undefined;
        let torchOn = false;
        let torchPending = Promise.resolve();
        const stop = () => {
          if (stopping) return stopping;
          stopped = true;
          setScanning(false);
          stopping = (async () => {
            try {
              await Promise.allSettled(handles.map((handle) => handle.remove()));
              await torchPending.catch(() => {});
              if (torchOn) await BarcodeScanner.disableTorch().catch(() => {});
              await BarcodeScanner.stopScan();
            } finally {
              setScanning(false);
            }
          })();
          return stopping;
        };
        try {
          setScanning(true);
          handles.push(await BarcodeScanner.addListener("barcodesScanned", ({ barcodes }) => {
            if (!stopped) deliver(barcodes[0]?.rawValue);
          }));
          handles.push(await BarcodeScanner.addListener("scanError", ({ message }) => {
            if (!stopped) onError?.(message);
          }));
          await BarcodeScanner.startScan({ formats: [BarcodeFormat.QrCode] });
          const { available } = await BarcodeScanner.isTorchAvailable();
          return {
            stop,
            torch: available ? {
              set(on) {
                if (stopped) return Promise.resolve();
                torchPending = torchPending.catch(() => {}).then(async () => {
                  if (stopped) return;
                  if (on) await BarcodeScanner.enableTorch();
                  else await BarcodeScanner.disableTorch();
                  torchOn = on;
                });
                return torchPending;
              },
            } : undefined,
          };
        } catch (error) {
          await stop().catch(() => {});
          throw error;
        }
      },
    },
    async readClipboard() {
      try { return await navigator.clipboard?.readText() ?? null; } catch { return null; }
    },
    openExternal: (url) => Browser.open({ url, presentationStyle: "popover" }),
    share: async (data) => { await Share.share(data); },
    async registerPush() {
      try {
        if ((await PushNotifications.requestPermissions()).receive !== "granted") return null;
        return await new Promise<{ token: string; platform: "apns" | "fcm" } | null>((resolve) => {
          const handles: PendingHandle[] = [];
          let settled = false;
          const finish = (value: { token: string; platform: "apns" | "fcm" } | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            unsubscribe(handles)();
            resolve(value);
          };
          const timeout = setTimeout(() => finish(null), 15_000);
          void (async () => {
            handles.push(PushNotifications.addListener("registration", ({ value }) => finish({ token: value, platform: kind === "ios" ? "apns" : "fcm" })));
            handles.push(PushNotifications.addListener("registrationError", () => finish(null)));
            await Promise.all(handles);
            if (!settled) await PushNotifications.register();
          })().catch(() => finish(null));
        });
      } catch {
        return null;
      }
    },
    onNotificationOpen(listener) {
      return unsubscribe([PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
        listener(notificationTarget(notification.data ?? {}));
      })]);
    },
  };
}
