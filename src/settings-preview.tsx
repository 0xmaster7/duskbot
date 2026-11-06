// Dev-only: Settings over fake state and a stubbed /api, served at /settings-preview.html; not in the packaged app.
// ?section=general|texting|computer|permissions|models|usage|updates|advanced|looks|...&skin=grok|grok-dark&desktop=1&limits=1
import { StrictMode, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal } from "@/components/SettingsModal";
import { AddVpsHost } from "@/components/vps-link/AddVpsHost";
import { previewVpsBridge } from "@/components/vps-link/preview-bridge";
import { openAddVps } from "@/lib/vps-link";
import { loadLocale } from "@/lib/i18n";
import { applySkinChoice, SKIN_IDS, type SkinId } from "@/lib/skins";
import { initialState, reducer, StoreContext, type AppSettingsSection, type AppState } from "@/state/store";
import "./font-faces";
import "./styles.css";
import "./styles/overlays.css";
import "./styles/motion.css";

const params = new URLSearchParams(location.search);
const skin = params.get("skin") ?? "grok";
applySkinChoice(SKIN_IDS.includes(skin as SkinId) ? (skin as SkinId) : "grok");
await loadLocale(params.get("lang") ?? "en");

if (params.get("desktop") === "1") {
  Object.assign(window, { ogb: {
    app: { ownPage: true, version: "0.42.0" },
    accounts: {
      list: async () => ({ active: { id: "a1", email: "siddharth@example.com" }, others: [] }),
      onChanged: () => () => {}, signOut: async () => ({ outcome: "ok", view: null }),
    },
  } });
}

// ?remote=1: the desktop's server list, local environments and companion client, so Computer > Connect from elsewhere
// draws as the packaged app does
if (params.get("remote") === "1") {
  const environments = [
    { id: "env-1", kind: "local", name: "Work", dataDir: "/Users/you/.openmausbot-work", missing: false },
    { id: "vps", kind: "remote", name: "VPS", origin: "https://bots.example.com" },
  ];
  const state = async () => ({ localOrigin: "http://127.0.0.1:8799", remote: false, packaged: true, activeId: "local", environments });
  Object.assign((window as unknown as { ogb: object }).ogb ?? Object.assign(window, { ogb: {} }).ogb, {
    environments: { state, switch: async () => ({ ok: true }), forget: async () => ({ ok: true }), addFromLink: async () => true,
      create: async () => ({ ok: true }), pickDir: async () => ({ ok: false }), onOpenSettings: () => () => {} },
    remoteClient: { active: false, state: async () => ({ active: false }), pair: async () => {}, disconnect: async () => {} },
  });
}

// ?companion=off|paired: the desktop's phone bridge, so the Phone pane draws as the app does
const companionMode = params.get("companion");
if (companionMode) {
  const devices = companionMode === "paired"
    ? [{ id: "d1", name: "Siddharth's iPhone", lastSeenAt: Date.now() - 3_600_000, cloudDesktopAccess: true, browserControlAccess: false }]
    : [];
  let companion = { enabled: companionMode === "paired", keepAwake: false, port: 8810, devices, pairing: null as null | { code: string; token: string; expiresAt: number }, lan: "192.168.1.34" };
  const same = async () => companion;
  const account = { available: true, status: "ready", email: "siddharth@example.com" };
  Object.assign((window as unknown as { ogb: object }).ogb ?? Object.assign(window, { ogb: {} }).ogb, {
    companion: {
      state: same, start: async () => (companion = { ...companion, enabled: true }), stop: async () => (companion = { ...companion, enabled: false }),
      keepAwake: same, refreshTailscale: same, cloudDesktop: same, browserControl: same, revoke: same,
      pairing: async (open: boolean) => (companion = { ...companion, pairing: open ? { code: "482913", token: `omb_pair_${"a".repeat(43)}`, expiresAt: Date.now() + 120_000 } : null }),
    },
    companionAccount: {
      state: async () => account, requestCode: async () => account, verifyCode: async () => account, retry: async () => account,
      signOut: async () => account, prepare: async () => account,
    },
  });
}

// ?vps=command|installing|failed|linked|moving|moved: Add your VPS over a fake desktop side (&flow=1 opens its sheet)
const vpsStage = params.get("vps");
if (vpsStage) {
  Object.assign((window as unknown as { ogb: object }).ogb ?? Object.assign(window, { ogb: {} }).ogb, { platform: "darwin", vpsLink: previewVpsBridge(vpsStage) });
  if (params.get("flow") === "1") openAddVps();
}

const DAY = 86_400_000;
const LIMITS = params.get("limits") === "1" ? { checkedAt: Date.now(), engines: [
  { engine: "claude", name: "Claude", driver: "claude", window: "weekly", usedPercent: 62, resetsAt: Date.now() + 4 * DAY, blocked: false,
    windows: [{ window: "weekly", usedPercent: 62, resetsAt: Date.now() + 4 * DAY }, { window: "5-hour", usedPercent: 18, resetsAt: Date.now() + DAY / 8 }] },
  { engine: "codex", name: "Codex", driver: "codex", window: "weekly", usedPercent: 93, resetsAt: Date.now() + 2 * DAY, blocked: false },
] } : { checkedAt: Date.now(), engines: [] };
const FIXTURES: Record<string, unknown> = { "/api/profile/learned": { learned: [] }, "/api/limit-resets": LIMITS };
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith("/api/")) return realFetch(input, init);
  if (path.startsWith("/api/usage") || path === "/api/plan-usage") return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  const body = FIXTURES[path] ?? {};
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

const start: AppState = {
  ...initialState,
  connected: true,
  appSettingsOpen: params.get("flow") !== "1",
  appSettingsSection: (params.get("section") ?? "general") as AppSettingsSection,
  config: { ...initialState.config, profile: { name: "siddharth", email: "siddharth@example.com", aboutMe: "" } } as AppState["config"],
};

function Preview() {
  const [state, dispatch] = useReducer(reducer, start);
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  return (
    <StoreContext.Provider value={value as never}>
      <div className="h-screen bg-app" />
      {state.appSettingsOpen && <SettingsModal />}
      <AddVpsHost />
    </StoreContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
