import { createRoot } from "react-dom/client";
import { ComputerPanel } from "../../src/components/ComputerPanel";
import { StoreProvider, useStore } from "../../src/state/store";
import { applySkin, readSkin } from "../../src/lib/skins";
import "../../src/styles.css";

const stats = { screenshots: 0 };
Object.assign(window, { liveComputerFixture: stats });
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (typeof input === "string" && input.includes("/screenshot")) stats.screenshots++;
  return originalFetch(input, init);
};

function Fixture() {
  const { state } = useStore();
  const id = new URLSearchParams(location.search).get("bot");
  const bot = state.bots.find(bot => bot.id === id);
  return bot ? <div className="flex h-screen justify-center"><ComputerPanel bot={bot} /></div> : <p>Loading fixture</p>;
}

applySkin(readSkin());
createRoot(document.getElementById("root")!).render(<StoreProvider><Fixture /></StoreProvider>);
