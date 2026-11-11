import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowLeftRight,
  Check,
  CircleUserRound,
  Cloud,
  Gauge,
  Info,
  HelpCircle,
  Keyboard,
  LayoutDashboard,
  Laptop,
  LifeBuoy,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Smartphone,
  UserRound,
} from "../icons";

import { accountMenuItems, AccountsSheet, cloudRowLabel, useAccounts, type AccountsAccess } from "./AccountMenu";
import { Icon, type IconName } from "./Icon";
import { GROK_FOCUS } from "./SidebarSimpleTop";
import { AccountMoveStatus, useAccountMove, type AccountMoveKind } from "./AccountMove";
import { InitialsAvatar } from "./Avatar";
import { DiscordIcon } from "./DiscordIcon";
import { AboutDialog } from "./AboutDialog";
import { PhoneAppDialog } from "./lazy-screens";
import { CloudTile } from "./cloud-buy/parts";
import { usageBridge } from "./CloudUsageMeter";
import { useCloudPlanSnapshot } from "./CloudTrialNotice";
import type { WorkspacePlace } from "./DesktopWorkspaceSwitcher";
import { railShown, usePlaces } from "@/lib/places";
import { useAutomationNeedingYou, type AutomationNeedingYou } from "./SidebarFooterNav";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { ShortcutHint } from "./ShortcutHint";
import { useSidebarPhoneStatus } from "./SidebarPhoneButton";
import { api, useStore, type Action } from "@/state/store";
import { serverCheckPhase, serverUpdateRow, type ServerUpdateCheck, type ServerUpdatePhase } from "@/lib/server-update";
import type { CloudAccountBridge, CloudAccountState } from "../../electron/cloud-account.mjs";
import { cloudColor } from "@/lib/cloud-look";
import { cn } from "@/lib/cn";
import { meterPercent, resetLine } from "@/lib/usage-meter";
import type { CloudPlanSnapshot } from "../../electron/cloud-account.mjs";
import { activeLocale, t } from "@/lib/i18n";
import { FEEDBACK_URL, HELP_CENTER_URL, appVersion, openExternalLink } from "@/lib/app-links";
import { openAccountDashboard } from "@/lib/account-dashboard";
import { useOtherServerName } from "@/lib/other-server";
import { profileForSession, readSessionState, type SessionState } from "@/lib/session";
import {
  cloudPhoneDestination,
  connectPhoneEntry,
  currentPhonePairingTarget,
  loadPhonePairingAccess,
  phoneDestinations,
  phonePairingSettingsAction,
  type CloudPhoneDestination,
  type ConnectPhoneEntry,
  type PhoneDestination,
  type PhonePairingAccess,
} from "@/lib/phone-pairing";

export function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

/** This computer's account name for a profile with neither a name nor an email: its full name, else its login. */
export function useComputerName(enabled: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const bridge = window.ogb?.desktopProfile;
    if (!enabled || !bridge) return;
    let active = true;
    void (async () => {
      const full = (await bridge.systemName().catch(() => null))?.trim();
      const login = full ? null : (await bridge.loginName?.().catch(() => null))?.trim();
      if (active) setName(full || login || null);
    })();
    return () => { active = false; };
  }, [enabled]);
  return name;
}

export function profileLabel(profile?: { name?: string; email?: string }): string {
  return profile?.name?.trim() || profile?.email?.trim() || t("sidebar.profile.you");
}

type UpdatePhase = ServerUpdatePhase;

function updateBusy(phase: UpdatePhase, pending = false): boolean {
  return pending || phase === "checking";
}

function UpdateIcon({ phase, pending, size = 18 }: { phase: UpdatePhase; pending: boolean; size?: number }) {
  if (updateBusy(phase, pending)) return <Loader2 size={size} className="animate-spin" />;
  if (phase === "up-to-date") return <Check size={size} />;
  return <RefreshCw size={size} />;
}

export function updateNoteworthy(phase: UpdatePhase, pending = false): boolean {
  return pending || (phase !== "idle" && phase !== "up-to-date" && phase !== "checking");
}

interface UpdateEntry {
  item: SidebarMenuItem;
  phase: UpdatePhase;
  pending: boolean;
  label: string;
  source?: "server";
}

