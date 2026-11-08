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
import { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState } from "@capacitor-mlkit/barcode-scanning";
import type { MobilePlatform } from "@/mobile/platform";
import type { MobileOpenTarget } from "../../../shared/mobile-link";

type PendingHandle = Promise<PluginListenerHandle>;
let storageReady: Promise<void> | undefined;
let overlayReady: Promise<void> | undefined;

function unsubscribe(handles: PendingHandle[]): () => void {
  for (const handle of handles) void handle.catch(() => {});
  return () => {
    for (const handle of handles) void handle.then((value) => value.remove()).catch(() => {});
  };
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
  storageReady ??= SecureStorage.setKeyPrefix("omb.");
  if (kind === "android") {
    overlayReady ??= StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  }
  const [info, launch] = await Promise.all([
    App.getInfo().catch(() => null),
    App.getLaunchUrl().catch(() => undefined),
    storageReady,
    overlayReady,
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
        const value = await SecureStorage.get(key, false);
        return typeof value === "string" ? value : null;
      },
      set: (key, value) => SecureStorage.set(key, value, false),
      remove: async (key) => { await SecureStorage.remove(key); },
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
