import { useState, type ReactNode } from "react";
import { useStore, type AppSettingsSection } from "@/state/store";
import { ADVANCED_PAGES, type AdvancedPage } from "@/lib/open-settings";
import { t } from "@/lib/i18n";
import { FEEDBACK_URL, HELP_CENTER_URL, appVersion, openExternalLink } from "@/lib/app-links";
import { builtInBrowserEnabled, skillsLibraryEnabled } from "@/lib/feature-flags";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useCloudFilesReady } from "@/lib/cloud-files";
import { setColorUserBubbles, useColorUserBubbles } from "@/lib/user-bubble-preference";
import { SKINS, applySkin, resolveSkin } from "@/lib/skins";
import { setDressUp, useDressUp } from "@/lib/halloween-dress";
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
import { ChatWidthRow, FontRow } from "./AppearanceSelectRows";
import { ChromeRailRow } from "./ChromeRailToggle";
import { CloudPlanFootnote, CloudPlanRow, useCloudPlan } from "./ProIntroduction";
import { CloudUsageDetails, CloudUsageSummaryView, useCloudUsageSettings } from "./CloudUsageMeter";
import { CompanyBackupSettings } from "./CompanyBackupSettings";
import { DecisionModelSettings } from "./DecisionModelSettings";
import { DefaultBotSidebarRow } from "./DefaultBotControls";
import { DefaultBotSettings } from "./NewBotDialog";
import { DiagnosticsRow } from "./DiagnosticsRow";
import { EnginesSettings } from "./EnginesSettings";
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
import { PlaceLookRows } from "./PlaceLookCard";
import { PlanUsageSummary } from "./PlanUsage";
import { ProfileFields } from "./ProfileSettings";
import { RoomTurnTimeoutSettings } from "./RoomTurnTimeoutSettings";
import { SavedStepsRow } from "./SavedStepsRow";
import { SettingRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { Card as RowsCard, FormDialog, NavRow, SelectRow, SwitchRow, useSubPage } from "./ListRows";
import { SettingsSelect } from "./SettingsSelect";
import { useServerUpdateItem } from "./SidebarProfileMenu";
import { SkillsSection } from "./SkillsSection";
import { BrowserProfilesManager } from "./BrowserProfilesManager";
import { TalkShortcutRow } from "./TalkShortcutRow";
import { ThemeRow, useSkinChoice } from "./ThemeRow";
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
  AdvancedModeRow, ExperimentalFeaturesRow, FollowUpRow, LanguageRow, NewBotEffortRow, PinnedCirclesRow,
  ReplayTourRows, SendKeyRow, ToolCallsRow, UniversalPinsRow, UpdatesRow,
} from "./AppSettingsRows";

export type Has = (id: AppSettingsSection) => boolean;
export type RemoteAccessCards = Record<"client" | "domain" | "pairing" | "companion", ReactNode>;
export type Disclose = (id: string) => { id: string; open: boolean; onToggle: () => void };

/** The pages a pane's rows open, by the section a deep link names: a link to one lands on that page. */
export const SECTION_PAGES: Partial<Record<AppSettingsSection, { id: string; title: LocaleKey }>> = {
  import: { id: "import", title: "settings.import.grokTitle" },
  companion: { id: "pairing", title: "settings.w6.pairing.title" },
  remote: { id: "elsewhere", title: "settings.simple.computer.elsewhere" },
  desktopWorkspaces: { id: "elsewhere", title: "settings.simple.computer.elsewhere" },
  botAccess: { id: "botAccess", title: "settings.section.botAccess" },
  activity: { id: "activity", title: "settings.section.activity" },
  connections: { id: "keys", title: "settings.section.connections" },
  decisionModel: { id: "decision", title: "settings.section.decisionModel" },
  cloudAccount: { id: "plan", title: "settings.section.cloudAccount" },
  skills: { id: "skills", title: "settings.section.skills" },
  organization: { id: "organization", title: "settings.section.organization" },
  people: { id: "people", title: "settings.section.people" },
  workspaces: { id: "workspaces", title: "settings.section.workspaces" },
  backups: { id: "backups", title: "settings.section.backups" },
  experimental: { id: "experimental", title: "settings.experimental.title" },
};

/** A row that opens one of its pane's pages. */
function PageRow({ page, title, value, hint, ...rest }: { page: string; title: string; value?: ReactNode; hint?: ReactNode; "data-settings-open"?: string }) {
  const sub = useSubPage();
  return <NavRow {...rest} data-panel-page={page} title={title} value={value} hint={hint} onClick={() => sub.open(page, title)} />;
}