/** The update a Simple account menu raises to its top row: one waiting to be installed, or one that failed. */
export function simpleUpdateTop(entry: Pick<UpdateEntry, "phase" | "source"> | null): { label: string; action: string } | null {
  const ready = () => t("sidebar.update.readyShort");
  if (entry?.source === "server") {
    if (entry.phase === "available") return { label: ready(), action: t("sidebar.update.installAction") };
    if (entry.phase === "reload") return { label: ready(), action: t("sidebar.update.restartAction") };
  }
  return null;
}

export function useServerUpdateItem(enabled: boolean): UpdateEntry | null {
  const [phase, setPhase] = useState<ServerUpdatePhase>("idle");
  const [check, setCheck] = useState<ServerUpdateCheck | null>(null);
  const otherServer = useOtherServerName(enabled);

  useEffect(() => {
    if (phase !== "up-to-date") return;
    const timer = setTimeout(() => setPhase("idle"), 3000);
    return () => clearTimeout(timer);
  }, [phase]);

  if (!enabled) return null;
  const row = serverUpdateRow(phase, check, appVersion(), otherServer);
  return {
    phase,
    pending: false,
    label: row.label,
    source: "server",
    item: {
      key: "update",
      label: row.label,
      subtitle: row.subtitle,
      icon: <UpdateIcon phase={phase} pending={false} />,
      disabled: phase === "checking",
      keepOpen: true,
      attention: phase === "available" || phase === "reload" || phase === "error",
      attentionTone: phase === "error" ? "danger" : "accent",
      onSelect: () => {
        if (phase === "available" && check?.releaseUrl) return void openExternalLink(check.releaseUrl);
        if (phase === "reload") return window.location.reload();
        setPhase("checking");
        void api<ServerUpdateCheck>("/api/updates/check", { timeoutMs: 20_000 })
          .then((next) => {
            setCheck(next);
            setPhase(serverCheckPhase(next));
          })
          .catch(() => setPhase("error"));
      },
    },
  };
}

function useConnectPhoneEntry(cloudHome: boolean): ConnectPhoneEntry | null {
  const target = currentPhonePairingTarget(cloudHome);
  const [access, setAccess] = useState<PhonePairingAccess | null>(null);
  useEffect(() => {
    if (target === "computer") return;
    let alive = true;
    void loadPhonePairingAccess().then((next) => {
      if (alive) setAccess(next);
    });
    return () => {
      alive = false;
    };
  }, [target]);
  return connectPhoneEntry(target, access);
}

