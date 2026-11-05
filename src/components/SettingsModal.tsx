import { useEffect, useRef, useState } from "react";
import { useStore, type Action, type AppSettingsSection } from "@/state/store";
import { type LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { scrollWithin } from "@/lib/scroll-within";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { currentPhonePairingTarget, phonePairingSettingsAction } from "@/lib/phone-pairing";
import { AdminOnly } from "./AdminOnly";
import { KeysPage } from "./keys/KeysPage";
import { useKeyFocus } from "./keys/key-focus";
import { CompanionSection } from "./CompanionSection";
import { ServerPairingCard } from "./ServerPairingCard";
import { CustomDomainSettings } from "./CustomDomainSettings";
import { RemoteComputerSection } from "./RemoteComputerSection";
import { ConnectedWorkspacesSettings } from "./ConnectedWorkspacesSettings";
import { CloudAccountSettings } from "./CloudAccountSettings";
import { LicenseExpiryBanner } from "./LicenseExpiryBanner";
import { workspacesAvailable } from "./WorkspacesSection";
import { GrokIcon, type GrokIconName } from "./GrokIcon";
import { SIMPLE_BUTTONS } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";
import { shortcutLabel } from "./ShortcutHint";
import {
  ADVANCED_PAGES, AdvancedIndex, AdvancedPageView, BackButton, ComputerPane, GeneralPane, PermissionsPane, TextingPane, UpdatesPane,
  advancedTitle, type AdvancedPage, type Disclose, type RemoteAccessCards,
} from "./SettingsPanes";
import "../styles/settings.css";

export type SettingsPane = "general" | "texting" | "computer" | "permissions" | "updates" | "advanced";

/** Grok's five panes, then Advanced, which holds everything of ours Grok has no place for. */
export const SETTINGS_PANES: ReadonlyArray<{ id: SettingsPane; labelKey: LocaleKey; icon: GrokIconName; sections: readonly AppSettingsSection[] }> = [
  { id: "general", labelKey: "settings.section.general", icon: "settings-gear", sections: ["general", "appearance", "people"] },
  { id: "texting", labelKey: "settings.pane.texting", icon: "chat-bubbles", sections: ["texting", "companion", "remote"] },
  { id: "computer", labelKey: "settings.simple.page.computer", icon: "display", sections: ["computer", "desktopWorkspaces"] },
  { id: "permissions", labelKey: "settings.pane.permissions", icon: "shield", sections: ["permissions", "botAccess", "logins", "activity"] },
  { id: "updates", labelKey: "settings.simple.page.updates", icon: "cloud-download", sections: ["updates"] },
  { id: "advanced", labelKey: "settings.pane.advanced", icon: "sliders", sections: ["advanced", ...ADVANCED_PAGES.flatMap((page) => page.sections)] },
];

export type SettingsLocation = { pane: SettingsPane; page?: AdvancedPage };

/** Where a section lives now: its pane, and inside Advanced its page. Every old deep link lands somewhere. */
export function settingsLocation(section: AppSettingsSection): SettingsLocation {
  const page = ADVANCED_PAGES.find((entry) => entry.sections.includes(section));
  if (page) return { pane: "advanced", page: page.id };
  return { pane: SETTINGS_PANES.find((pane) => pane.sections.includes(section))?.id ?? "general" };
}

/** Open Settings at a pane, an Advanced page, or the section that holds a setting. */
export function openSettings(target: SettingsPane | AdvancedPage | AppSettingsSection = "general"): Action {
  const pane = SETTINGS_PANES.find((entry) => entry.id === target);
  const page = ADVANCED_PAGES.find((entry) => entry.id === target);
  const section = pane ? pane.sections[0]! : page ? page.sections[0]! : (target as AppSettingsSection);
  return { type: "toggleAppSettings", open: true, section };
}

const REMOTE_SECTIONS: readonly AppSettingsSection[] = ["appearance", "companion", "desktopWorkspaces", "looks", "advanced"];

export function revealSettingsBlock(
  scroller: Parameters<typeof scrollWithin>[0] & { querySelector: (selector: string) => Parameters<typeof scrollWithin>[1] | null },
  section: AppSettingsSection,
  lead: boolean,
): void {
  const block = lead ? null : scroller.querySelector(`[data-settings-block="${section}"]`);
  if (block) scrollWithin(scroller, block);
  else scroller.scrollTop = 0;
}

function useScrollThumb(scroller: React.RefObject<HTMLDivElement | null>, key: string) {
  const [thumb, setThumb] = useState<{ top: number; height: number; scrolling: boolean } | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = (scrolling: boolean) => {
      const { scrollHeight, clientHeight, scrollTop } = element;
      if (scrollHeight <= clientHeight + 1) { setThumb(null); return; }
      const track = clientHeight - 6;
      const height = Math.max(20, (clientHeight / scrollHeight) * track);
      setThumb({ top: (scrollTop / (scrollHeight - clientHeight)) * (track - height), height, scrolling });
    };
    const onScroll = () => {
      measure(true);
      clearTimeout(timer);
      timer = setTimeout(() => measure(false), 800);
    };
    measure(false);
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure(false));
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => {
      clearTimeout(timer);
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [scroller, key]);
  return thumb;
}