/** The person: their name and photo in a small form, the account they are signed in with, signing out. */
export function AccountRows() {
  const { state } = useStore();
  const accounts = useAccounts();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const profile = state.config?.profile;
  const active = accounts.view?.active ?? null;
  const name = profile?.name?.trim() || active?.email?.split("@")[0] || "";
  const email = active?.email ?? profile?.email?.trim() ?? "";
  return (
    <>
      <NavRow data-settings-open="profile" title={t("settings.profile.name")} value={name || t("settings.simple.account.noName")} onClick={() => setEditing(true)} />
      {active ? (
        <>
          <NavRow data-settings-open="account" title={t("settings.rows.account")} value={email} drill={Boolean(accounts.openSheet)}
            onClick={() => (accounts.openSheet ? accounts.openSheet() : undefined)} />
          {window.ogb?.accounts && accounts.noRail && <NavRow title={t("settings.grok.account.add")} onClick={() => setAdding(true)} />}
          <NavRow data-settings-open="sign-out" drill={false} title={t("settings.grok.account.signOut")} onClick={() => accounts.signOut(active.id)} />
        </>
      ) : email ? <NavRow title={t("settings.rows.email")} value={email} onClick={() => setEditing(true)} /> : null}
      {editing && (
        <FormDialog data-panel-modal="profile" title={t("settings.w6.group.aboutYou")} width={460} onClose={() => setEditing(false)}>
          <div data-settings-look="simple" className="-mx-2 flex flex-col"><ProfileFields /></div>
        </FormDialog>
      )}
      {(adding || accounts.sheet) && (
        <AccountsSheet
          adding={adding ? "" : accounts.sheet?.email ?? null}
          note={adding ? null : accounts.sheet?.note ?? null}
          onClose={() => { setAdding(false); accounts.closeSheet(); }}
        />
      )}
    </>
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
  const { at } = useSubPage();
  if (at === "import") return <AdminOnly><ImportSettings /></AdminOnly>;
  return (
    <>
      {!remoteActive && has("general") && (
        <SettingsGroup label={t("settings.group.account")} block="general">
          <SettingsRows>
            <AccountRows />
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
      {has("import") && (
        <RowsCard label={t("settings.section.import")} data-settings-block="import">
          <PageRow page="import" title={t("settings.import.grokTitle")} />
        </RowsCard>
      )}
    </>
  );
}

export function TextingPane({ has, remoteAccess }: { has: Has; remoteAccess: RemoteAccessCards }) {
  const { at } = useSubPage();
  const [phoneApp, setPhoneApp] = useState(false);
  if (at === "pairing") return <div data-settings-block="companion" className="flex flex-col gap-[22px]">{remoteAccess.pairing}{remoteAccess.companion}</div>;
  return (
    <>
      <RowsCard data-settings-block="phone-app">
        {has("companion") && <PageRow page="pairing" title={t("settings.w6.pairing.title")} />}
        <NavRow data-settings-open="phone-app" title={t("settings.texting.phoneApp.title")} onClick={() => setPhoneApp(true)} />
      </RowsCard>
      <PhoneAppDialog open={phoneApp} onClose={() => setPhoneApp(false)} />
    </>
  );
}

export function ComputerPane({ has, remoteAccess, servers }: { has: Has; remoteAccess: RemoteAccessCards; servers: ReactNode }) {
  const { at } = useSubPage();
  const { state } = useStore();
  if (at === "computers") return <div data-settings-block="computer" className="flex flex-col gap-[22px]"><AdminOnly><LocalComputerSection /></AdminOnly></div>;
  if (at === "profiles") return <BrowserProfilesManager />;
  if (at === "elsewhere") {
    return (
      <div data-settings-block="remote" className="flex flex-col gap-[22px]">
        {has("companion") && <div className="flex flex-col gap-[22px] empty:hidden">{remoteAccess.client}{remoteAccess.domain}</div>}
        {has("desktopWorkspaces") && <div data-settings-block="desktopWorkspaces" className="flex flex-col gap-[22px]">{servers}</div>}
      </div>
    );
  }
  const profiles = state.config?.browserProfiles ?? [];
  const showProfiles = builtInBrowserEnabled(state.config) || profiles.length > 0;
  return (
    <>
      {has("computer") && (
        <RowsCard data-settings-block="computer">
          <PageRow page="computers" title={t("settings.rows.desktops")} />
        </RowsCard>
      )}
      {has("computer") && (
        <SettingsGroup label={t("settings.grok.group.browser")} block="browser">
          <SettingsRows>
            <BuiltInBrowserRow />
            <ServerSitesRow />
            {showProfiles && <PageRow page="profiles" title={t("settings.profiles.title")} value={profiles.length || undefined} />}
          </SettingsRows>
        </SettingsGroup>
      )}
      {(has("companion") || has("desktopWorkspaces")) && (
        <RowsCard data-settings-block="remote">
          <PageRow page="elsewhere" title={t("settings.simple.computer.elsewhere")} />
        </RowsCard>
      )}
    </>
  );
}

export function PermissionsPane({ has }: { has: Has }) {
  const { at } = useSubPage();
  if (at === "botAccess") return <div data-settings-block="botAccess" className="contents"><AccessOverview /></div>;
  if (at === "activity") return <div data-settings-block="activity" className="contents"><ActivitySection /></div>;
  return (
    <RowsCard data-settings-block="permissions">
      {has("botAccess") && <PageRow page="botAccess" title={t("settings.section.botAccess")} />}
      {has("activity") && <PageRow page="activity" title={t("settings.section.activity")} />}
    </RowsCard>
  );
}

/** Grok's Vault: the logins bots sign in with, and 1Password. */
export function VaultPane() {
  return <LoginsSettings />;
}

const versionTitle = () => `${productName()} ${appVersion()}`;

function ServerUpdatesRow() {
  const entry = useServerUpdateItem(true);
  if (!entry) return null;
  const status = entry.phase === "idle" ? undefined : [entry.label, entry.item.subtitle].filter(Boolean).join(" ");
  const action = entry.phase === "available" ? t("settings.simple.updates.seeRelease")
    : entry.phase === "reload" ? t("settings.simple.updates.reload")
      : entry.phase === "checking" ? t("common.checking") : t("settings.updates.check");
  return <NavRow data-settings-open="server-update" title={versionTitle()} hint={status} value={action} drill={false} disabled={entry.item.disabled} onClick={entry.item.onSelect} />;
}

export function UpdatesPane({ remoteActive }: { remoteActive: boolean }) {
  const { at } = useSubPage();
  if (at === "diagnostics") return <SettingsRows><DiagnosticsRow simple /></SettingsRows>;
  return (
    <>
      <SettingsGroup label={t("settings.grok.group.version")} block="updates">
        <SettingsRows>
          {window.ogb?.updater ? <UpdatesRow title={versionTitle()} /> : <ServerUpdatesRow />}
          <UpdatesConsentRow />
        </SettingsRows>
      </SettingsGroup>
      <HelpGroup remoteActive={remoteActive} />
    </>
  );
}

function HelpGroup({ remoteActive }: { remoteActive: boolean }) {
  const [about, setAbout] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <RowsCard label={t("settings.w6.group.help")} data-settings-block="about">
      <NavRow data-settings-open="about" title={t("settings.advanced.about.about")} onClick={() => setAbout(true)} />
      <NavRow data-settings-open="shortcuts" title={t("settings.advanced.about.shortcuts")} onClick={() => setShortcuts(true)} />
      <NavRow data-settings-open="help" title={t("settings.advanced.about.help")} external onClick={() => void openExternalLink(HELP_CENTER_URL)} />
      <NavRow data-settings-open="feedback" title={t("settings.advanced.about.feedback")} external onClick={() => void openExternalLink(FEEDBACK_URL)} />
      {!remoteActive && <ReplayTourRows />}
      <PageRow data-settings-open="diagnostics" page="diagnostics" title={t("settings.diagnostics.title")} />
      <AboutDialog open={about} onClose={() => setAbout(false)} />
      <KeyboardShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
    </RowsCard>
  );
}

export { ADVANCED_PAGES, type AdvancedPage } from "@/lib/open-settings";

const ADVANCED_TITLES: Record<AdvancedPage, LocaleKey> = {
  apps: "settings.w6.apps.title",
  bots: "settings.advanced.bots.title",
  looks: "settings.advanced.looks.title",
  team: "settings.w6.team.title",
  data: "settings.w6.data.title",
  builder: "settings.w6.builder.title",
};

export const advancedTitle = (page: AdvancedPage) => t(ADVANCED_TITLES[page]);

/** The first screen of Advanced features: the places Grok keeps off its sidebar open straight away, then the rarer settings. */
export function AdvancedIndex({ pages, remoteActive, onOpen }: { pages: readonly AdvancedPage[]; remoteActive: boolean; onOpen: (page: AdvancedPage) => void }) {
  const { state, dispatch } = useStore();
  const files = useCloudFilesReady();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archived = state.bots.filter((bot) => bot.hidden && !bot.movedTo);
  const leave = (action: Parameters<typeof dispatch>[0]) => { dispatch({ type: "toggleAppSettings", open: false }); dispatch(action); };
  const skinChoice = useSkinChoice();
  const skin = SKINS.find((entry) => entry.id === resolveSkin(skinChoice))?.name;
  return (
    <>
      {!remoteActive && (
        <RowsCard label={t("settings.w6.group.yourBots")} data-settings-block="advanced-bots">
          <NavRow data-settings-open="inbox" title={t("settings.advanced.bots.inbox")} onClick={() => { dispatch({ type: "toggleAppSettings", open: false }); openInbox(); }} />
          <NavRow data-settings-open="automations" title={t("settings.advanced.bots.automations")} onClick={() => leave({ type: "showRoutines", view: "list" })} />
          <NavRow data-settings-open="team-map" title={t("settings.advanced.bots.teamMap")} onClick={() => leave({ type: "showTeamMap" })} />
          {files && <NavRow data-settings-open="files" title={t("settings.advanced.bots.files")} onClick={() => leave({ type: "showFiles" })} />}
          {archived.length > 0 && <NavRow data-settings-open="archived" title={t("settings.advanced.bots.archived")} value={archived.length} onClick={() => setArchivedOpen(true)} />}
        </RowsCard>
      )}
      <RowsCard label={remoteActive ? undefined : t("settings.w6.group.more")} data-settings-block="advanced-pages">
        {ADVANCED_PAGES.filter((page) => pages.includes(page.id)).map((page) => (
          <NavRow key={page.id} data-settings-advanced={page.id} title={advancedTitle(page.id)} value={page.id === "looks" ? skin : undefined} onClick={() => onOpen(page.id)} />
        ))}
      </RowsCard>
      {archivedOpen && <ArchivedBotsPanel bots={archived} onClose={() => setArchivedOpen(false)} onRestored={() => {}} />}
    </>
  );
}

function AppsPage({ has }: { has: Has }) {
  const { state, dispatch } = useStore();
  const { at } = useSubPage();
  const skills = has("skills") && skillsLibraryEnabled(state.config);
  if (at === "mcp") return <div data-settings-block="mcp" className="contents"><AdminOnly><McpServersPanel embedded rows /></AdminOnly></div>;
  if (at === "skills") return <div data-settings-block="skills" className="contents"><SkillsSection /></div>;
  return (
    <RowsCard data-settings-block="apps">
      <NavRow data-settings-open="apps" title={t("settings.advanced.apps.connected.title")} onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })} />
      <PageRow page="mcp" title={t("settings.advanced.apps.mcp")} />
      {skills && <PageRow page="skills" title={t("settings.section.skills")} />}
    </RowsCard>
  );
}