export function useCloudPhoneDestination(enabled: boolean): { cloud: CloudPhoneDestination; bridge?: CloudAccountBridge } {
  const bridge = enabled && !window.ogb?.remoteClient?.active ? window.ogb?.cloudAccount : undefined;
  const [account, setAccount] = useState<CloudAccountState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let active = true, updated = false;
    const unsubscribe = bridge.onState((next) => { updated = true; if (active) setAccount(next); });
    void bridge.state().then((next) => { if (active && !updated) setAccount(next); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  return bridge ? { cloud: cloudPhoneDestination(account), bridge } : { cloud: null };
}

export function selectPhoneDestination(destination: PhoneDestination, { bridge, dispatch }: { bridge?: Pick<CloudAccountBridge, "connectHomeForPhone">; dispatch: (action: Action) => void }): void {
  if (destination.id !== "cloud" || !bridge) {
    dispatch(phonePairingSettingsAction());
    return;
  }
  void bridge.connectHomeForPhone().catch(() => dispatch({ type: "toggleAppSettings", open: true, section: "cloudAccount" }));
}

export function phoneMenuItems({
  destinations,
  connected,
  onConnect,
}: {
  destinations: PhoneDestination[];
  connected: boolean;
  onConnect: (destination: PhoneDestination) => void;
}): SidebarMenuItem[] {
  return destinations.map((destination) => ({
    key: destination.id === "cloud" ? "connect-phone-cloud" : "connect-phone",
    label: t("sidebar.menu.connectPhone"),
    subtitle: destination.team ? t("sidebar.menu.connectPhone.team", { team: destination.team }) : t(destination.subtitleKey),
    ...(destination.noteKey ? { note: t(destination.noteKey) } : {}),
    icon: <Smartphone size={18} />,
    trailing:
      destination.id === "here" && destination.target === "computer" && connected ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
      ) : undefined,
    onSelect: () => onConnect(destination),
  } satisfies SidebarMenuItem));
}

export function toolMenuItems({ archived }: { archived?: ArchivedBots }): SidebarMenuItem[] {
  return archived?.count ? [{ key: "archived", label: t("sidebar.archived.title"), icon: <Archive size={16} />, value: String(archived.count), onSelect: archived.open }] : [];
}

/** The account button's name: the person, then whatever its dot is raised for, then the move to My Cloud while it goes.
 * A failing move and automations that need the person share one segment. */
export function accountLabel(name: string, { automationsNeedYou, update, move = null }: { automationsNeedYou: boolean; update: string | null; move?: AccountMoveKind | null }): string {
  const needsYou = move === "failed"
    ? t(automationsNeedYou ? "sidebar.account.moveAndAutomationsNeedYou" : "sidebar.account.moveNeedsYou")
    : automationsNeedYou ? t("sidebar.account.automationsNeedYou") : "";
  return [name, needsYou, move === "sending" ? t("sidebar.account.moving") : "", update ?? ""].filter(Boolean).join(" · ");
}

export type AccountDot = "danger" | "accent";
const DOT_COLOR: Record<AccountDot, string> = { danger: "bg-danger", accent: "bg-accent" };

/** The avatar's dot: red while automations, a failed update or the failing move to My Cloud need the person, the accent
 * for an update; none for the move on its way or done (what it brought waits in the menu). */
export function accountDot({ automationsNeedYou, update, move }: { automationsNeedYou: boolean; update: "failed" | "news" | null; move: AccountMoveKind | null }): AccountDot | null {
  if (automationsNeedYou || update === "failed" || move === "failed") return "danger";
  return update ? "accent" : null;
}

/** `besideRail`: the window's rail of places stands beside the page and switches places, so Switch to… isn't offered twice. */
export function placeMenuItems(place: Pick<WorkspacePlace, "bridge" | "current" | "cloudHome" | "onLine" | "openMenu" | "switchable">, { owner, name, onCloudSettings, besideRail = false }: {
  owner: string | null;
  /** A team's name on a team's Cloud. */
  name?: string;
  onCloudSettings: () => void;
  besideRail?: boolean;
}): SidebarMenuItem[] {
  const here = <Check size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />;
  if (!place.switchable) {
    if (!place.cloudHome && !place.current?.home) return [];
    const subtitle = [place.onLine, owner ? t("sidebar.cloudOwner", { email: owner }) : ""].filter(Boolean).join(" · ");
    return [{ key: "place", label: name || t("cloudSetup.myCloud"), ...(subtitle ? { subtitle } : {}), icon: <Cloud size={16} />, trailing: here, onSelect: onCloudSettings }];
  }
  const current = place.current;
  const icon = cloudColor(current?.color) ? <CloudTile color={current?.color} size={16} />
    : current?.local === false || (place.cloudHome && !current) ? <Cloud size={16} /> : <Laptop size={16} />;
  return [
    ...(current ? [{ key: "place", label: current.name, ...(place.cloudHome && place.onLine ? { subtitle: place.onLine } : {}), icon, trailing: here, onSelect: place.openMenu }] : []),
    ...(besideRail ? [] : [{ key: "switch-place", label: t("sidebar.menu.switchTo"), icon: <ArrowLeftRight size={16} />, onSelect: place.openMenu }]),
  ];
}

export function simplePhoneItems({ connected, onGetApp }: { connected: boolean; onGetApp: () => void }): SidebarMenuItem[] {
  return [{
    key: "phone-app",
    label: t("sidebar.menu.connectPhone"),
    icon: <Smartphone size={18} />,
    trailing: connected ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" /> : undefined,
    onSelect: onGetApp,
  }];
}

type PlanWindowUse = { available: boolean; usedPercent: number | null; resetsAt: string | null };
export type PlanUsageWindows = { providers: Array<{ ok: boolean; plan: string | null; weekly: PlanWindowUse; fiveHour: PlanWindowUse; extra?: Array<{ label: string; usedPercent: number }> }> };

export interface UsageSummary {
  value: string;
  weekly?: boolean;
  resets?: string;
}

export function resetsIn(at: number | null, now: number): string | undefined {
  if (at === null || !Number.isFinite(at) || at <= now) return undefined;
  const hours = (at - now) / 3_600_000;
  const format = new Intl.RelativeTimeFormat(activeLocale(), { numeric: "auto" });
  return t("sidebar.menu.resets", { when: hours < 24 ? format.format(Math.max(1, Math.round(hours)), "hour") : format.format(Math.round(hours / 24), "day") });
}

export function planUsageSummary(report: PlanUsageWindows | null, now = Date.now()): UsageSummary | null {
  const signedIn = report?.providers.filter((provider) => provider.ok) ?? [];
  for (const window of ["weekly", "fiveHour"] as const) {
    const known = signedIn.map((provider) => provider[window]).filter((entry) => entry.available && entry.usedPercent !== null);
    if (known.length === 0) continue;
    const tightest = known.reduce((most, entry) => (entry.usedPercent! > most.usedPercent! ? entry : most));
    const resets = resetsIn(tightest.resetsAt ? Date.parse(tightest.resetsAt) : null, now);
    return { value: t("sidebar.menu.usageUsed", { percent: Math.round(tightest.usedPercent!) }), weekly: window === "weekly", ...(resets ? { resets } : {}) };
  }
  const budgets = signedIn.flatMap((provider) => provider.extra?.filter((extra) => extra.label === "Monthly spend") ?? []);
  return budgets.length ? { value: t("sidebar.menu.usageUsed", { percent: Math.round(Math.max(...budgets.map((budget) => budget.usedPercent))) }) } : null;
}

export function cloudUsageSummary(plan: CloudPlanSnapshot | null): UsageSummary | null {
  if (plan?.status !== "paid") return null;
  const usage = plan.usage;
  if (usage?.meters.length) return { value: t("sidebar.menu.usageUsed", { percent: Math.max(...usage.meters.map(meterPercent)) }), resets: resetLine(usage) };
  return null;
}

function usePlanUsageSummary(enabled: boolean): UsageSummary | null {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void api<PlanUsageWindows>("/api/plan-usage", { background: true })
      .then((report) => { if (alive) setSummary(planUsageSummary(report)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return summary;
}

export function profileMenuItems({
  phone,
  usage,
  usageSummary = null,
  update,
  updateTop = null,
  move = [],
  account,
  accounts = [],
  simple,
  onUsage,
  onSettings,
  onShortcuts,
  onAbout,
  onHelp,
  onFeedback,
  onAccount,
  onDashboard,
}: {
  phone: SidebarMenuItem[];
  usage: boolean;
  usageSummary?: UsageSummary | null;
  update: SidebarMenuItem | null;
  updateTop?: { label: string; action: string } | null;
  /** the move to My Cloud's own rows, first of all (AccountMove) */
  move?: SidebarMenuItem[];
  account: string | null;
  /** who is signed in on this device: the last rows, next to where the menu opens */
  accounts?: SidebarMenuItem[];
  simple?: { tools: SidebarMenuItem[]; places: SidebarMenuItem[] };
  onUsage: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
  onHelp: () => void;
  onFeedback: () => void;
  onAccount: () => void;
  /** opens the hosted account dashboard for this workspace */
  onDashboard?: () => void;
}): SidebarMenuItem[] {
  const help: SidebarMenuItem[] = [
    { key: "help", label: t("sidebar.menu.help"), icon: <HelpCircle size={18} />, onSelect: onHelp },
    { key: "feedback", label: t("sidebar.menu.feedback"), icon: <DiscordIcon size={17} />, onSelect: onFeedback },
    {
      key: "shortcuts",
      label: t("sidebar.menu.shortcuts"),
      icon: <Keyboard size={18} />,
      ...(simple ? {} : { trailing: <ShortcutHint id="shortcuts-cheat-sheet" /> }),
      onSelect: onShortcuts,
    },
    { key: "about", label: t("sidebar.menu.about"), icon: <Info size={18} />, separatorBefore: true, onSelect: onAbout },
  ];
  const usageItem: SidebarMenuItem | null = usage ? {
    key: "usage",
    label: usageSummary?.weekly ? t("sidebar.menu.weeklyUsage") : t("settings.section.usage"),
    ...(usageSummary ? { value: usageSummary.value } : {}),
    ...(usageSummary?.resets ? { subtitle: usageSummary.resets } : {}),
    ...(simple ? { chevron: true } : {}),
    icon: <Gauge size={18} />,
    onSelect: onUsage,
  } : null;
  const dashboardItem: SidebarMenuItem | null = onDashboard ? { key: "dashboard", label: t("sidebar.menu.accountDashboard"), icon: <LayoutDashboard size={18} />, onSelect: onDashboard } : null;
  const support: SidebarMenuItem = { key: "support", label: t("sidebar.menu.support"), icon: <LifeBuoy size={18} />, submenu: help, onSelect: () => {} };
  const settings: SidebarMenuItem = { key: "settings", label: t("sidebar.menu.settings"), icon: <SettingsIcon size={18} />, onSelect: onSettings };
  const accountItem: SidebarMenuItem | null = account ? { key: "account", label: account, icon: <CircleUserRound size={18} />, onSelect: onAccount } : null;
  const present = (...items: Array<SidebarMenuItem | null | false>) => items.filter((item): item is SidebarMenuItem => Boolean(item));
  if (!simple) {
    const rest = [...present(usageItem, dashboardItem), ...phone, support, settings, ...present(update), ...(accountItem ? [{ ...accountItem, separatorBefore: true }] : []), ...accounts.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item))];
    return [...move, ...rest.map((item, index) => (move.length && index === 0 ? { ...item, separatorBefore: true } : item))];
  }
  const raised: SidebarMenuItem | null = update && updateTop ? {
    ...update,
    label: updateTop.label,
    subtitle: undefined,
    attention: false,
    trailing: <span className="flex h-6 shrink-0 items-center rounded-full bg-ink px-2.5 text-[12px] font-medium text-app">{updateTop.action}</span>,
  } : null;
  const groups = [
    move,
    present(raised),
    [...present(usageItem, dashboardItem), ...phone, { ...support, submenu: raised ? help : [...help, ...present(update)] }, settings],
    simple.tools,
    [...simple.places, ...present(accountItem)],
    accounts,
  ].filter((group) => group.length > 0);
  return groups.flatMap((group, at) => group.map((item, index) => (at > 0 && index === 0 ? { ...item, separatorBefore: true } : item)));
}

/** Grok's profile menu, word for word: the phone app, Support (help, shortcuts, feedback, about) and Settings, then the
 * account's Add account and Log out. Everything else the menu once held is in Settings. */
export function grokProfileMenuItems({ onGetApp, onHelp, onShortcuts, onFeedback, onAbout, onSettings, onAddAccount, onNeedsYou, onDashboard, accounts }: {
  onAddAccount: () => void;
  /** opens the hosted account dashboard for this workspace */
  onDashboard?: () => void;
  /** the avatar's red dot for an automation that needs the person: a first row that opens it in its bot's panel */
  onNeedsYou?: () => void;
  onGetApp: () => void;
  onHelp: () => void;
  onShortcuts: () => void;
  onFeedback: () => void;
  onAbout: () => void;
  onSettings: () => void;
  accounts: Pick<AccountsAccess, "view" | "openSheet" | "signOut" | "add">;
}): SidebarMenuItem[] {
  const icon = (name: IconName) => <Icon name={name} size={14} />;
  const active = accounts.view?.active;
  const account: SidebarMenuItem[] = active
    ? [
      { key: "add-account", label: t("sidebar.grok.addAccount"), icon: icon("person-add"), onSelect: () => accounts.add() },
      { key: "log-out", label: t("sidebar.grok.logOut"), icon: icon("arrow-bracket-from-left"), onSelect: () => accounts.signOut(active.id) },
    ]
    : accounts.openSheet ? [{ key: "accounts-sheet", label: t("accounts.manage"), icon: icon("person"), onSelect: accounts.openSheet }]
      // nobody signed in here: Sign in, at the account button where a person looks for it; it opens Settings > General > Account
      : [{ key: "sign-in", label: t("accounts.signIn"), icon: icon("person"), onSelect: onAddAccount }];
  return [
    ...(onNeedsYou ? [{ key: "needs-you", label: t("sidebar.account.automationsNeedYou"), icon: icon("alarm-clock"), attention: true, attentionTone: "danger", onSelect: onNeedsYou } satisfies SidebarMenuItem] : []),
    { key: "mobile", label: t("sidebar.menu.connectPhone"), icon: icon("device-mobile"), onSelect: onGetApp, ...(onNeedsYou ? { separatorBefore: true } : {}) },
    ...(onDashboard ? [{ key: "dashboard", label: t("sidebar.menu.accountDashboard"), icon: icon("chart-bars"), onSelect: onDashboard } satisfies SidebarMenuItem] : []),
    { key: "support", label: t("sidebar.grok.support"), icon: icon("book"), onSelect: () => {}, submenu: [
      { key: "help", label: t("sidebar.menu.help"), icon: icon("question-circle"), onSelect: onHelp },
      { key: "shortcuts", label: t("sidebar.menu.shortcuts"), icon: icon("keyboard"), onSelect: onShortcuts },
      { key: "feedback", label: t("sidebar.menu.feedback"), icon: icon("mail"), onSelect: onFeedback },
      { key: "about", label: t("sidebar.menu.about"), icon: icon("info"), onSelect: onAbout },
    ] },
    { key: "settings", label: t("sidebar.menu.settings"), icon: icon("gear"), onSelect: onSettings },
    ...account.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item)),
  ];
}

