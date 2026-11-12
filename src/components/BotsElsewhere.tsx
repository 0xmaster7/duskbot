// This computer's page with no bots of its own while the person's live somewhere else: it says where they are, lists every
// place they have with a way into each (src/lib/bots-elsewhere.ts), and opens one instead of a blank first run. Kept apart
// from the first run (onboarding/*), which it covers while it shows.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { productName } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { useCloudMoveOpen } from "@/lib/cloud-move";
import { t } from "@/lib/i18n";
import { openAddVps, useAddVpsOpen } from "@/lib/vps-link";
import {
  devToolsShown, dismissKey, dismissedPlaces, dismissPlace, elsewhereCovered, elsewhereScreen, emptyHere, parseElsewhereView,
  setSimulatedFreshInstall, SIMULATED_FRESH_INSTALL, useSimulatedFreshInstall, type ElsewhereScreen, type ElsewhereView,
} from "@/lib/bots-elsewhere";
import { useStore } from "@/state/store";
import { DesktopWorkspaceSwitcher } from "./DesktopWorkspaceSwitcher";
import { WorkspacesGroup } from "./WorkspacesSettings";

/** Settings' place rows drawn on this screen: the 48px rows, 12px corners and soft hover the settings sheet gives them,
 * on the card's own tonal fill. */
const PLACE_ROWS = cn(
  "[&_[data-settings-rows]]:gap-0.5",
  "[&_[data-settings-rows]>*]:min-h-12 [&_[data-settings-rows]>*]:gap-4 [&_[data-settings-rows]>*]:rounded-[12px] [&_[data-settings-rows]>*]:px-2.5 [&_[data-settings-rows]>*]:py-[9px]",
  "[&_[data-settings-rows]>*:not(:disabled):hover]:bg-ink/[0.035]",
);

const WHY_KEY = { moved: "elsewhere.why.moved", cloud: "elsewhere.why.cloud", team: "elsewhere.why.team", server: "elsewhere.why.server" } as const;

export function BotsElsewhere() {
  const { state, dispatch } = useStore();
  const bridge = typeof window === "undefined" ? undefined : window.duskDesktop?.elsewhere;
  const simulated = useSimulatedFreshInstall();
  const [view, setView] = useState<ElsewhereView | null>(null);
  const [dismissed, setDismissed] = useState(dismissedPlaces);
  // the place being opened: the screen stays, saying so, until the window has gone there (main answers once it is over)
  const [opening, setOpening] = useState<string | null>(null);
  const covered = elsewhereCovered({
    settings: state.appSettingsOpen, cloudAdd: Boolean(state.cloudAdd), addVps: useAddVpsOpen(), cloudMove: Boolean(useCloudMoveOpen()),
  });
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
    : elsewhereScreen({ view, empty, dismissed });
  if (!screen || covered) return null;

  const stay = () => {
    if (simulated) return setSimulatedFreshInstall(false);
    dismissPlace(dismissKey(screen));
    setDismissed(dismissedPlaces());
  };
  // an answer that reaches this page means the window stayed here, so the screen is itself again
  const open = (id: string) => {
    if (opening || !bridge) return;
    setOpening(id);
    void bridge.open(id).finally(() => setOpening(null));
  };
  const connect = () => {
    if (simulated) { setSimulatedFreshInstall(false); openAddVps(); return; }
    if (opening || !bridge) return;
    setOpening("connect");
    void bridge.connect().then((kind) => { if (kind === "server") openAddVps(); }).finally(() => setOpening(null));
  };
  return (
    <ElsewhereCard screen={screen} simulated={simulated} opening={opening} onOpen={open} onConnect={connect} onStay={stay}>
      {screen.kind === "bots-on" && <WorkspacesGroup onAdd={() => dispatch({ type: "toggleAppSettings", open: true, section: "desktopWorkspaces" })} />}
    </ElsewhereCard>
  );
}

/** `children`: every place the person has, each with its state and a way in (the bots-on hub only). `opening`: the place
 * being opened, or "connect", while the window gets there. */
export function ElsewhereCard({ screen, simulated = false, opening = null, onOpen, onConnect, onStay, children }: {
  screen: ElsewhereScreen; simulated?: boolean; opening?: string | null; onOpen: (id: string) => void; onConnect: () => void; onStay: () => void; children?: ReactNode;
}) {
  const app = productName();
  const botsOn = screen.kind === "bots-on";
  const name = botsOn ? screen.place.name : screen.setup.name;
  const busy = opening !== null;
  const stay = (
    <button
      type="button"
      onClick={onStay}
      disabled={busy}
      className="rounded-full px-4 py-2.5 text-[14px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
    >
      {botsOn ? t("elsewhere.startHere") : t("elsewhere.setUpHere")}
    </button>
  );
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="elsewhere-title" aria-busy={busy || undefined} data-elsewhere={screen.kind}
      className="fixed inset-0 z-[60] flex overflow-y-auto bg-app">
      <WindowDragStrip />
      <div className="m-auto w-full max-w-[480px] px-6 py-12">
        {simulated && (
          <p className="mb-3 inline-block rounded-full bg-raised px-2.5 py-1 text-[12px] text-ink-secondary">{t("elsewhere.dev.simulated")}</p>
        )}
        {botsOn && <div className="relative mb-5 flex"><DesktopWorkspaceSwitcher inline pill always /></div>}
        <h1 id="elsewhere-title" className="text-[22px] font-semibold leading-snug text-ink">
          {botsOn ? t("elsewhere.botsOn.title", { name }) : t("elsewhere.setUpOn.title", { app, name })}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">
          {botsOn ? t(WHY_KEY[screen.place.why], { name }) : t("elsewhere.setUpOn.why", { app, name })}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            autoFocus
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => (botsOn ? onOpen(screen.place.id) : onConnect())}
            className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-app hover:bg-ink/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
          >
            {busy ? t("reconnect.opening") : botsOn ? t("elsewhere.open", { name }) : t("elsewhere.connect", { name })}
          </button>
          {!botsOn && stay}
        </div>
        {children && <div data-elsewhere-places="" className={cn("mt-10", PLACE_ROWS)}>{children}</div>}
        {botsOn && <div className="mt-6 -ms-4">{stay}</div>}
      </div>
    </div>
  );
}

/** Dev builds only (or localStorage "dusk-dev-tools" = "1"): shows the fresh-install screen for an account with a VPS. */
export function DevFreshInstallButton() {
  const simulated = useSimulatedFreshInstall();
  if (!devToolsShown()) return null;
  return (
    <button
      type="button"
      onClick={() => setSimulatedFreshInstall(!simulated)}
      className="fixed right-3 top-1.5 z-[70] rounded-full border border-transparent bg-card px-3 py-1 text-[12px] text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      {simulated ? t("elsewhere.dev.stop") : t("elsewhere.dev.simulate")}
    </button>
  );
}