function BotsPage() {
  const { state } = useStore();
  const [editing, setEditing] = useState(false);
  const name = state.config?.profile?.name?.trim();
  return (
    <>
      <RowsCard label={t("settings.w6.group.aboutYou")} data-settings-block="profile">
        <NavRow data-settings-open="profile" title={t("settings.profile.name")} value={name || t("settings.simple.account.noName")} onClick={() => setEditing(true)} />
      </RowsCard>
      <SettingsGroup label={t("settings.advanced.bots.defaults")} block="bot-defaults">
        <SettingsRows>
          <DefaultBotSidebarRow simple />
          <FollowUpRow simple />
          <NewBotEffortRow />
          <DefaultBotSettings />
        </SettingsRows>
      </SettingsGroup>
      {editing && (
        <FormDialog data-panel-modal="profile" title={t("settings.w6.group.aboutYou")} width={460} onClose={() => setEditing(false)}>
          <div data-settings-look="simple" className="-mx-2 flex flex-col"><ProfileFields /></div>
        </FormDialog>
      )}
    </>
  );
}

function LooksPage({ remoteActive }: { remoteActive: boolean }) {
  const active = resolveSkin(useSkinChoice());
  const dressed = useDressUp();
  return (
    <>
      <RowsCard data-settings-block="looks">
        <SelectRow
          data-panel-row="skin"
          title={t("settings.skin.title")}
          value={active}
          options={SKINS.map((skin) => ({ value: skin.id, label: skin.name, title: skin.tagline }))}
          onChange={(id) => applySkin(id)}
        />
        {active === "halloween" && <SwitchRow title={t("settings.skin.dressUp.title")} checked={dressed} onChange={() => setDressUp(!dressed)} />}
      </RowsCard>
      <SettingsGroup label={t("settings.section.appearance")} block="appearance-more">
        <SettingsRows>
          <PlaceLookRows />
          <WindowFrameRow />
          <FontRow />
          <ChatWidthRow />
          {!remoteActive && <ToolCallsRow />}
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup label={t("settings.grok.group.sidebar")} block="sidebar">
        <SettingsRows>
          <ChromeRailRow />
          <PinnedCirclesRow />
          <UniversalPinsRow />
        </SettingsRows>
      </SettingsGroup>
    </>
  );
}

