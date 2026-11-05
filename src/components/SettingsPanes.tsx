import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useStore, type AppSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import { FEEDBACK_URL, HELP_CENTER_URL, appVersion, openExternalLink } from "@/lib/app-links";
import { useCopyFeedback } from "@/lib/copy-text";
import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useCloudFilesReady } from "@/lib/cloud-files";
import { setColorUserBubbles, useColorUserBubbles } from "@/lib/user-bubble-preference";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import { productName } from "../lib/brand";
import { AccountsSheet, useAccounts } from "./AccountMenu";
import { AboutDialog } from "./AboutDialog";
import { AdminOnly } from "./AdminOnly";
import { AnalyticsRow } from "./AnalyticsRow";
import { ActivitySection } from "./ActivitySection";
import { ArchivedBotsPanel } from "./ArchivedBotsPanel";
import { AttachmentStorageSettings } from "./AttachmentStorageSettings";
import { AutomaticRecoverySettings } from "./AutomaticRecoverySettings";
import { AccessOverview } from "./bot-access/AccessOverview";
import { BuiltInBrowserRow, ServerSitesRow } from "./BrowserSettingsRows";
import { ChatWidthRow, FontRow, SidebarToolsLayoutRow } from "./AppearanceSelectRows";
import { ChromeRailRow } from "./ChromeRailToggle";
import { CloudPlanFootnote, CloudPlanRow, useCloudPlan } from "./ProIntroduction";
import { CloudUsageDetails, CloudUsageSummaryView, useCloudUsageSettings } from "./CloudUsageMeter";
import { CompanyBackupSettings } from "./CompanyBackupSettings";
import { DecisionModelSettings } from "./DecisionModelSettings";
import { DefaultBotSidebarRow } from "./DefaultBotControls";
import { DefaultBotSettings } from "./NewBotDialog";
import { DiagnosticsRow } from "./DiagnosticsRow";
import { EnginesSettings } from "./EnginesSettings";
import { GrokIcon, type GrokIconName } from "./GrokIcon";
import { ImportSettings } from "./ImportSettings";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { LocalComputerSection } from "./LocalComputerSection";
import { LoginsSettings } from "./LoginsSettings";
import { McpCallTimeoutSettings } from "./McpCallTimeoutSettings";
import { McpServersPanel } from "./McpServersPanel";
import { NotificationRows } from "./NotificationSettingsRows";
import { OpenAtLoginRow } from "./OpenAtLoginRow";
import { OrganizationSettings } from "./OrganizationSettings";
import { PeopleSection } from "./PeopleSection";
import { PhoneAppDialog } from "./PhoneAppDialog";
import { PinnedPanelsSettings } from "./PinnedPanelsSettings";
import { PlaceLookRows } from "./PlaceLookCard";
import { PlanUsageSummary } from "./PlanUsage";
import { ProfileFields } from "./ProfileSettings";
import { RoomTurnTimeoutSettings } from "./RoomTurnTimeoutSettings";
import { SavedStepsRow } from "./SavedStepsRow";
import { Card, SettingRow, SettingsDisclosureRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";
import { profileInitials, useServerUpdateItem } from "./SidebarProfileMenu";
import { SkillsSection } from "./SkillsSection";
import { SkinPicker } from "./SkinPicker";
import { TalkShortcutRow } from "./TalkShortcutRow";
import { ThemeRow } from "./ThemeRow";
import { ThreadCleanupSettings } from "./ThreadCleanupSettings";
import { ThreadConcurrencySettings } from "./ThreadConcurrencySettings";
import { UpdatesConsentRow } from "./UpdatesConsent";
import { UsageSection } from "./UsageSection";
import { WindowFrameRow } from "./WindowFrameRow";
import { WorkspaceBackupSettings } from "./WorkspaceBackupSettings";
import { WorkspacesSection } from "./WorkspacesSection";
import { UsageMeterCard } from "./native/UsageMeter";
import { reportsUsage, useEngineLimits } from "@/lib/limit-resets";
import { openInbox } from "@/state/inbox";
import {
  AdvancedModeRow, BrowserProfilesRow, ExperimentalFeaturesRow, FollowUpRow, LanguageRow, NewBotEffortRow, PinnedCirclesRow,
  ReplayTourRow, RunCardRow, SendKeyRow, ShowThreadsRow, ToolCallsRow, UniversalPinsRow, UpdatesRow,
} from "./AppSettingsRows";

export type Has = (id: AppSettingsSection) => boolean;
export type RemoteAccessCards = Record<"client" | "domain" | "pairing" | "companion", ReactNode>;
export type Disclose = (id: string) => { id: string; open: boolean; onToggle: () => void };

/** Grok's account block: the 44px initial, the name over the address and its copy button, the pills on the right. */
export function AccountRow() {
  const { state } = useStore();
  const accounts = useAccounts();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const fieldsId = useId();
  const fields = useRef<HTMLDivElement>(null);
  const profile = state.config?.profile;
  const active = accounts.view?.active ?? null;
  const name = profile?.name?.trim() || active?.email?.split("@")[0] || "";
  const email = active?.email ?? profile?.email?.trim() ?? "";
  const { state: copied, copy } = useCopyFeedback(email);
  const initial = profileInitials(profile ?? { email }).slice(0, 1);
  useEffect(() => {
    if (editing) fields.current?.querySelector<HTMLInputElement>("input:not([type=file])")?.focus();
  }, [editing]);
  const pill = "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-ink/[0.06] px-3 py-1.5 text-[14px] leading-5 tracking-[0.01em] text-ink shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-ink)_6%,transparent)] transition-[background-color,color] duration-[120ms] ease-[ease-out] hover:bg-ink/10 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";
  return (
    <div data-settings-account="" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3.5 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 basis-auto items-center gap-3.5">
          <span aria-hidden="true" className="inline-flex size-11 shrink-0 select-none items-center justify-center overflow-hidden rounded-full border-[0.5px] border-ink/[0.06] bg-ink/[0.04] text-[17px] font-medium text-ink-secondary">
            {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" className="size-full object-cover" /> : initial !== "?" ? initial : <GrokIcon name="person" size={20} />}
          </span>
          <div className="flex min-w-24 flex-1 basis-0 flex-col">
            <span className="truncate text-[13px] font-medium leading-[18px] tracking-[0.015em] text-ink">{name || t("settings.simple.account.noName")}</span>
            {email && (
              <span className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">
                <span className="min-w-0 truncate"><bdi>{email}</bdi></span>
                <button
                  type="button"
                  onClick={copy}
                  aria-label={copied === "copied" ? t("settings.grok.account.copied") : t("settings.grok.account.copyEmail")}
                  className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-secondary hover:bg-ink/[0.06] hover:text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                >
                  <GrokIcon name={copied === "copied" ? "check" : "copy"} size={14} />
                </button>
              </span>
            )}
          </div>
        </div>
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
          {!active && (
            <button type="button" aria-expanded={editing} aria-controls={fieldsId} className={pill} onClick={() => setEditing(!editing)}>
              {editing ? t("common.done") : t(name || email ? "settings.simple.account.edit" : "settings.grok.account.add")}
            </button>
          )}
          {window.ogb?.accounts && active && accounts.noRail && (
            <button type="button" className={pill} onClick={() => setAdding(true)}>{t("settings.grok.account.add")}</button>
          )}
          {active && <button type="button" className={pill} onClick={() => accounts.signOut(active.id)}>{t("settings.grok.account.signOut")}</button>}
          {accounts.openSheet && <button type="button" className={pill} onClick={accounts.openSheet}>{t("settings.simple.account.manage")}</button>}
        </div>
      </div>
      <div id={fieldsId} ref={fields} hidden={!editing} className="px-4 pb-3.5">
        {editing && <ProfileFields />}
      </div>
      {(adding || accounts.sheet) && (
        <AccountsSheet
          adding={adding ? "" : accounts.sheet?.email ?? null}
          note={adding ? null : accounts.sheet?.note ?? null}
          onClose={() => { setAdding(false); accounts.closeSheet(); }}
        />
      )}
    </div>
  );
}

/** Grok's Accent select. Here it decides whether your messages wear the bot's colour. */
export function AccentRow() {
  const bot = useColorUserBubbles();
  return (
    <SettingRow title={t("settings.accent.title")}>
      <SettingsSelect
        value={bot ? "bot" : "neutral"}
        aria-label={t("settings.accent.title")}
        options={[{ value: "bot", label: t("settings.accent.bot") }, { value: "neutral", label: t("settings.accent.neutral") }]}
        onChange={(event) => setColorUserBubbles(event.target.value === "bot")}
      />
    </SettingRow>
  );
}

export function GeneralPane({ has, remoteActive }: { has: Has; remoteActive: boolean }) {
  return (
    <>
      {!remoteActive && has("general") && (
        <SettingsGroup label={t("settings.group.account")} block="general">
          <SettingsRows>
            <AccountRow />
            <CloudPlanRow place="account" />
          </SettingsRows>
        </SettingsGroup>
      )}
      <SettingsGroup label={t("settings.section.appearance")} block="appearance">
        <SettingsRows>
          <ThemeRow simple />
          <AccentRow />
          <LanguageRow simple />
        </SettingsRows>
      </SettingsGroup>
      {!remoteActive && (
        <SettingsGroup label={t("settings.simple.group.system")} block="system">
          <SettingsRows>
            <TalkShortcutRow />
            <SendKeyRow simple />
            <OpenAtLoginRow simple />
          </SettingsRows>
        </SettingsGroup>
      )}
      <SettingsGroup label={t("notifications.title")} block="notifications">
        <SettingsRows><NotificationRows simple /></SettingsRows>
      </SettingsGroup>
    </>
  );
}

export function TextingPane({ has, remoteAccess }: { has: Has; remoteAccess: RemoteAccessCards }) {
  const [phoneApp, setPhoneApp] = useState(false);
  return (
    <>
      {has("companion") && (
        <SettingsGroup label={t("settings.grok.group.phone")} block="companion">
          {remoteAccess.pairing}
          {remoteAccess.companion}
        </SettingsGroup>
      )}
      <SettingsGroup block="phone-app">
        <SettingsRows>
          <SettingRow title={t("settings.texting.phoneApp.title")} subtitle={t("settings.texting.phoneApp.subtitle")}>
            <button type="button" className="ui-button" onClick={() => setPhoneApp(true)}>{t("settings.texting.phoneApp.action")}</button>
          </SettingRow>
        </SettingsRows>
      </SettingsGroup>
      <PhoneAppDialog open={phoneApp} onClose={() => setPhoneApp(false)} />
    </>
  );
}

export function ComputerPane({ has, remoteAccess, servers, disclose }: { has: Has; remoteAccess: RemoteAccessCards; servers: ReactNode; disclose: Disclose }) {
  return (
    <>
      {has("computer") && <SettingsGroup label={t("settings.grok.group.yourComputer")} block="computer"><AdminOnly><LocalComputerSection /></AdminOnly></SettingsGroup>}
      {has("computer") && (
        <SettingsGroup label={t("settings.grok.group.browser")} block="browser">
          <SettingsRows><BuiltInBrowserRow /><ServerSitesRow /></SettingsRows>
          <BrowserProfilesRow />
        </SettingsGroup>
      )}
      {(has("companion") || has("desktopWorkspaces")) && (
        <SettingsDisclosureRow title={t("settings.simple.computer.elsewhere")} block="remote" {...disclose("computer-elsewhere")}>
          {has("companion") && <div className="flex scroll-mt-4 flex-col gap-4 empty:hidden">{remoteAccess.client}{remoteAccess.domain}</div>}
          {has("desktopWorkspaces") && <div data-settings-block="desktopWorkspaces" className="flex scroll-mt-4 flex-col gap-4">{servers}</div>}
        </SettingsDisclosureRow>
      )}
    </>
  );
}

export function PermissionsPane({ has }: { has: Has }) {
  return (
    <>
      {has("botAccess") && <SettingsGroup label={t("settings.section.botAccess")} block="botAccess"><AccessOverview /></SettingsGroup>}
      {has("logins") && <SettingsGroup label={t("settings.section.logins")} block="logins"><LoginsSettings /></SettingsGroup>}
      {has("activity") && <SettingsGroup label={t("settings.section.activity")} block="activity"><ActivitySection /></SettingsGroup>}
      {!has("botAccess") && !has("logins") && !has("activity") && (
        <SettingsGroup block="permissions">
          <SettingsRows>
            <SettingRow title={t("settings.permissions.empty.title")} subtitle={t("settings.permissions.empty.subtitle")}>{null}</SettingRow>
          </SettingsRows>
        </SettingsGroup>
      )}
    </>
  );
}

const versionTitle = () => `${productName()} ${appVersion()}`;

function ServerUpdatesRow() {
  const entry = useServerUpdateItem(true);
  if (!entry) return null;
  const status = entry.phase === "idle" ? undefined : [entry.label, entry.item.subtitle].filter(Boolean).join(" ");
  const action = entry.phase === "available" ? t("settings.simple.updates.seeRelease")
    : entry.phase === "reload" ? t("settings.simple.updates.reload")
      : entry.phase === "checking" ? t("common.checking") : t("settings.updates.check");
  return (
    <SettingRow title={versionTitle()} subtitle={status}>
      <button type="button" className="ui-button" disabled={entry.item.disabled} onClick={entry.item.onSelect}>{action}</button>
    </SettingRow>
  );
}

export function UpdatesPane({ remoteActive }: { remoteActive: boolean }) {
  return (
    <SettingsGroup label={t("settings.grok.group.version")} block="updates">
      <SettingsRows>
        {window.ogb?.updater ? <UpdatesRow title={versionTitle()} /> : <ServerUpdatesRow />}
        <UpdatesConsentRow />
        {!remoteActive && <ReplayTourRow />}
        <DiagnosticsRow simple />
      </SettingsRows>
    </SettingsGroup>
  );
}

export type AdvancedPage = "apps" | "bots" | "looks" | "team" | "data" | "builder" | "about";

export const ADVANCED_PAGES: ReadonlyArray<{ id: AdvancedPage; group: "bots" | "workspace" | "app"; icon: GrokIconName; sections: AppSettingsSection[] }> = [
  { id: "apps", group: "bots", icon: "plug", sections: ["apps", "skills"] },
  { id: "bots", group: "bots", icon: "robot", sections: ["bots"] },
  { id: "team", group: "workspace", icon: "building", sections: ["organization", "people", "workspaces"] },
  { id: "data", group: "workspace", icon: "database", sections: ["data", "backups", "import"] },
  { id: "looks", group: "app", icon: "palette", sections: ["looks"] },
  { id: "builder", group: "app", icon: "sliders", sections: ["builder", "experimental"] },
  { id: "about", group: "app", icon: "info", sections: ["about"] },
];

const ADVANCED_GROUPS: ReadonlyArray<{ id: "bots" | "workspace" | "app"; labelKey: LocaleKey }> = [
  { id: "bots", labelKey: "settings.advanced.group.bots" },
  { id: "workspace", labelKey: "settings.advanced.group.workspace" },
  { id: "app", labelKey: "settings.advanced.group.app" },
];

export const advancedTitle = (page: AdvancedPage) => t(`settings.advanced.${page}.title` as LocaleKey);

function DrillRow({ page, onOpen }: { page: (typeof ADVANCED_PAGES)[number]; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-settings-advanced={page.id}
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-start transition-colors duration-[120ms] ease-[ease] hover:bg-ink/[0.04] outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
    >
      <GrokIcon name={page.icon} size={15} className="shrink-0 text-ink-secondary" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink">{advancedTitle(page.id)}</span>
        <span className="-mt-0.5 text-[13px] leading-[18px] tracking-[-0.08px] text-ink-secondary">{t(`settings.advanced.${page.id}.subtitle` as LocaleKey)}</span>
      </span>
      <GrokIcon name="chevron-right" size={12} className="shrink-0 text-ink-secondary rtl:-scale-x-100" />
    </button>
  );
}

export function AdvancedIndex({ pages, onOpen }: { pages: readonly AdvancedPage[]; onOpen: (page: AdvancedPage) => void }) {
  return (
    <>
      {ADVANCED_GROUPS.map((group) => {
        const entries = ADVANCED_PAGES.filter((page) => page.group === group.id && pages.includes(page.id));
        if (!entries.length) return null;
        return (
          <SettingsGroup key={group.id} label={t(group.labelKey)} block={`advanced-${group.id}`}>
            <SettingsRows>{entries.map((page) => <DrillRow key={page.id} page={page} onOpen={() => onOpen(page.id)} />)}</SettingsRows>
          </SettingsGroup>
        );
      })}
    </>
  );
}

function OpenRow({ title, subtitle, action, onOpen, ...rest }: { title: string; subtitle?: ReactNode; action?: string; onOpen: () => void; "data-settings-open"?: string }) {
  return (
    <SettingRow title={title} subtitle={subtitle}>
      <button type="button" {...rest} className="ui-button" onClick={onOpen}>{action ?? t("settings.advanced.open")}</button>
    </SettingRow>
  );
}

function AppsPage({ has }: { has: Has }) {
  const { state, dispatch } = useStore();
  return (
    <>
      <SettingsGroup label={t("settings.advanced.apps.title")} block="apps">
        <SettingsRows>
          <OpenRow data-settings-open="apps" title={t("settings.advanced.apps.connected.title")} subtitle={t("settings.advanced.apps.connected.subtitle")}
            onOpen={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })} />
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup label={t("settings.advanced.apps.mcp")} block="mcp">
        <AdminOnly><div className="flex flex-col gap-3"><McpServersPanel embedded /></div></AdminOnly>
      </SettingsGroup>
      {has("skills") && skillsLibraryEnabled(state.config) && <SettingsGroup label={t("settings.section.skills")} block="skills"><SkillsSection /></SettingsGroup>}
    </>
  );
}

