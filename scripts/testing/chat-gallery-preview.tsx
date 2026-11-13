// The chat gallery: the real ChatView, against the disposable fixture server, showing one scenario's transcript
// (?scenario=, ?skin=). Served only by scripts/testing/chat-gallery.e2e.test.ts; window.__galleryAudit runs the check.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "../../src/components/ChatView";
import { DesktopCapabilitiesProvider } from "../../src/components/DesktopCapabilities";
import { StoreProvider, useStore } from "../../src/state/store";
import { applySkin, SKINS } from "../../src/lib/skins";
import { setEmailGateDone } from "../../src/lib/analytics";
import { SCENARIOS } from "./chat-gallery/fixtures";
import { auditLayout } from "./chat-gallery/layout-audit";
import "../../src/styles.css";
import "../../src/styles/overlays.css";
import "../../src/styles/motion.css";

const params = new URLSearchParams(location.search);
const scenario = SCENARIOS.find((one) => one.id === params.get("scenario")) ?? SCENARIOS[0]!;
const skin = SKINS.find((one) => one.id === params.get("skin"))?.id ?? "grok";
setEmailGateDone("skipped");
applySkin(skin);
Object.assign(window, { __galleryAudit: auditLayout, __galleryScenarios: SCENARIOS.map(({ id, title }) => ({ id, title })) });

function Gallery() {
  const { state } = useStore();
  const base = state.bots.find((one) => one.name === "Pepper") ?? state.bots[0];
  // built once per bot, so a store update never hands the chat new ids (which would remount every row as an arrival)
  // ?churn=1: the same transcript handed over again with new ids a few times, as a reload that re-keys every row would
  const [round, setRound] = useState(0);
  const churn = params.has("churn");
  useEffect(() => {
    if (!churn || round >= 3) return;
    const timer = setTimeout(() => setRound((value) => value + 1), 400);
    return () => clearTimeout(timer);
  }, [churn, round]);
  const all = useMemo(() => base ? scenario.messages(base.id, base.threadId) : [], [base?.id, round]);
  // ?arrive=1: the chat opens on the first rows, then the rest land one by one while it follows, as a live turn's do
  const live = params.has("arrive");
  const [count, setCount] = useState(live ? 2 : Infinity);
  useEffect(() => {
    if (!live || !all.length || count >= all.length) return;
    const timer = setTimeout(() => setCount((value) => value + 1), 350);
    return () => clearTimeout(timer);
  }, [live, all.length, count]);
  const messages = useMemo(() => all.slice(0, count), [all, count]);
  const bot = useMemo(() => base && { ...base, messages, hasMore: false, transcriptLoaded: true, busy: scenario.busy ?? false }, [base, messages]);
  if (!bot) return <p data-gallery-waiting="">Waiting for the fixture's bot</p>;
  const done = count >= all.length && (!churn || round >= 3);
  return <div data-gallery-ready={done ? scenario.id : undefined} className="flex h-dvh flex-col bg-app text-ink"><div className="min-h-0 flex-1"><ChatView bot={bot} /></div></div>;
}

createRoot(document.getElementById("root")!).render(<DesktopCapabilitiesProvider><StoreProvider><Gallery /></StoreProvider></DesktopCapabilitiesProvider>);