/** Grok's Usage & Billing pane: a card per engine limit, the Cloud's meters, then the breakdown and the plan as rows. */
export function UsagePane({ has, cloudAccount }: { has: Has; cloudAccount: ReactNode }) {
  const { at } = useSubPage();
  const { usage, upgrade, dialog } = useCloudUsageSettings();
  const plan = useCloudPlan();
  const signedOut = plan?.view.kind === "signed-out" || plan?.view.kind === "removed";
  const limits = useEngineLimits().filter(reportsUsage);
  if (at === "breakdown") {
    return (
      <div className="flex flex-col gap-[22px]">
        {!usage && <AdminOnly note="settings.adminOnly.usage"><PlanUsageSummary /></AdminOnly>}
        {usage && <CloudUsageDetails usage={usage} upgrade={upgrade} />}
        {has("usage") && <AdminOnly note="settings.adminOnly.usage"><UsageSection /></AdminOnly>}
      </div>
    );
  }
  if (at === "plan") return <div data-settings-block="cloudAccount" className="flex flex-col gap-[22px]">{cloudAccount}</div>;
  return (
    <>
      {limits.length ? (
        <SettingsGroup block="usage" footnote={t("settings.usage.footnote")}>
          <div data-usage-cards="" className="flex flex-col gap-3">{limits.map((limit) => <UsageMeterCard key={limit.engine} limit={limit} />)}</div>
        </SettingsGroup>
      ) : !usage && (
        <RowsCard data-settings-block="usage">
          <NavRow drill={false} disabled title={t("settings.usage.empty.title")} hint={t("settings.usage.empty.subtitle")} onClick={() => {}} />
        </RowsCard>
      )}
      {usage && <div data-settings-block="cloudUsage" className="scroll-mt-4"><CloudUsageSummaryView usage={usage} upgrade={upgrade}>{dialog}</CloudUsageSummaryView></div>}
      {(usage || has("usage")) && (
        <RowsCard>
          <PageRow page="breakdown" title={t("settings.usage.breakdown")} />
        </RowsCard>
      )}
      {has("cloudAccount") && (
        <SettingsGroup label={t("settings.simple.billing.plan")} block="cloudAccount" footnote={<CloudPlanFootnote />}>
          <SettingsRows>
            <CloudPlanRow place="plan" usage={usage} upgrade={upgrade} />
            {!signedOut && cloudAccount && <PageRow page="plan" title={t("settings.section.cloudAccount")} />}
          </SettingsRows>
        </SettingsGroup>
      )}
    </>
  );
}