function BotsPage({ remoteActive }: { remoteActive: boolean }) {
  const { state, dispatch } = useStore();
  const files = useCloudFilesReady();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archived = state.bots.filter((bot) => bot.hidden && !bot.movedTo);
  const go = (action: Parameters<typeof dispatch>[0]) => { dispatch({ type: "toggleAppSettings", open: false }); dispatch(action); };
  return (
    <>
      <SettingsGroup label={t("settings.advanced.bots.title")} block="bots">
        <SettingsRows>
          <OpenRow data-settings-open="inbox" title={t("settings.advanced.bots.inbox")} subtitle={t("settings.advanced.bots.inboxSubtitle")} onOpen={() => { dispatch({ type: "toggleAppSettings", open: false }); openInbox(); }} />
          <OpenRow data-settings-open="automations" title={t("settings.advanced.bots.automations")} subtitle={t("settings.advanced.bots.automationsSubtitle")} onOpen={() => go({ type: "showRoutines", view: "list" })} />
          <OpenRow data-settings-open="team-map" title={t("settings.advanced.bots.teamMap")} subtitle={t("settings.advanced.bots.teamMapSubtitle")} onOpen={() => go({ type: "showTeamMap" })} />
          {files && <OpenRow data-settings-open="files" title={t("settings.advanced.bots.files")} subtitle={t("settings.advanced.bots.filesSubtitle")} onOpen={() => go({ type: "showFiles" })} />}
          {!remoteActive && (
            <SettingRow title={t("settings.advanced.bots.archived")} subtitle={archived.length ? t("settings.advanced.bots.archivedSubtitle", { count: archived.length }) : t("settings.advanced.bots.archivedNone")}>
              <button type="button" data-settings-open="archived" className="ui-button" disabled={!archived.length} onClick={() => setArchivedOpen(true)}>{t("settings.advanced.open")}</button>
            </SettingRow>
          )}
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup label={t("settings.profile.title")} block="profile">
        <Card subtitle={t("settings.profile.sharedSubtitle")}><ProfileFields /></Card>
      </SettingsGroup>
      <SettingsGroup label={t("settings.advanced.bots.defaults")} block="bot-defaults">
        <SettingsRows>
          <DefaultBotSidebarRow simple />
          <FollowUpRow simple />
        </SettingsRows>
        <NewBotEffortRow />
        <DefaultBotSettings />
      </SettingsGroup>
      {archivedOpen && <ArchivedBotsPanel bots={archived} onClose={() => setArchivedOpen(false)} onRestored={() => {}} />}
    </>
  );
}