export interface ArchivedBots {
  count: number;
  open: () => void;
}

export interface SimpleAccount {
  place: WorkspacePlace;
  owner: string | null;
  automationsNeedYou: boolean;
  /** the automation the dot is raised for, which the menu's first row opens */
  needsYou?: AutomationNeedingYou | null;
  archived?: ArchivedBots;
}

export function useSimpleAccount(place: WorkspacePlace, owner: string | null, archived?: ArchivedBots): SimpleAccount {
  const needsYou = useAutomationNeedingYou();
  return { place, owner, automationsNeedYou: needsYou !== null, needsYou, archived };
}

/** `circle` is the phone's round avatar button at the top of the bot list. */
export function SidebarProfileMenu({ iconOnly = false, rail = false, circle = false, simple: account, named = false, nameHidden = false }: {
  /** `named`: Simple's avatar with the person's name beside it, when the footer has the room. */
  iconOnly?: boolean; rail?: boolean; circle?: boolean; simple?: SimpleAccount; named?: boolean;
  /** grok folds the name away while the Connect apps pill widens beside it */
  nameHidden?: boolean;
} = {}) {
  const { state, dispatch } = useStore();
  const simple = account !== undefined;
  const [menuOpen, setMenuOpen] = useState(false);
  const cloudUsage = cloudUsageSummary(useCloudPlanSnapshot(simple ? usageBridge(state.config?.cloudHome === true) : undefined));
  const engineUsage = usePlanUsageSummary(simple && menuOpen && cloudUsage === null && window.ogb?.remoteClient?.active !== true);
  const phone = useSidebarPhoneStatus();
  const connectPhone = useConnectPhoneEntry(state.config?.cloudHome === true);
  const cloudPhone = useCloudPhoneDestination(connectPhone?.target === "computer");
  const destinations = phoneDestinations(connectPhone, cloudPhone.cloud);
  const update = useServerUpdateItem(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [phoneAppOpen, setPhoneAppOpen] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let active = true;
    void readSessionState().then((state) => {
      if (active) setSession(state);
    });
    return () => { active = false; };
  }, []);

  const profile = profileForSession(state.config?.profile, session);
  // grok's footer falls back to the computer's account: "S" in the grey circle, "siddharth" beside it
  const computer = useComputerName(simple && !profile?.name?.trim() && !profile?.email?.trim());
  const name = computer ?? profileLabel(profile);
  const connectTo = (destination: PhoneDestination) => selectPhoneDestination(destination, { bridge: cloudPhone.bridge, dispatch });
  const remote = window.ogb?.remoteClient?.active === true;
  const besideRail = railShown(usePlaces());
  const cloudAccount = !remote && Boolean(window.ogb?.cloudAccount || (window.ogb?.cloudPlan && state.config?.cloudHome === true));
  const openCloudAccount = () => dispatch({ type: "toggleAppSettings", open: true, section: "cloudAccount" });
  const move = useAccountMove(state.config?.cloudHome === true, { onOpen: openCloudAccount, onPairPhone: () => dispatch(phonePairingSettingsAction()) });
  const accounts = useAccounts();

  // one place to connect the phone to opens its pairing at once; only a choice of places asks where
  const getApp = () => {
    if (destinations.length > 1) setPhoneAppOpen(true);
    else if (destinations[0]) connectTo(destinations[0]);
    else dispatch(phonePairingSettingsAction());
  };
  const grokItems = simple ? grokProfileMenuItems({
    onGetApp: getApp,
    onHelp: () => void openExternalLink(HELP_CENTER_URL),
    onShortcuts: () => {
      triggerRef.current?.closest("button")?.focus();
      dispatch({ type: "toggleShortcuts", open: true });
    },
    onFeedback: () => void openExternalLink(FEEDBACK_URL),
    onAbout: () => setAboutOpen(true),
    onSettings: () => dispatch({ type: "toggleAppSettings", open: true, section: "general" }),
    onAddAccount: () => dispatch({ type: "toggleAppSettings", open: true, section: "general" }),
    onDashboard: () => void openAccountDashboard(),
    onNeedsYou: account?.needsYou ? () => {
      const { id, botId } = account.needsYou!;
      dispatch({ type: "openRoutine", routineId: id, botId });
    } : undefined,
    accounts,
  }) : null;
  const items = grokItems ?? profileMenuItems({
    phone: simple
      ? simplePhoneItems({ connected: phone.kind === "connected", onGetApp: getApp })
      : phoneMenuItems({
        destinations,
        connected: phone.kind === "connected",
        onConnect: connectTo,
      }),
    usage: !remote,
    usageSummary: cloudUsage ?? engineUsage,
    update: update?.item ?? null,
    updateTop: simple ? simpleUpdateTop(update) : null,
    move: move.items,
    account: cloudAccount ? cloudRowLabel(accounts.view) : null,
    accounts: accountMenuItems(accounts),
    ...(account ? { simple: {
      tools: toolMenuItems({ archived: account.archived }),
      places: placeMenuItems(account.place, { owner: account.owner, name: state.config?.team?.name, besideRail, onCloudSettings: openCloudAccount }),
    } } : {}),
    onUsage: () => dispatch({ type: "toggleAppSettings", open: true, section: "usage" }),
    onSettings: () => dispatch({ type: "toggleAppSettings" }),
    onShortcuts: () => {
      triggerRef.current?.closest("button")?.focus();
      dispatch({ type: "toggleShortcuts", open: true });
    },
    onAbout: () => setAboutOpen(true),
    onHelp: () => void openExternalLink(HELP_CENTER_URL),
    onFeedback: () => void openExternalLink(FEEDBACK_URL),
    onAccount: openCloudAccount,
    onDashboard: () => void openAccountDashboard(),
  });
  const noteworthy = update && updateNoteworthy(update.phase, update.pending);
  const needsYou = account?.automationsNeedYou === true;
  const initials = computer ? computer[0]!.toUpperCase() : profileInitials(profile);
  const nameless = simple && initials === "?" ? <UserRound size={18} strokeWidth={1.75} aria-hidden /> : undefined;
  const label = accountLabel(name, { automationsNeedYou: needsYou, update: simple && noteworthy && update ? update.label : null, move: move.kind });
  const dot = accountDot({ automationsNeedYou: needsYou, update: noteworthy ? (update.phase === "error" ? "failed" : "news") : null, move: move.kind });
  // Advanced's full row has its own update badge: its avatar's dot is the move's alone.
  const moveDot = accountDot({ automationsNeedYou: false, update: null, move: move.kind });

  return (
    <>
      <SidebarPopoverMenu
        items={items}
        grok={simple}
        ariaLabel={name}
        onOpenChange={simple ? setMenuOpen : undefined}
        triggerClassName={simple && named ? cn("group/account flex max-w-full items-center rounded-full pe-1 text-[13px] leading-[18px] tracking-[0.015em] text-ink transition-[background-color,color,width,padding] duration-300 ease-[cubic-bezier(.2,0,0,1)] hover:text-ink-secondary aria-expanded:text-ink-secondary", nameHidden && "pe-0", GROK_FOCUS) : iconOnly || simple ? cn("group/acct shrink-0", circle || simple ? "rounded-full" : "rounded-xl") : "w-full"}
        triggerTitle={iconOnly || (simple && !named) ? label : undefined}
        triggerLabel={label}
        triggerTour={account?.place.switchable ? "server-switcher" : undefined}
        renderTrigger={({ open }) => simple ? (<>
          <span
            ref={triggerRef}
            data-sidebar-account=""
            className={cn("relative flex size-9 items-center justify-center rounded-full", !named && (open ? "bg-ink/[0.06]" : "hover:bg-ink/[0.06]"))}
          >
            <InitialsAvatar initials={initials} avatarUrl={profile?.avatarUrl} size={36} fallback={nameless} fontSize={14} className="bg-composer leading-[14px] tracking-[-0.35px] text-ink-secondary inset-ring inset-ring-ink/[0.08] group-hover/acct:bg-[color-mix(in_srgb,var(--color-ink)_5%,var(--color-composer))] group-aria-expanded/acct:bg-[color-mix(in_srgb,var(--color-ink)_7%,var(--color-composer))]" />
            {dot && <span aria-hidden data-account-dot={dot} className={cn("absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-panel", DOT_COLOR[dot])} />}
          </span>
          {named && <span aria-hidden="true" data-sidebar-account-name="" className={cn("min-w-0 truncate text-[14px] font-medium leading-5 tracking-[0.01em] transition-[opacity,margin,max-width] ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none",
            nameHidden ? "ms-0 max-w-0 opacity-0 [transition-duration:150ms,300ms,300ms]" : "ms-2 max-w-[200px] opacity-100 [transition-delay:120ms,0ms,0ms] [transition-duration:150ms,300ms,300ms]")}>{name}</span>}
        </>) : iconOnly ? (
          <span
            ref={triggerRef}
            className={cn(
              "relative flex items-center justify-center rounded-xl transition-colors",
              rail ? "size-10" : "size-[46px]",
              circle && "size-10 rounded-full border border-hairline bg-card",
              open ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <InitialsAvatar initials={initials} avatarUrl={profile?.avatarUrl} size={rail ? 30 : circle ? 26 : 28} />
            {dot && <span aria-hidden data-account-dot={dot} className={cn("absolute end-1 top-1 size-2.5 rounded-full ring-2 ring-app", DOT_COLOR[dot])} />}
          </span>
        ) : (
          <span
            ref={triggerRef}
            className={cn(
              "flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
              open ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <span className="relative flex shrink-0">
              <InitialsAvatar initials={profileInitials(profile)} avatarUrl={profile?.avatarUrl} size={28} />
              {moveDot && <span aria-hidden data-account-dot={moveDot} className={cn("absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-app", DOT_COLOR[moveDot])} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] font-medium leading-5 text-ink">{name}</span>
              <AccountMoveStatus kind={move.kind} place={move.place} />
            </span>
            {noteworthy && (
              <span
                title={update.label}
                aria-label={update.label}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  update.phase === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent",
                )}
              >
                <UpdateIcon phase={update.phase} pending={update.pending} size={14} />
              </span>
            )}
          </span>
        )}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {accounts.sheet && <AccountsSheet adding={accounts.sheet.email} note={accounts.sheet.note} onClose={accounts.closeSheet} />}
      {phoneAppOpen && <PhoneAppDialog
        open
        onClose={() => setPhoneAppOpen(false)}
        connect={destinations.map((destination) => ({
          key: destination.id,
          subtitle: destination.team ? t("sidebar.menu.connectPhone.team", { team: destination.team }) : t(destination.subtitleKey),
          onSelect: () => connectTo(destination),
        }))}
      />}
    </>
  );
}
