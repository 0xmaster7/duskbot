// This computer's page with no bots of its own while the person's live somewhere else: a short list of every place they
// have, how many bots each holds and whether it is up, the one with their bots marked, and a click on a row opens it
// (src/lib/bots-elsewhere.ts). Kept apart from the first run (onboarding/*), which it covers while it shows.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { RailPlace } from "../../electron/cloud-rail.mjs";
import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { productName } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { useCloudMoveOpen } from "@/lib/cloud-move";
import { t } from "@/lib/i18n";
import { usePlaces } from "@/lib/places";
import { openAddVps, useAddVpsOpen } from "@/lib/vps-link";
import {
  devToolsShown, dismissKey, dismissedPlaces, dismissPlace, elsewhereCovered, elsewhereScreen, emptyHere, parseBotCounts, parseElsewhereView,
  setSimulatedFreshInstall, SIMULATED_FRESH_INSTALL, useSimulatedFreshInstall, type ElsewherePlace, type ElsewhereScreen, type ElsewhereView,
} from "@/lib/bots-elsewhere";
import { useStore } from "@/state/store";
import { ChevronRight } from "../icons";
import { CloudMoveRow } from "./CloudMoveSettings";
import { Icon } from "./Icon";
import { NavRow } from "./ListRows";
import { SIMPLE_CARD } from "./SettingsPrimitives";
import { PixelIcon } from "./ui/PixelIcon";
import { DOT, HEALTH_WORD, KIND_ICON, kindWord, placeHealth } from "./WorkspacesSettings";

/** Settings' rows on this screen: 48px tall, 12px corners and the soft hover the settings sheet gives them, on the card's
 * own tonal fill; the place holding the bots keeps a deeper fill. */
const ROWS = cn(
  "[&_[data-settings-rows]]:gap-0.5",
  "[&_[data-settings-rows]>*]:min-h-14 [&_[data-settings-rows]>*]:gap-4 [&_[data-settings-rows]>*]:rounded-[12px] [&_[data-settings-rows]>*]:px-3 [&_[data-settings-rows]>*]:py-2.5",
  "[&_[data-settings-rows]>*:not(:disabled,[data-lit]):hover]:bg-ink/[0.035]",
);

const KIND_OF_WHY = { moved: "server", server: "server", cloud: "cloud", team: "team" } as const;

/** One way to say how many bots: none, one, or a number. */
function botWord(count: number): string {
  return count === 0 ? t("settings.logins.noBots") : count === 1 ? t("cloudSend.list.botOne") : t("cloudSend.list.bots", { count });
}

/** The places to list: main's own list when it has one, else this computer and the places main named. */
function listed(rail: RailPlace[], here: ElsewherePlace[]): RailPlace[] {
  const mine = rail[0]?.group;
  const places = rail.filter((place) => place.kind !== "account" && place.group === mine);
  if (places.length) return places;
  return [{ id: "local", name: kindWord("computer"), color: null, kind: "computer", opens: true, active: true },
    ...here.map((place): RailPlace => ({ id: place.id, name: place.name, color: null, kind: KIND_OF_WHY[place.why], opens: true }))];
}

