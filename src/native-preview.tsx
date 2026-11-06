// Dev-only gallery of the native feature components, served at /native-preview.html; not in the packaged app.
// ?skin=grok|grok-dark
import { StrictMode, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { Card } from "@/components/bot-panel/rows";
import { ModelSelectRow } from "@/components/native/ModelSelectRow";
import { UsageBanner, UsageMeterCard, UsageMeterRow } from "@/components/native/UsageMeter";
import { SelectPill } from "@/components/ui/SelectPill";
import { RowText, rowCls } from "@/components/bot-panel/rows";
import { loadLocale } from "@/lib/i18n";
import { rememberLimits, type EngineLimit } from "@/lib/limit-resets";
import { applySkinChoice, SKIN_IDS, type SkinId } from "@/lib/skins";
import { initialState, reducer, StoreContext, type AppState, type Bot, type InstanceInfo } from "@/state/store";
import "./font-faces";
import "./styles.css";
import "./styles/overlays.css";

const params = new URLSearchParams(location.search);
const skin = params.get("skin") ?? "grok";
applySkinChoice(SKIN_IDS.includes(skin as SkinId) ? (skin as SkinId) : "grok");
await loadLocale(params.get("lang") ?? "en");

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!new URL(url, location.href).pathname.startsWith("/api/")) return realFetch(input, init);
  return new Response(JSON.stringify(LIMITS_REPORT), { status: 200, headers: { "content-type": "application/json" } });
};

const now = Date.now();
const LIMITS: EngineLimit[] = [
  { engine: "claude", name: "Claude", driver: "claude", window: "weekly", usedPercent: 62, resetsAt: now + 4 * 86_400_000, blocked: false,
    windows: [{ window: "weekly", usedPercent: 62, resetsAt: now + 4 * 86_400_000 }, { window: "5-hour", usedPercent: 18, resetsAt: now + 3 * 3_600_000 }] },
  { engine: "codex", name: "Codex", driver: "codex", window: "weekly", usedPercent: 93, resetsAt: now + 2 * 86_400_000, blocked: false },
];
const LIMITS_REPORT = { checkedAt: now, engines: LIMITS };
rememberLimits(LIMITS_REPORT);

const INSTANCES = [
  { instanceId: "claude", driverKind: "claude", displayName: "Claude", snapshot: { state: "available", authenticated: true, billing: "subscription" },
    models: { default: "sonnet", options: [{ id: "opus", label: "Opus 4.6" }, { id: "sonnet", label: "Sonnet 4.6" }, { id: "haiku", label: "Haiku 4.5" }] } },
  { instanceId: "codex", driverKind: "codex", displayName: "Codex", snapshot: { state: "available", authenticated: true, chatgptPlan: true },
    models: { default: "gpt-5.5", options: [{ id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-5.5-mini", label: "GPT-5.5 mini" }] } },
] as unknown as InstanceInfo[];
const bot = { id: "b1", name: "Amy", color: "magenta", threadId: "t1", busy: false, tasks: [], modelSelection: { instanceId: "claude", model: "sonnet" } } as unknown as Bot;
const codexBot = { ...bot, id: "b2", name: "Koder", modelSelection: { instanceId: "codex", model: "gpt-5.5" } } as unknown as Bot;
const start: AppState = { ...initialState, connected: true, instances: INSTANCES, bots: [bot, codexBot] };

function Preview() {
  const [state, dispatch] = useReducer(reducer, start);
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  return (
    <StoreContext.Provider value={value as never}>
      <div className="flex min-h-screen gap-10 bg-app p-10 text-ink">
        <section data-preview="panel" className="w-[320px] shrink-0 bg-panel px-4 py-4">
          <Card label="Voice chat" anchor="call">
            <div className={rowCls}><RowText title="Voice" /><SelectPill aria-label="Voice" value="liora" options={[{ value: "liora", label: "Liora" }]} onChange={() => {}} /></div>
          </Card>
          <Card label="Model" anchor="model">
            <ModelSelectRow bot={bot} />
            <UsageMeterRow engine="claude" />
          </Card>
          <Card label="Model" anchor="model-codex">
            <ModelSelectRow bot={codexBot} />
            <UsageMeterRow engine="codex" />
          </Card>
        </section>
        <section data-preview="settings" className="flex w-[636px] flex-col gap-3" data-settings-look="simple">
          {LIMITS.map((limit) => <UsageMeterCard key={limit.engine} limit={limit} />)}
          <div className="mt-6"><UsageBanner engine="codex" onSeeUsage={() => {}} /></div>
        </section>
      </div>
    </StoreContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
