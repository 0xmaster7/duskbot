import { useState } from "react";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { removePlace, usePlaces, type RailPlace } from "@/lib/places";
import { openAddVps, vpsLinkAvailable } from "@/lib/vps-link";
import { Trash2 } from "../icons";
import { CloudMoveRow } from "./CloudMoveSettings";
import { useWorkspacePlace } from "./DesktopWorkspaceSwitcher";
import { NavRow, NoteRow } from "./ListRows";
import { Icon } from "./Icon";
import { SettingsGroup, SettingsRows } from "./SettingsPrimitives";

type Health = "online" | "offline" | "problem" | "setting-up";

export function placeHealth(place: Pick<RailPlace, "ended" | "waiting" | "offline" | "opens" | "progress">): Health {
  if (place.ended || place.waiting) return "problem";
  if (place.progress !== undefined && place.progress < 1) return "setting-up";
  if (place.offline || !place.opens) return "offline";
  return "online";
}

const DOT: Record<Health, string> = {
  online: "bg-success",
  problem: "bg-danger",
  offline: "bg-ink/25",
  "setting-up": "bg-ink/25",
};

const HEALTH_WORD: Record<Health, "settings.docs.ws.online" | "settings.docs.ws.offline" | "settings.docs.ws.problem" | "settings.docs.ws.settingUp"> = {
  online: "settings.docs.ws.online",
  offline: "settings.docs.ws.offline",
  problem: "settings.docs.ws.problem",
  "setting-up": "settings.docs.ws.settingUp",
};

function kindWord(kind: RailPlace["kind"]): string {
  if (kind === "computer") return window.duskDesktop?.platform === "darwin" ? t("settings.docs.ws.thisMac") : t("settings.docs.ws.thisComputer");
  if (kind === "cloud") return t("settings.docs.ws.cloud");
  if (kind === "team") return t("settings.docs.ws.team");
  return t("settings.docs.ws.server");
}

const confirmAction = (text: string) => (window.duskDesktop?.confirm ? window.duskDesktop.confirm(text) : Promise.resolve(window.confirm(text)));