export function BotsElsewhere() {
  const { state, dispatch } = useStore();
  const bridge = typeof window === "undefined" ? undefined : window.duskDesktop?.elsewhere;
  const rail = usePlaces();
  const simulated = useSimulatedFreshInstall();
  const [view, setView] = useState<ElsewhereView | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
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
    void bridge.counts?.().then((raw) => setCounts(parseBotCounts(raw)), () => {});
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
    if (opening) return;
    const workspaces = window.duskDesktop?.workspaces;
    const go = rail.places.some((place) => place.id === id) && workspaces?.open ? workspaces.open(id) : bridge?.open(id);
    if (!go) return;
    setOpening(id);
    void Promise.resolve(go).catch(() => {}).finally(() => setOpening(null));
  };
  const connect = () => {
    if (simulated) { setSimulatedFreshInstall(false); openAddVps(); return; }
    if (opening || !bridge) return;
    setOpening("connect");
    void bridge.connect().then((kind) => { if (kind === "server") openAddVps(); }).finally(() => setOpening(null));
  };
  if (screen.kind === "set-up-on") return <SetUpOnCard screen={screen} simulated={simulated} opening={opening} onConnect={connect} onStay={stay} />;

  const places = listed(rail.places, [screen.place, ...screen.others]);
  const hasCloud = places.some((place) => place.kind === "cloud" || place.kind === "team");
  const canBuy = Boolean(window.duskDesktop?.cloudAccount) && window.duskDesktop?.remoteClient?.active !== true;
  const ownHere = state.bots.filter((bot) => !bot.defaultBot && !bot.hidden).length;
  return (
    <PlacesHub
      places={places}
      counts={{ ...counts, ...Object.fromEntries(places.filter((place) => place.kind === "computer").map((place) => [place.id, ownHere])) }}
      lit={screen.place.id}
      opening={opening}
      simulated={simulated}
      onOpen={open}
      onStay={stay}
      getCloud={!hasCloud && canBuy ? () => dispatch({ type: "openCloudAdd", source: "app_settings" }) : null}
      onAdd={() => dispatch({ type: "toggleAppSettings", open: true, section: "desktopWorkspaces" })}
    />
  );
}

/** The bots-on screen: a short heading and every place as one selectable row, how many bots it has and whether it is up,
 * then getting dusk cloud (or moving to it) and adding a place, and starting fresh here as the quiet last line. `lit`: the
 * place main says holds the bots, marked when no count says otherwise. */