export function SettingsModal() {
  const { state, dispatch } = useStore();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  const ownerOrAdmin = useOwnerOrAdmin();
  const cloudHome = state.config?.cloudHome === true;

  const offered: Record<AppSettingsSection, boolean> = {
    general: true, appearance: true, texting: true, companion: true, remote: true, computer: true, logins: true, permissions: true, updates: true,
    advanced: true, apps: true, looks: true, bots: true, data: true, builder: true, about: true, engines: true, connections: true, decisionModel: true,
    skills: true, usage: true, backups: true, import: true, experimental: true,
    desktopWorkspaces: Boolean(window.ogb?.environments),
    organization: Boolean(window.ogb?.organization),
    cloudAccount: Boolean(window.ogb?.cloudAccount || (window.ogb?.cloudPlan && cloudHome)),
    workspaces: workspacesAvailable(state.config),
    people: !window.ogb && !cloudHome,
    activity: !window.ogb && ownerOrAdmin === true,
    botAccess: Boolean(state.config?.team) && ownerOrAdmin === true,
  };
  const has = (id: AppSettingsSection) => offered[id] && (!remoteActive || REMOTE_SECTIONS.includes(id));

  const paneShown = (pane: SettingsPane) => !remoteActive || pane === "general" || pane === "texting" || pane === "computer" || pane === "advanced";
  const panes = SETTINGS_PANES.filter((pane) => paneShown(pane.id) && pane.sections.some(has));
  const advancedPages = ADVANCED_PAGES.filter((page) => page.sections.some(has)).map((page) => page.id);

  const requested = state.appSettingsSection;
  const at = settingsLocation(has(requested) ? requested : remoteActive && requested === "remote" ? "companion" : "general");
  const pane = panes.some((entry) => entry.id === at.pane) ? at.pane : "general";
  const page = pane === "advanced" && at.page && advancedPages.includes(at.page) ? at.page : undefined;
  const paneEntry = SETTINGS_PANES.find((entry) => entry.id === pane)!;

  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumb = useScrollThumb(scrollRef, `${pane}:${page ?? ""}`);

  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const keyFocus = useKeyFocus();
  const disclose: Disclose = (id) => {
    const open = folds[id] ?? (id === "computer-elsewhere" && (requested === "remote" || requested === "desktopWorkspaces"));
    return { id, open, onToggle: () => setFolds((current) => ({ ...current, [id]: !open })) };
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const lead = paneEntry.sections[0] === requested || (page !== undefined && ADVANCED_PAGES.find((entry) => entry.id === page)?.sections[0] === requested);
    revealSettingsBlock(scroller, requested === "remote" ? "remote" : requested, lead && !keyFocus);
  }, [requested, pane, page, paneEntry, keyFocus]);

  const close = () => dispatch({ type: "toggleAppSettings", open: false });
  const go = (section: AppSettingsSection) => dispatch({ type: "toggleAppSettings", open: true, section });

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const nested = () => Boolean(dialog && [...dialog.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')]
      .some((child) => child !== dialog && child.getClientRects().length));
    const onKey = (event: KeyboardEvent) => {
      // a child editor or menu owns Escape and its focus trap, including while saving
      if (event.defaultPrevented || nested()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleAppSettings", open: false });
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => element.checkVisibility());
      if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  const phoneFocus = state.appSettingsPhonePairing;
  const computerPairs = currentPhonePairingTarget(cloudHome) === "computer";
  const remoteAccess: RemoteAccessCards = {
    client: <RemoteComputerSection hideWhenUnavailable />,
    domain: remoteActive ? null : <CustomDomainSettings />,
    // Security: the server decides who may pair (an owner or admin session), not this gate.
    pairing: <ServerPairingCard cloudHome={cloudHome} focusRequest={computerPairs ? 0 : phoneFocus} team={state.config?.team?.name} teamPhoneBlocked={state.config?.managedPolicy?.remoteAccess === false ? t("policy.teamRemoteBlocked", { organization: state.config.managedPolicy.organizationName }) : null} simple />,
    companion: remoteActive ? null : <CompanionSection profileEmail={state.config?.profile?.email} focusRequest={computerPairs ? phoneFocus : 0} />,
  };
  const cloudAccount = has("cloudAccount") && !remoteActive
    ? <CloudAccountSettings linkRequest={state.appSettingsCloudLink} cloudHome={cloudHome} teamHome={state.config?.team}
      onConnectPhone={() => dispatch(phonePairingSettingsAction())}
      onSignIn={() => dispatch({ type: "openCloudAdd", source: "app_settings", signIn: true })} />
    : null;

  const body = (() => {
    switch (pane) {
      case "general": return <GeneralPane has={has} remoteActive={remoteActive} peopleOpen={requested === "people"} />;
      case "texting": return <TextingPane has={has} remoteAccess={remoteAccess} />;
      case "computer": return <ComputerPane has={has} remoteAccess={remoteAccess} servers={<ConnectedWorkspacesSettings />} disclose={disclose} />;
      case "permissions": return <PermissionsPane has={has} />;
      case "updates": return <UpdatesPane remoteActive={remoteActive} />;
      case "advanced": return page
        ? <AdvancedPageView page={page} has={has} remoteActive={remoteActive} disclose={disclose} connections={<AdminOnly><KeysPage /></AdminOnly>} cloudAccount={cloudAccount} />
        : <AdvancedIndex pages={advancedPages} onOpen={(next) => go(ADVANCED_PAGES.find((entry) => entry.id === next)!.sections[0]!)} />;
    }
  })();

  const title = page ? advancedTitle(page) : t(paneEntry.labelKey);
  const headingId = `settings-panel-${pane}-heading`;

  return (
    <div className="settings-scrim" data-settings-sheet data-settings-look="simple" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("settings.title")} tabIndex={-1} className="settings-dialog">
        <div className="settings-layout">
          <nav aria-label={t("settings.grok.navAria")} className="settings-nav">
            {panes.map((entry) => {
              const current = entry.id === pane;
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-settings-page={entry.id}
                  aria-current={current ? "page" : undefined}
                  aria-controls={current ? `settings-panel-${entry.id}` : undefined}
                  onClick={() => go(entry.sections[0]!)}
                  className="settings-nav-item"
                >
                  <GrokIcon name={entry.icon} size={15} />
                  <span>{t(entry.labelKey)}</span>
                </button>
              );
            })}
          </nav>
          <section id={`settings-panel-${pane}`} aria-labelledby={headingId} className="settings-panel">
            <button type="button" onClick={close} aria-label={t("settings.grok.close")} title={`${t("settings.grok.close")} (${shortcutLabel("close-panel")})`} className="settings-close">
              <GrokIcon name="close" size={14} />
            </button>
            <header className="settings-pane-header">
              <div className="flex min-w-0 items-center gap-1.5">
                {page && <BackButton onBack={() => go("advanced")} />}
                <h2 id={headingId} className={cn("settings-pane-title truncate", page && "ps-0")}>{title}</h2>
              </div>
              <div className="w-full sm:hidden">
                <SettingsSelect
                  value={pane}
                  aria-label={t("settings.pane.picker")}
                  options={panes.map((entry) => ({ value: entry.id, label: t(entry.labelKey) }))}
                  onChange={(event) => { const next = panes.find((entry) => entry.id === event.target.value); if (next) go(next.sections[0]!); }}
                />
              </div>
            </header>
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div ref={scrollRef} data-settings-scroll className="settings-scroll">
                <div className={cn("settings-pane", SIMPLE_BUTTONS, "[&_.uppercase]:normal-case [&_.uppercase]:tracking-normal")}>
                  <LicenseExpiryBanner config={state.config} />
                  {body}
                </div>
              </div>
              {thumb && (
                <div role="presentation" className="settings-scrollbar" data-scrolling={thumb.scrolling ? "" : undefined}>
                  <div style={{ top: thumb.top, height: thumb.height }} />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