/** One workspace: a status dot, its name and what it is, then "current" or a click that switches to it. */
function WorkspaceRow({ place, onOpen, onRemove, busy }: { place: RailPlace; onOpen: () => void; onRemove?: () => void; busy: boolean }) {
  const health = placeHealth(place);
  const current = place.active === true;
  const kind = kindWord(place.kind);
  const hint = place.name === kind ? t(HEALTH_WORD[health]) : `${kind} · ${t(HEALTH_WORD[health])}`;
  const body = (
    <>
      <span aria-hidden="true" data-workspace-dot={health} className={cn("size-2 shrink-0 rounded-full", DOT[health])} />
      <span className="min-w-0 flex-1">
        <span data-row-title="" className="block truncate text-[13px] leading-[18px] text-ink">{place.name}</span>
        <span data-row-hint="" className="block truncate text-[12px] leading-4 text-ink-secondary">{hint}</span>
      </span>
      {current
        ? <span data-workspace-current="" className="flex shrink-0 items-center gap-1 px-2.5 py-1 text-[12px] font-semibold leading-4 text-ink"><Icon name="check" size={12} />{t("connectedWorkspaces.current")}</span>
        : <span aria-hidden="true" className="shrink-0 rounded-full bg-ink/[0.06] px-2.5 py-1 text-[12px] font-medium leading-4 text-ink">{t("connectedWorkspaces.switch")}</span>}
    </>
  );
  return (
    <div data-workspace={place.kind} data-workspace-health={health} className="flex min-w-0 items-center gap-1">
      {current
        ? <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[12px] px-2.5 py-2" aria-current="true">{body}</div>
        : <button type="button" disabled={busy || !place.opens} onClick={onOpen} aria-label={t("settings.s2.servers.switchTo", { name: place.name })}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[12px] px-2.5 py-2 text-start outline-none hover:bg-ink/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:opacity-60">
            {body}
          </button>}
      {!onRemove && <span aria-hidden="true" className="size-8 shrink-0" />}
      {onRemove && !current && (
        <button type="button" disabled={busy} onClick={onRemove} aria-label={t("settings.s2.servers.forget", { name: place.name })} title={t("settings.s2.servers.forget", { name: place.name })}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-secondary outline-none hover:bg-ink/[0.05] hover:text-danger focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45">
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Settings → Computer's first group: every workspace the bots can live in, with the current one marked and one click to
 * switch, then moving to dusk cloud (or getting one) and adding another. */
export function WorkspacesGroup({ onAdd }: { onAdd: () => void }) {
  const { state, dispatch } = useStore();
  const rail = usePlaces();
  const here = useWorkspacePlace({ cloudHome: state.config?.cloudHome === true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = rail.places[0]?.group;
  const listed = rail.places.filter((place) => place.kind !== "account" && place.group === mine);
  const places: RailPlace[] = listed.length ? listed : [{
    id: "local", name: here.current?.name || kindWord("computer"), color: null, opens: true, active: true,
    kind: here.current?.home ? "cloud" : "computer",
  }];
  const hasCloud = places.some((place) => place.kind === "cloud" || place.kind === "team");
  const canBuy = Boolean(window.duskDesktop?.cloudAccount) && window.duskDesktop?.remoteClient?.active !== true;

  const open = (place: RailPlace) => {
    const bridge = window.duskDesktop?.workspaces;
    if (!bridge?.open || busy) return;
    setBusy(true); setError("");
    void bridge.open(place.id).catch(() => setError(t("connectedWorkspaces.switchError"))).finally(() => setBusy(false));
  };
  const remove = async (place: RailPlace) => {
    if (busy || !await confirmAction(t("settings.docs.ws.removeConfirm", { name: place.name }))) return;
    setBusy(true); setError("");
    const outcome = await removePlace(place.id);
    if (outcome !== "removed" && outcome !== "gone") setError(t("settings.docs.ws.removeFailed", { name: place.name }));
    setBusy(false);
  };

  return (
    <SettingsGroup label={t("settings.docs.ws.title")} art="computer" hint={t("settings.docs.ws.hint")} block="workspaces">
      <SettingsRows>
        {places.map((place) => (
          <WorkspaceRow key={place.id} place={place} busy={busy} onOpen={() => open(place)}
            onRemove={place.removable ? () => void remove(place) : undefined} />
        ))}
        <CloudMoveRow otherwise={!hasCloud && canBuy
          ? <NavRow data-settings-open="get-cloud" title={t("settings.docs.ws.getCloud")} hint={t("settings.docs.ws.getCloudHint")}
              onClick={() => dispatch({ type: "openCloudAdd", source: "app_settings" })} />
          : null} />
        <NavRow data-settings-open="add-workspace" title={t("settings.docs.ws.add")} hint={t("settings.docs.ws.addHint")} onClick={onAdd} />
        {(error || here.error) && <NoteRow tone="danger">{error || here.error}</NoteRow>}
      </SettingsRows>
    </SettingsGroup>
  );
}

/** Installing dusk on a server of one's own, in three short steps; the line itself comes from the add-a-VPS flow, which
 * makes a fresh one each time and watches for the server to answer. */
export function InstallOnVpsGroup() {
  if (!vpsLinkAvailable()) return null;
  const steps = ["settings.docs.vps.step1", "settings.docs.vps.step2", "settings.docs.vps.step3"] as const;
  return (
    <SettingsGroup label={t("settings.docs.vps.title")} art="server" hint={t("settings.docs.vps.hint")} block="install-vps">
      <div className="flex flex-col gap-3 px-2.5">
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3 text-[13px] font-medium leading-[19px] text-ink">
              <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-semibold tabular-nums text-ink-secondary">{index + 1}</span>
              <span className="min-w-0">{t(step)}</span>
            </li>
          ))}
        </ol>
        <div>
          <button type="button" data-settings-open="install-vps" className="ui-button ui-button-primary" onClick={openAddVps}>{t("settings.docs.vps.cta")}</button>
        </div>
      </div>
    </SettingsGroup>
  );
}
