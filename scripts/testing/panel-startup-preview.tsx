import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { setEmailGateDone } from "../../src/lib/analytics";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import { GROK_MOVE_NOTICE } from "../../src/lib/notices";
import "../../src/styles.css";
import "../../src/styles/overlays.css";
import "../../src/styles/motion.css";

setEmailGateDone("skipped");
setAdvancedMode(false);
localStorage.setItem(GROK_MOVE_NOTICE, "1");
localStorage.setItem("openmausbot.botPanelOpen.v1", "1");
const probe = { firstChatAt: null as number | null, mascotAtFirstChat: false, panelAtFirstChat: false };
Object.assign(window, { __panelStartupProbe: probe });
const observer = new MutationObserver(() => {
  if (probe.firstChatAt !== null || !document.querySelector('textarea[aria-label="Message Pepper"]')) return;
  probe.firstChatAt = performance.now();
  probe.panelAtFirstChat = Boolean(document.querySelector('[data-panel-slot="open"]'));
  probe.mascotAtFirstChat = Boolean(document.querySelector('[data-panel-slot="open"] [data-panel-avatar]'));
});
observer.observe(document.getElementById("root")!, { childList: true, subtree: true });
createRoot(document.getElementById("root")!).render(<App />);
