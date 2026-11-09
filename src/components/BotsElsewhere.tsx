// This computer's page with no bots of its own while the person's live somewhere else: it says where they are and opens
// that place instead of a blank first run (src/lib/bots-elsewhere.ts). Kept apart from the first run (onboarding/*),
// which it covers while it shows.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { openAddVps } from "@/lib/vps-link";
import {
  devToolsShown, dismissKey, dismissedPlaces, dismissPlace, elsewhereScreen, emptyHere, parseElsewhereView,
  setSimulatedFreshInstall, SIMULATED_FRESH_INSTALL, useSimulatedFreshInstall, type ElsewhereScreen, type ElsewhereView,
} from "@/lib/bots-elsewhere";
import { useStore } from "@/state/store";

const WHY_KEY = { moved: "elsewhere.why.moved", cloud: "elsewhere.why.cloud", team: "elsewhere.why.team", server: "elsewhere.why.server" } as const;

export function BotsElsewhere() {
  const { state } = useStore();
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.elsewhere;
  const simulated = useSimulatedFreshInstall();
  const [view, setView] = useState<ElsewhereView | null>(null);
  const [dismissed, setDismissed] = useState(dismissedPlaces);
  const [leaving, setLeaving] = useState(false);
  const empty = state.hydrated === true && state.connected && emptyHere(state.bots);

  const load = useCallback(() => {
    if (!bridge) return;
    void bridge.state().then((raw) => setView(parseElsewhereView(raw)), () => setView(null));
  }, [bridge]);
  useEffect(() => {
    if (!empty) return;
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [empty, load]);

  const screen = simulated
    ? elsewhereScreen({ view: SIMULATED_FRESH_INSTALL, empty: true, dismissed: [] })
    : leaving ? null : elsewhereScreen({ view, empty, dismissed });
  if (!screen) return null;

  const stay = () => {
    if (simulated) return setSimulatedFreshInstall(false);
    dismissPlace(dismissKey(screen));
    setDismissed(dismissedPlaces());
  };
  const open = (id: string) => {
    setLeaving(true);
    void bridge?.open(id).then((opened) => { if (!opened) setLeaving(false); }, () => setLeaving(false));
  };
  const connect = () => {
    if (simulated) { setSimulatedFreshInstall(false); openAddVps(); return; }
    setLeaving(true);
    void bridge?.connect().then((kind) => {
      if (kind === "server") openAddVps();
      if (!kind) setLeaving(false);
    }, () => setLeaving(false));
  };
  return <ElsewhereCard screen={screen} simulated={simulated} onOpen={open} onConnect={connect} onStay={stay} />;
}

export function ElsewhereCard({ screen, simulated = false, onOpen, onConnect, onStay }: {
  screen: ElsewhereScreen; simulated?: boolean; onOpen: (id: string) => void; onConnect: () => void; onStay: () => void;
}) {
  const app = productName();
  const name = screen.kind === "bots-on" ? screen.place.name : screen.setup.name;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="elsewhere-title" className="fixed inset-0 z-[60] flex overflow-y-auto bg-app">
      <WindowDragStrip />
      <div className="m-auto w-full max-w-[480px] px-6 py-12">
        {simulated && (
          <p className="mb-3 inline-block rounded-full bg-raised px-2.5 py-1 text-[12px] text-ink-secondary">{t("elsewhere.dev.simulated")}</p>
        )}
        <h1 id="elsewhere-title" className="text-[22px] font-semibold leading-snug text-ink">
          {screen.kind === "bots-on" ? t("elsewhere.botsOn.title", { name }) : t("elsewhere.setUpOn.title", { app, name })}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">
          {screen.kind === "bots-on" ? t(WHY_KEY[screen.place.why], { name }) : t("elsewhere.setUpOn.why", { app, name })}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => (screen.kind === "bots-on" ? onOpen(screen.place.id) : onConnect())}
            className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-app hover:bg-ink/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
          >
            {screen.kind === "bots-on" ? t("elsewhere.open", { name }) : t("elsewhere.connect", { name })}
          </button>
          <button
            type="button"
            onClick={onStay}
            className="rounded-full px-4 py-2.5 text-[14px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {screen.kind === "bots-on" ? t("elsewhere.startHere") : t("elsewhere.setUpHere")}
          </button>
        </div>
        {screen.kind === "bots-on" && screen.others.length > 0 && (
          <div className="mt-8 border-t border-hairline pt-4">
            <p className="text-[13px] text-ink-secondary">{t("elsewhere.others")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {screen.others.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => onOpen(place.id)}
                  className="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {t("elsewhere.open", { name: place.name })}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Dev builds only (or localStorage "omb-dev-tools" = "1"): shows the fresh-install screen for an account with a VPS. */
export function DevFreshInstallButton() {
  const simulated = useSimulatedFreshInstall();
  if (!devToolsShown()) return null;
  return (
    <button
      type="button"
      onClick={() => setSimulatedFreshInstall(!simulated)}
      className="fixed right-3 top-1.5 z-[70] rounded-full border border-hairline bg-card px-3 py-1 text-[12px] text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      {simulated ? t("elsewhere.dev.stop") : t("elsewhere.dev.simulate")}
    </button>
  );
}
