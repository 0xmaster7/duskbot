// The surfaces gallery: the real app against the disposable fixture server, with its store's dispatch handed to the
// run (window.__surfaceGallery), so each settings page, bot panel tab, dialog and sheet can be opened in turn and
// checked by chat-gallery/layout-audit.ts. ?onboarding=<step> opens the first-run flow at that step instead.
// Served only by scripts/testing/surface-gallery.e2e.test.ts.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConnectAiDialog } from "../../src/components/onboarding/ConnectAi";
import { Toast } from "../../src/components/ui/Toast";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { setEmailGateDone } from "../../src/lib/analytics";
import { GROK_MOVE_NOTICE } from "../../src/lib/notices";
import { applySkin, SKINS } from "../../src/lib/skins";
import { saveWelcomeDraft } from "../../src/lib/welcome-draft";
import { BEAT_ORDER, type BeatId } from "../../src/lib/onboarding";
import { useStore } from "../../src/state/store";
import { CloudReady } from "../../src/components/CloudSetup";
import { AppUpdatePill } from "../../src/components/AppUpdatePill";
import { useSidebarFooterSlot } from "../../src/lib/sidebar-footer-slot";
import { auditLayout } from "./chat-gallery/layout-audit";
import { setLocalBrowserFixture } from "../../src/lib/local-browser";
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

// ?card=cloud-ready: the cloud-ready card in the sidebar footer, as a new dusk cloud shows it.
// ?card=connect-ai: Connect an AI opened from inside the chat's composer dock, where the no-AI card opens it, so the
// gallery's cover check sees whether its scrim escapes the dock's stacking context and covers the whole window
const heldUpdate = (state: { ready: string | null; available: string; progress: number | null }) =>
  ({ state: async () => state, restart: async () => false, download: async () => null, onState: () => () => undefined });
const APP_UPDATE: Record<string, ReturnType<typeof heldUpdate>> = {
  "app-update-available": heldUpdate({ ready: null, available: "0.2.7", progress: null }),
  "app-update-downloading": heldUpdate({ ready: null, available: "0.2.7", progress: 0.4 }),
  "app-update-ready": heldUpdate({ ready: "0.2.7", available: "0.2.7", progress: null }),
};

function Cards() {
  const slot = useSidebarFooterSlot();
  const [dock, setDock] = useState<Element | null>(null);
  useEffect(() => {
    if (params.get("card") !== "connect-ai") return;
    const timer = setInterval(() => { const found = document.querySelector("[data-grok-inset]"); if (found) { setDock(found); clearInterval(timer); } }, 100);
    return () => clearInterval(timer);
  }, []);
  // ?card=app-update-available / -downloading / -ready: the sidebar's update pill, where it sits above the account row
  const update = APP_UPDATE[params.get("card") ?? ""];
  if (update && slot) return createPortal(<AppUpdatePill bridge={update} />, slot);
  if (params.get("card") === "cloud-ready") return <CloudReady slot={slot} onDone={() => undefined} />;
  // ?card=toast-done / toast-error: a passing toast, held on screen
  if (params.get("card") === "toast-done") return <Toast text="Pepper is ready to use" action={{ label: "Undo", onClick: () => undefined }} timeoutMs={600_000} onDone={() => undefined} />;
  if (params.get("card") === "toast-error") return <Toast tone="error" text="Couldn't save Pepper's name. Try again." timeoutMs={600_000} onDone={() => undefined} />;
  if (params.get("card") === "connect-ai" && dock) return createPortal(<ConnectAiDialog tested={null} onClose={() => undefined} />, dock);
  return null;
}

/** A still web page for the gallery's browser tabs: a header bar, a heading and a few lines, as an SVG address. */
const page = (accent: string, heading: string, lines: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
<rect width="1280" height="800" fill="#f6f6f4"/><rect width="1280" height="72" fill="${accent}"/><rect x="48" y="24" width="140" height="24" rx="4" fill="#fafafa" opacity="0.85"/>
<text x="96" y="200" font-family="Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#1b1b1b">${heading}</text>
${Array.from({ length: lines }, (_, at) => `<rect x="96" y="${250 + at * 44}" width="${900 - (at % 3) * 160}" height="18" rx="9" fill="#d9d9d6"/>`).join("")}
<rect x="96" y="${280 + lines * 44}" width="220" height="56" rx="28" fill="${accent}"/></svg>`)}`;
const GALLERY_TABS = [
  { title: "Create an invoice", url: "https://www.paypal.com/invoice/create", image: page("#1f3d8a", "New invoice", 5) },
  { title: "Log in", url: "https://wise.com/login", image: page("#2f6b3a", "Log in to Wise", 3) },
  { title: "Example Domain", url: "https://example.com/", image: page("#555a63", "Example Domain", 4) },
  { title: "Example domains", url: "https://www.iana.org/help/example-domains", image: page("#8a5a1f", "Example domains", 6) },
];
// ?card=local-browser-working / -closed / -offer: a local bot's browser with tabs open, closed four minutes ago, or idle
const localBrowser = params.get("card");
if (localBrowser === "local-browser-working") setLocalBrowserFixture({ open: true, closed: null, tabs: GALLERY_TABS, working: true });
if (localBrowser === "local-browser-closed") setLocalBrowserFixture({ open: false, closed: { at: Date.now() - 4 * 60_000, tabs: GALLERY_TABS.slice(0, 3) } });
if (localBrowser === "local-browser-offer") setLocalBrowserFixture({ open: false, closed: null });

Object.assign(window, { __galleryAudit: auditLayout });
createRoot(document.getElementById("root")!).render(<App><Probe /><Cards /></App>);
