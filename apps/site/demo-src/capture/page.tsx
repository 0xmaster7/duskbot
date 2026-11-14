// the real app for capture.mjs: App against the `pnpm demo` harness, with its store handed to the page (window.__cap)
// so the capture can put the demo's bots and chats in place and read back what the app draws
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "../../../../src/App";
import { setEmailGateDone } from "../../../../src/lib/analytics";
import { NOTICES } from "../../../../src/lib/notices";
import { applySkin } from "../../../../src/lib/skins";
import { useStore } from "../../../../src/state/store";
import "../../../../src/font-faces.css";
import "../../../../src/styles.css";
import "../../../../src/styles/overlays.css";
import "../../../../src/styles/motion.css";

setEmailGateDone("skipped");
for (const notice of NOTICES) localStorage.setItem(notice, "1");
applySkin("grok");
function Probe() {
  const { state, dispatch } = useStore();
  useEffect(() => { Object.assign(window, { __cap: { state, dispatch, ready: state.bots.length > 0 } }); }, [state, dispatch]);
  return null;
}
createRoot(document.getElementById("root")!).render(<App><Probe /></App>);