function TeamPage({ has, peopleOpen }: { has: Has; peopleOpen: boolean }) {
  const { at } = useSubPage();
  if (at === "organization") return <div data-settings-block="organization" className="contents"><OrganizationSettings /></div>;
  if (at === "people") return <div data-settings-block="people" className="contents"><SettingsRows><PeopleSection simple startOpen={peopleOpen} /></SettingsRows></div>;
  if (at === "workspaces") return <div data-settings-block="workspaces" className="contents"><WorkspacesSection /></div>;
  return (
    <RowsCard data-settings-block="team">
      {has("organization") && <PageRow page="organization" title={t("settings.section.organization")} />}
      {has("people") && <PageRow page="people" title={t("settings.section.people")} />}
      {has("workspaces") && <PageRow page="workspaces" title={t("settings.section.workspaces")} />}
    </RowsCard>
  );
}

function DataPage({ has }: { has: Has }) {
  const { at } = useSubPage();
  if (at === "attachments") return <SettingsRows><AttachmentStorageSettings /></SettingsRows>;
  if (at === "thread-cleanup") return <div data-settings-block="thread-cleanup" className="contents"><ThreadCleanupSettings /></div>;
  if (at === "backups") return <div data-settings-block="backups" className="flex flex-col gap-[22px]"><AdminOnly><WorkspaceBackupSettings /><CompanyBackupSettings /></AdminOnly></div>;
  return (
    <>
      <SettingsGroup block="data">
        <SettingsRows>
          <AnalyticsRow simple />
          <PageRow page="attachments" title={t("settings.attachments.title")} />
          <PageRow page="thread-cleanup" title={t("settings.threadCleanup.title")} />
          {has("backups") && <PageRow page="backups" title={t("settings.section.backups")} />}
        </SettingsRows>
      </SettingsGroup>
    </>
  );
}

