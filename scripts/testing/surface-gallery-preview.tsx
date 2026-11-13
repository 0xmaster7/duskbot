// The surfaces gallery: the real app against the disposable fixture server, with its store's dispatch handed to the
// run (window.__surfaceGallery), so each settings page, bot panel tab, dialog and sheet can be opened in turn and
// checked by chat-gallery/layout-audit.ts. ?onboarding=<step> opens the first-run flow at that step instead.
// Served only by scripts/testing/surface-gallery.e2e.test.ts.
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { setEmailGateDone } from "../../src/lib/analytics";
import { GROK_MOVE_NOTICE } from "../../src/lib/notices";
import { applySkin, SKINS } from "../../src/lib/skins";
import { saveWelcomeDraft } from "../../src/lib/welcome-draft";
import { BEAT_ORDER, type BeatId } from "../../src/lib/onboarding";
import { useStore } from "../../src/state/store";
import { auditLayout } from "./chat-gallery/layout-audit";
import "../../src/styles.css";
import "../../src/styles/overlays.css";
import "../../src/styles/motion.css";

const params = new URLSearchParams(location.search);
const step = params.get("onboarding");
if (step && (BEAT_ORDER as readonly string[]).includes(step)) saveWelcomeDraft({ beat: step as BeatId });
else setEmailGateDone("skipped");
localStorage.setItem(GROK_MOVE_NOTICE, "1");
applySkin(SKINS.find((one) => one.id === params.get("skin"))?.id ?? "grok");

function Probe() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    Object.assign(window, { __surfaceGallery: { dispatch, botId: state.bots.find((bot) => bot.name === "Pepper")?.id ?? state.bots[0]?.id, ready: state.bots.length > 0 } });
  }, [dispatch, state.bots]);
  return null;
}

Object.assign(window, { __galleryAudit: auditLayout });
createRoot(document.getElementById("root")!).render(<App><Probe /></App>);