function LooksPage({ remoteActive }: { remoteActive: boolean }) {
  return (
    <>
      <SettingsGroup label={t("settings.skin.title")} block="looks"><SkinPicker /></SettingsGroup>
      <SettingsGroup label={t("settings.section.appearance")} block="appearance-more">
        <SettingsRows>
          <PlaceLookRows />
          <WindowFrameRow />
          <FontRow />
          <ChatWidthRow />
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup label={t("settings.grok.group.sidebar")} block="sidebar">
        <SettingsRows>
          <SidebarToolsLayoutRow />
          <ChromeRailRow />
          <ShowThreadsRow />
          <PinnedCirclesRow />
          <UniversalPinsRow />
          {!remoteActive && <ToolCallsRow />}
          <RunCardRow />
        </SettingsRows>
      </SettingsGroup>
    </>
  );
}

/** Grok's Usage & Billing pane: a card per engine limit, the Cloud's meters, the breakdown behind a disclosure, then the plan. */
export function UsagePane({ has, disclose, cloudAccount }: { has: Has; disclose: Disclose; cloudAccount: ReactNode }) {
  const { usage, upgrade, dialog } = useCloudUsageSettings();
  const plan = useCloudPlan();
  const signedOut = plan?.view.kind === "signed-out" || plan?.view.kind === "removed";
  const limits = useEngineLimits().filter(reportsUsage);
  return (
    <>
      {limits.length ? (
        <SettingsGroup block="usage" footnote={t("settings.usage.footnote")}>
          <div data-usage-cards="" className="flex flex-col gap-3">{limits.map((limit) => <UsageMeterCard key={limit.engine} limit={limit} />)}</div>
        </SettingsGroup>
      ) : !usage && (
        <SettingsGroup block="usage">
          <SettingsRows>
            <SettingRow title={t("settings.usage.empty.title")} subtitle={t("settings.usage.empty.subtitle")}>{null}</SettingRow>
          </SettingsRows>
        </SettingsGroup>
      )}
      {usage && <div data-settings-block="cloudUsage" className="scroll-mt-4"><CloudUsageSummaryView usage={usage} upgrade={upgrade}>{dialog}</CloudUsageSummaryView></div>}
      {(usage || has("usage")) && (
        <SettingsDisclosureRow title={t("settings.usage.breakdown")} {...disclose("billing-limits")}>
          {!usage && <AdminOnly note="settings.adminOnly.usage"><PlanUsageSummary /></AdminOnly>}
          {usage && <CloudUsageDetails usage={usage} upgrade={upgrade} />}
          {has("usage") && <AdminOnly note="settings.adminOnly.usage"><UsageSection /></AdminOnly>}
        </SettingsDisclosureRow>
      )}
      {has("cloudAccount") && (
        <SettingsGroup label={t("settings.simple.billing.plan")} block="cloudAccount" footnote={<CloudPlanFootnote />}>
          <SettingsRows><CloudPlanRow place="plan" usage={usage} upgrade={upgrade} /></SettingsRows>
          {signedOut ? null : <div className="flex flex-col gap-4">{cloudAccount}</div>}
        </SettingsGroup>
      )}
    </>
  );
}

