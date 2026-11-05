// Dev-only: Settings over fake state and a stubbed /api, served at /settings-preview.html; not in the packaged app.
// ?section=general|texting|computer|permissions|updates|advanced|looks|...&skin=grok|grok-dark&desktop=1
import { StrictMode, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal } from "@/components/SettingsModal";
import { loadLocale } from "@/lib/i18n";
import { applySkinChoice, SKIN_IDS, type SkinId } from "@/lib/skins";
import { initialState, reducer, StoreContext, type AppSettingsSection, type AppState } from "@/state/store";
import "./styles.css";
import "./styles/overlays.css";

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

const FIXTURES: Record<string, unknown> = { "/api/profile/learned": { learned: [] } };
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith("/api/")) return realFetch(input, init);
  const body = FIXTURES[path] ?? {};
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

const start: AppState = {
  ...initialState,
  connected: true,
  appSettingsOpen: true,
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
    </StoreContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