/** A number setting that saves on its own field: its value in the row, the field in a small form. */
function FieldDialogRow({ title, value, children, ...rest }: { title: string; value: ReactNode; children: ReactNode; "data-settings-open"?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <NavRow {...rest} title={title} value={value} onClick={() => setOpen(true)} />
      {open && <FormDialog title={title} onClose={() => setOpen(false)}>{children}</FormDialog>}
    </>
  );
}

function BuilderPage() {
  const advanced = useAdvancedMode();
  const { at } = useSubPage();
  const { state } = useStore();
  const minutes = (value: number | undefined) => (value ? `${value} ${t("settings.roomTurns.minutes")}` : undefined);
  if (at === "recovery") return <AutomaticRecoverySettings />;
  if (at === "experimental") return <div data-settings-block="experimental" className="contents"><ExperimentalFeaturesRow /></div>;
  return (
    <SettingsGroup block="builder">
      <SettingsRows>
        {advanced && <AdvancedModeRow simple />}
        <SavedStepsRow />
        <FieldDialogRow data-settings-open="room-turns" title={t("settings.w6c.roomTurns.label")} value={minutes(state.config?.rooms?.turnTimeoutMinutes)}>
          <RoomTurnTimeoutSettings />
        </FieldDialogRow>
        <FieldDialogRow data-settings-open="mcp-calls" title={t("settings.w6c.mcpCalls.label")} value={minutes(state.config?.mcp?.callTimeoutMinutes)}>
          <McpCallTimeoutSettings />
        </FieldDialogRow>
        <ThreadConcurrencySettings />
        <PageRow page="recovery" title={t("settings.recovery.title")} />
        <PageRow page="experimental" title={t("settings.experimental.title")} />
      </SettingsRows>
    </SettingsGroup>
  );
}

/** Model providers and their sign-ins, API keys and the decision model: what every bot's model picker draws from. */
export function ModelsPane({ has, disclose, connections }: { has: Has; disclose: Disclose; connections: ReactNode }) {
  const { at } = useSubPage();
  if (at === "keys") return <div data-settings-block="connections" className="contents"><AdminOnly>{connections}</AdminOnly></div>;
  if (at === "decision") return <div data-settings-block="decisionModel" className="contents"><AdminOnly><DecisionModelSettings /></AdminOnly></div>;
  if (at) return <div data-settings-block="engines" className="contents"><AdminOnly><EnginesSettings simple more={disclose("ai-more")} /></AdminOnly></div>;
  return (
    <>
      {has("engines") && <div data-settings-block="engines" className="flex scroll-mt-4 flex-col gap-[22px]"><AdminOnly><EnginesSettings simple more={disclose("ai-more")} /></AdminOnly></div>}
      {(has("connections") || has("decisionModel")) && (
        <RowsCard label={t("settings.rows.more")} data-settings-block="models-more">
          {has("connections") && <PageRow page="keys" title={t("settings.section.connections")} />}
          {has("decisionModel") && <PageRow page="decision" title={t("settings.section.decisionModel")} />}
        </RowsCard>
      )}
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
    case "bots": return <BotsPage />;
    case "looks": return <LooksPage remoteActive={remoteActive} />;
    case "team": return <TeamPage has={has} peopleOpen={peopleOpen} />;
    case "data": return <DataPage has={has} />;
    case "builder": return <BuilderPage />;
  }
}