function TeamPage({ has, peopleOpen }: { has: Has; peopleOpen: boolean }) {
  return (
    <>
      {has("organization") && <SettingsGroup label={t("settings.section.organization")} block="organization"><OrganizationSettings /></SettingsGroup>}
      {has("people") && <SettingsGroup block="people"><SettingsRows><PeopleSection simple startOpen={peopleOpen} /></SettingsRows></SettingsGroup>}
      {has("workspaces") && <SettingsGroup label={t("settings.section.workspaces")} block="workspaces"><WorkspacesSection /></SettingsGroup>}
    </>
  );
}

function DataPage({ has }: { has: Has }) {
  return (
    <>
      <SettingsGroup label={t("settings.advanced.data.title")} block="data">
        <SettingsRows>
          <AnalyticsRow simple />
          <AttachmentStorageSettings />
        </SettingsRows>
        <ThreadCleanupSettings />
      </SettingsGroup>
      {has("backups") && <SettingsGroup label={t("settings.section.backups")} block="backups"><AdminOnly><WorkspaceBackupSettings /><CompanyBackupSettings /></AdminOnly></SettingsGroup>}
      {has("import") && <SettingsGroup label={t("settings.section.import")} block="import"><AdminOnly><ImportSettings /></AdminOnly></SettingsGroup>}
    </>
  );
}

