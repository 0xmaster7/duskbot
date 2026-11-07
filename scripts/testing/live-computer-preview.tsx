import { createRoot } from "react-dom/client";
import { ComputerPanel } from "../../src/components/ComputerPanel";
import { StoreProvider, useStore } from "../../src/state/store";
import { applySkin, readSkin } from "../../src/lib/skins";
import "../../src/styles.css";

const stats = { status: {} as Record<string, unknown>, screenshots: 0, requests: [] as Array<{ url: string; method: string; status: number }> };
Object.assign(window, { liveComputerFixture: stats });
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (typeof input === "string" && input.includes("/screenshot")) stats.screenshots++;
  return originalFetch(input, init).then(async response => {
    if (typeof input === "string" && /\/computer\?/.test(input)) {
      const body = await response.clone().json();
      stats.status = { configured: body.configured, ready: body.ready, container: body.container };
    }
    if (typeof input === "string" && (input.includes("/computer") || input.includes("/desktop-viewer/"))) stats.requests.push({ url: input, method: init?.method ?? "GET", status: response.status });
    return response;
  });
};

function Fixture() {
  const { state } = useStore();
  const id = new URLSearchParams(location.search).get("bot");
  const bot = state.bots.find(bot => bot.id === id);
  const inline = new URLSearchParams(location.search).has("inline");
  return bot ? <div className="mx-auto h-screen w-[420px]"><ComputerPanel bot={bot} inline={inline} /></div> : <p>Loading fixture</p>;
}

applySkin(readSkin());
createRoot(document.getElementById("root")!).render(<StoreProvider><Fixture /></StoreProvider>);