export function PlacesHub({ places, counts, lit, opening = null, simulated = false, onOpen, onStay, getCloud, onAdd }: {
  places: RailPlace[]; counts: Record<string, number>; lit: string; opening?: string | null; simulated?: boolean;
  onOpen: (id: string) => void; onStay: () => void; getCloud: (() => void) | null; onAdd: () => void;
}) {
  const busy = opening !== null;
  const counted = places.some((place) => !place.active && (counts[place.id] ?? 0) > 0);
  const holds = (place: RailPlace) => (counted ? (counts[place.id] ?? 0) > 0 : place.id === lit);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="elsewhere-title" aria-busy={busy || undefined} data-elsewhere="bots-on"
      className="fixed inset-0 z-[60] flex overflow-y-auto bg-app">
      <WindowDragStrip />
      <div className="m-auto w-full max-w-[480px] px-6 py-12">
        {simulated && (
          <p className="mb-3 inline-block rounded-full bg-raised px-2.5 py-1 text-[12px] text-ink-secondary">{t("elsewhere.dev.simulated")}</p>
        )}
        <h1 id="elsewhere-title" className="px-3 text-[22px] font-semibold leading-snug text-ink">{t("elsewhere.pick.title")}</h1>
        <div className={cn("mt-6", ROWS)}>
          <div data-settings-rows="" className={cn(SIMPLE_CARD, "p-1.5")}>
            {places.map((place) => (
              <PlaceRow key={place.id} place={place} count={counts[place.id]} lit={holds(place) && !place.active}
                opening={opening === place.id} busy={busy} onOpen={() => onOpen(place.id)} />
            ))}
          </div>
          <div data-settings-rows="" className={cn(SIMPLE_CARD, "mt-3 p-1.5")}>
            <CloudMoveRow otherwise={getCloud
              ? <NavRow data-settings-open="get-cloud" pixel="cloud" title={t("settings.docs.ws.getCloud")} hint={t("settings.docs.ws.getCloudHint")} onClick={getCloud} />
              : null} />
            <NavRow data-settings-open="add-workspace" pixel="plus" title={t("settings.docs.ws.add")} hint={t("settings.docs.ws.addHint")} onClick={onAdd} />
          </div>
        </div>
        <div className="mt-6">
          <button
            type="button"
            onClick={onStay}
            disabled={busy}
            className="rounded-full px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
          >
            {t("elsewhere.startHere")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One place, the whole row a button: its icon with a status dot, its name, its bots and whether it is up; the place on
 * screen says current instead. */
function PlaceRow({ place, count, lit, opening, busy, onOpen }: {
  place: RailPlace; count: number | undefined; lit: boolean; opening: boolean; busy: boolean; onOpen: () => void;
}) {
  const health = placeHealth(place);
  const hint = [count === undefined ? (place.kind === "server" ? kindWord("server") : null) : botWord(count), t(HEALTH_WORD[health])].filter(Boolean).join(" · ");
  const body = (
    <>
      <span aria-hidden="true" className="relative flex size-6 shrink-0 items-center justify-center">
        <PixelIcon name={KIND_ICON[place.kind]} size={24} />
        <span data-workspace-dot={health} className={cn("absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-composer", DOT[health])} />
      </span>
      <span className="min-w-0 flex-1">
        <span data-row-title="" className="block truncate text-[13px] leading-[18px] text-ink">{place.name}</span>
        <span data-row-hint="" className="block truncate text-[12px] leading-4 text-ink-secondary">{hint}</span>
      </span>
    </>
  );
  if (place.active) {
    return (
      <div data-place-row={place.kind} aria-current="true" className="flex min-w-0 items-center">
        {body}
        <span className="flex shrink-0 items-center gap-1 text-[12px] leading-4 text-ink-secondary"><Icon name="check" size={12} />{t("connectedWorkspaces.current")}</span>
      </div>
    );
  }
  return (
    <button type="button" data-place-row={place.kind} data-lit={lit || undefined} disabled={busy || !place.opens} aria-busy={opening || undefined}
      aria-label={`${t("settings.s2.servers.switchTo", { name: place.name })} · ${hint}`} onClick={onOpen}
      className={cn("flex min-w-0 cursor-pointer items-center text-start outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-default",
        lit ? "bg-ink/[0.05] hover:bg-ink/[0.075]" : "", !opening && "disabled:opacity-60")}>
      {body}
      {opening
        ? <span className="shrink-0 text-[12px] leading-4 text-ink-secondary">{t("reconnect.opening")}</span>
        : <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
    </button>
  );
}

/** A fresh install whose account set up dusk bot elsewhere: connect there, or set this computer up instead. */
export function SetUpOnCard({ screen, simulated = false, opening = null, onConnect, onStay }: {
  screen: Extract<ElsewhereScreen, { kind: "set-up-on" }>; simulated?: boolean; opening?: string | null; onConnect: () => void; onStay: () => void;
}) {
  const app = productName();
  const name = screen.setup.name;
  const busy = opening !== null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="elsewhere-title" aria-busy={busy || undefined} data-elsewhere="set-up-on"
      className="fixed inset-0 z-[60] flex overflow-y-auto bg-app">
      <WindowDragStrip />
      <div className="m-auto w-full max-w-[480px] px-6 py-12">
        {simulated && (
          <p className="mb-3 inline-block rounded-full bg-raised px-2.5 py-1 text-[12px] text-ink-secondary">{t("elsewhere.dev.simulated")}</p>
        )}
        <h1 id="elsewhere-title" className="text-[22px] font-semibold leading-snug text-ink">{t("elsewhere.setUpOn.title", { app, name })}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{t("elsewhere.setUpOn.why", { app, name })}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            autoFocus
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConnect}
            className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-app hover:bg-ink/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
          >
            {busy ? t("reconnect.opening") : t("elsewhere.connect", { name })}
          </button>
          <button
            type="button"
            onClick={onStay}
            disabled={busy}
            className="rounded-full px-4 py-2.5 text-[14px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
          >
            {t("elsewhere.setUpHere")}
          </button>
        </div>
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