function BuilderPage() {
  const advanced = useAdvancedMode();
  return (
    <SettingsGroup label={t("settings.advanced.builder.title")} block="builder">
      {advanced && <SettingsRows><AdvancedModeRow simple /></SettingsRows>}
      <SettingsRows><SavedStepsRow /></SettingsRows>
      <Card title={t("settings.roomTurns.title")} subtitle={t("settings.roomTurns.subtitle")}><RoomTurnTimeoutSettings /></Card>
      <Card title={t("settings.mcpCalls.title")} subtitle={t("settings.mcpCalls.subtitle")}><McpCallTimeoutSettings /></Card>
      <ThreadConcurrencySettings />
      <AutomaticRecoverySettings />
      <PinnedPanelsSettings />
      <ExperimentalFeaturesRow />
    </SettingsGroup>
  );
}

function AboutPage() {
  const [about, setAbout] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <>
      <SettingsGroup label={t("settings.advanced.about.title")} block="about">
        <SettingsRows>
          <OpenRow data-settings-open="about" title={t("settings.advanced.about.about")} subtitle={versionTitle()} onOpen={() => setAbout(true)} />
          <OpenRow data-settings-open="shortcuts" title={t("settings.advanced.about.shortcuts")} subtitle={t("settings.advanced.about.shortcutsSubtitle")} action={t("settings.advanced.about.view")} onOpen={() => setShortcuts(true)} />
          <OpenRow data-settings-open="help" title={t("settings.advanced.about.help")} subtitle={t("settings.advanced.about.helpSubtitle")} onOpen={() => void openExternalLink(HELP_CENTER_URL)} />
          <OpenRow data-settings-open="feedback" title={t("settings.advanced.about.feedback")} subtitle={t("settings.advanced.about.feedbackSubtitle")} onOpen={() => void openExternalLink(FEEDBACK_URL)} />
        </SettingsRows>
      </SettingsGroup>
      <AboutDialog open={about} onClose={() => setAbout(false)} />
      <KeyboardShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
    </>
  );
}

