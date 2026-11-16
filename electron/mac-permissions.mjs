// The macOS permissions a bot needs to use this Mac (Accessibility, Screen Recording) and Notifications, read and asked
// for from the first run. Reading never prompts; only `request` does, one permission at a time.

export const MAC_PERMISSIONS = Object.freeze(["accessibility", "screen", "notifications"]);

const TEXT_LIMIT = 200;
const text = (value) => (typeof value === "string" ? value.slice(0, TEXT_LIMIT) : "");

/**
 * @param {{ platform: string,
 *   systemPreferences: { isTrustedAccessibilityClient(prompt: boolean): boolean, getMediaAccessStatus(type: string): string },
 *   desktopCapturer: { getSources(options: object): Promise<unknown[]> },
 *   Notification: { new(options: object): { show(): void }, isSupported(): boolean },
 *   store: { read(): any, write(value: object): void },
 *   openSettings: (pane: "accessibility" | "screen") => unknown,
 *   computerUse: () => Promise<unknown>,
 *   log?: (line: string) => void }} deps
 * `store`: where "notifications were asked for" is kept, since macOS gives an app no way to read that answer.
 * `computerUse`: the computer helper's own restart, so it picks up new grants.
 */
export function createMacPermissions({ platform, systemPreferences, desktopCapturer, Notification, store, openSettings, computerUse, log = () => {} }) {
  const supported = platform === "darwin";
  // macOS shows its own prompt once per permission; after that only System Settings can grant it
  const asked = { accessibility: false, screen: false };
  let helperRestarted = false;

  const saved = () => { try { return store.read() ?? {}; } catch { return {}; } };
  const trusted = () => { try { return systemPreferences.isTrustedAccessibilityClient(false) === true; } catch { return false; } };
  // macOS 15+ caches this per process: a grant made in System Settings reads as missing until the app reopens
  const screenGranted = () => { try { return systemPreferences.getMediaAccessStatus("screen") === "granted"; } catch { return false; } };

  function status() {
    if (!supported) return { supported: false };
    const accessibility = trusted() ? "granted" : asked.accessibility ? "asked" : "missing";
    const screen = screenGranted() ? "granted" : asked.screen ? "asked" : "missing";
    const notifications = saved().notificationsAsked === true ? "granted" : "missing";
    if (accessibility === "granted" && screen === "granted" && (asked.accessibility || asked.screen) && !helperRestarted) {
      helperRestarted = true;
      void Promise.resolve().then(computerUse).catch((error) => log(`computer helper restart failed: ${error instanceof Error ? error.message : error}`));
    }
    return { supported: true, accessibility, screen, notifications };
  }

  async function request(kind, note) {
    if (!supported || !MAC_PERMISSIONS.includes(kind)) return status();
    if (kind === "accessibility" && !trusted()) {
      if (asked.accessibility) await openSettings("accessibility");
      else { asked.accessibility = true; try { systemPreferences.isTrustedAccessibilityClient(true); } catch {} }
    }
    if (kind === "screen" && !screenGranted()) {
      if (asked.screen) await openSettings("screen");
      else {
        asked.screen = true;
        // a real capture from this process is what puts dusk bot in the list and shows the prompt
        try { await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }); } catch {}
      }
    }
    if (kind === "notifications") {
      try {
        if (Notification.isSupported()) new Notification({ title: text(note?.title) || "dusk bot", body: text(note?.body) }).show();
      } catch {}
      try { store.write({ ...saved(), notificationsAsked: true }); } catch {}
    }
    return status();
  }

  return { status, request };
}

/** Registers `mac-permissions:status` and `mac-permissions:request` for this computer's own page (`guard`). */
export function installMacPermissions({ ipcMain, guard, ...deps }) {
  const permissions = createMacPermissions(deps);
  ipcMain.handle("mac-permissions:status", guard("mac-permissions:status", () => permissions.status()));
  ipcMain.handle("mac-permissions:request", guard("mac-permissions:request", (_event, kind, note) => permissions.request(String(kind), note)));
  return permissions;
}