/** Model providers and their sign-ins, API keys and the decision model: what every bot's model picker draws from. */
export function ModelsPane({ has, disclose, connections }: { has: Has; disclose: Disclose; connections: ReactNode }) {
  return (
    <>
      {has("engines") && <div data-settings-block="engines" className="flex scroll-mt-4 flex-col gap-7"><AdminOnly><EnginesSettings simple more={disclose("ai-more")} /></AdminOnly></div>}
      {has("connections") && <SettingsGroup label={t("settings.section.connections")} block="connections"><AdminOnly>{connections}</AdminOnly></SettingsGroup>}
      {has("decisionModel") && <SettingsGroup label={t("settings.section.decisionModel")} block="decisionModel"><AdminOnly><DecisionModelSettings /></AdminOnly></SettingsGroup>}
    </>
  );
}

export function AdvancedPageView({ page, has, remoteActive, peopleOpen }: {
  page: AdvancedPage;
  has: Has;
  remoteActive: boolean;
  peopleOpen: boolean;
}) {
  switch (page) {
    case "apps": return <AppsPage has={has} />;
    case "bots": return <BotsPage remoteActive={remoteActive} />;
    case "looks": return <LooksPage remoteActive={remoteActive} />;
    case "team": return <TeamPage has={has} peopleOpen={peopleOpen} />;
    case "data": return <DataPage has={has} />;
    case "builder": return <BuilderPage />;
    case "about": return <AboutPage />;
  }
}

export function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      data-settings-back=""
      onClick={onBack}
      aria-label={t("settings.advanced.back")}
      title={t("settings.advanced.back")}
      className={cn(
        "-ms-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink/[0.56] transition-colors duration-150 ease-[ease] hover:bg-ink/[0.06] hover:text-ink-secondary",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
      )}
    >
      <GrokIcon name="chevron-left" size={14} className="rtl:-scale-x-100" />
    </button>
  );
}
