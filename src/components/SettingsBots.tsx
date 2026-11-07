import { useSyncExternalStore } from "react";

import { t } from "@/lib/i18n";
import { type BotSettingsRow, type RoomSettingsRow, type SettingsBotTarget } from "@/lib/open-settings";
import { responderShortLabel } from "@/lib/room-responder";
import { shortPath } from "@/lib/short-path";
import { useStore, type Bot, type Group } from "@/state/store";
import { useManagedSkills } from "./bot-settings/SkillsSection";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { useSlackManagementUrl } from "./bot-settings/useSlackManagement";
import { usePlaceChoices } from "./bot-panel/ComputerTab";
import { panelMemoryNotes } from "./bot-panel/memory-notes";
import { PanelModal } from "./bot-panel/modals/PanelModals";
import { sheetLabel, type SheetPage } from "./bot-panel/modals/panel-modal";
import { useMemoryDoc } from "./bot-panel/use-memory-doc";
import { PRESET_TURN_LIMITS, useConversationTurnLimit } from "./ConversationTurnLimit";
import { DefaultBotSidebarRow } from "./DefaultBotControls";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { Card, NavRow, SheetInSettings, SwitchRow, useSubPage } from "./ListRows";
import { effortLabel } from "./ModelPicker";
import { ModelSelectRow } from "./native/ModelSelectRow";
import { DefaultBotSettings } from "./NewBotDialog";
import { RoomAboutModal, RoomFolderModal, RoomInstructionsModal, RoomResponderModal } from "./room-panel/RoomModals";
import { SettingRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";
import { DialogPane } from "./ui/GrokDialog";
import { NewBotEffortRow } from "./AppSettingsRows";

const BOT_HINTS: Partial<Record<BotSettingsRow, () => string>> = {
  backups: () => t("settings.bots.hint.backups"),
  skills: () => t("settings.bots.hint.skills"),
  tools: () => t("settings.bots.hint.tools"),
  permissions: () => t("settings.bots.hint.permissions"),
  folder: () => t("settings.bots.hint.folder"),
  where: () => t("settings.bots.hint.where"),
  identity: () => t("settings.bots.hint.identity"),
  slack: () => t("settings.bots.hint.slack"),
};

const ROOM_HINTS: Record<RoomSettingsRow, () => string> = {
  instructions: () => t("settings.bots.hint.roomInstructions"),
  responder: () => t("settings.bots.hint.responder"),
  folder: () => t("settings.bots.hint.roomFolder"),
  about: () => t("settings.bots.hint.roomAbout"),
};

/** What the Bots pane configures: new bots' defaults, one bot, or one group chat. */
export type BotsScope = "defaults" | `bot:${string}` | `group:${string}`;

const ROOM_TITLE: Record<RoomSettingsRow, () => string> = {
  instructions: () => t("room.panel.instructions"),
  responder: () => t("room.panel.whoResponds"),
  folder: () => t("room.folder.title"),
  about: () => t("room.panel.about"),
};

// the pane's picker in its header and its body read one choice; a link from a panel sets it
let chosenScope: BotsScope | null = null;
const watchers = new Set<() => void>();
const subscribe = (watch: () => void) => { watchers.add(watch); return () => { watchers.delete(watch); }; };
export function chooseBotsScope(scope: BotsScope | null): void {
  if (chosenScope === scope) return;
  chosenScope = scope;
  for (const watch of Array.from(watchers)) watch();
}

export function scopeOf(target: SettingsBotTarget): BotsScope {
  return `${target.kind}:${target.id}`;
}

/** The page a target's row opens, as Settings' page stack holds it. */
export function targetPage(target: SettingsBotTarget | null, bot?: Bot): { id: string; title: string } | null {
  if (!target?.row) return null;
  if (target.kind === "group") return { id: `room:${target.row}`, title: ROOM_TITLE[target.row]() };
  return bot ? { id: `bot:${target.row}`, title: sheetLabel(target.row, bot) } : null;
}

/** The scope shown: the one picked, else the bot open in the chat, else new bots' defaults. */
export function useBotsScope(): { scope: BotsScope; bot?: Bot; group?: Group } {
  const { state } = useStore();
  const picked = useSyncExternalStore(subscribe, () => chosenScope, () => chosenScope);
  const groups = state.groups ?? [];
  const selected = state.bots.find((bot) => bot.id === state.selectedId && !bot.hidden);
  const selectedGroup = groups.find((group) => group.id === state.selectedId && !group.dm);
  const scope: BotsScope = picked ?? (selected ? `bot:${selected.id}` : selectedGroup ? `group:${selectedGroup.id}` : "defaults");
  const bot = scope.startsWith("bot:") ? state.bots.find((entry) => entry.id === scope.slice(4)) : undefined;
  const group = scope.startsWith("group:") ? groups.find((entry) => entry.id === scope.slice(6)) : undefined;
  return bot || group ? { scope, bot, group } : { scope: "defaults" };
}

/** The Bots pane: the picked bot's settings as Grok's rows, a row with more to it opening its page under the pane's header. */
export function BotsPane() {
  const { scope, bot, group } = useBotsScope();
  const sub = useSubPage();
  const top = sub.stack?.[0]?.id;
  if (bot && top?.startsWith("bot:")) return <BotPage key={top} bot={bot} page={top.slice(4) as SheetPage} onDone={sub.back} />;
  if (group && top?.startsWith("room:")) return <RoomPage key={top} group={group} page={top.slice(5) as RoomSettingsRow} onDone={sub.back} />;
  if (bot) return <BotRows key={scope} bot={bot} />;
  if (group) return <RoomRows key={scope} group={group} />;
  return <BotDefaultsRows />;
}

/** Defaults for new bots: on the Models pane, the only part of Bots that is not one bot's own. */
export function BotDefaultsRows() {
  return (
    <SettingsGroup label={t("settings.advanced.bots.defaults")} block="bot-defaults">
      <SettingsRows>
        <DefaultBotSidebarRow simple />
        <NewBotEffortRow />
        <DefaultBotSettings />
      </SettingsRows>
    </SettingsGroup>
  );
}

function useMemoryLine(bot: Bot): string {
  const memory = useMemoryDoc(bot);
  const notes = memory.docs ? panelMemoryNotes(memory.docs).length : 0;
  return notes === 0 ? t("botPanel.memory.nothingYet") : notes === 1 ? t("botPanel.memory.note") : t("botPanel.memory.notes", { count: notes });
}

function ReasoningRow({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const levels = state.instances.find((instance) => instance.instanceId === selection.instanceId)?.capabilities?.effortLevels;
  if (!levels?.length) return null;
  return (
    <SettingRow title={t("model.simple.reasoning")}>
      <SettingsSelect
        aria-label={t("model.effort.label")}
        value={selection.effort ?? ""}
        disabled={Boolean(bot.busy) || bot.yourAccess === "view"}
        options={[{ value: "", label: t("model.effort.default") }, ...levels.map((level) => ({ value: level, label: effortLabel(level) }))]}
        onChange={(event) => dispatch({
          type: "setModel", botId: bot.id, threadId: bot.threadId, updateBotDefault: true,
          selection: { ...selection, effort: levels.find((level) => level === event.target.value) },
        })}
      />
    </SettingRow>
  );
}

/** One bot's settings: its model, what it knows, what it can reach, and who it is. */
function BotRows({ bot }: { bot: Bot }) {
  const { open } = useSubPage();
  const derived = useBotSettingsDerived(bot);
  const skills = useManagedSkills(bot);
  const slackUrl = useSlackManagementUrl(bot.id);
  const { capabilities } = useDesktopCapabilities();
  const { currentLabel } = usePlaceChoices(bot);
  const memoryLine = useMemoryLine(bot);
  const editable = bot.yourAccess !== "view";
  const memoryOn = bot.memoryEnabled !== false;
  const skillsOn = skills.skills.filter((skill) => skill.enabled).length;
  const backups = bot.fallback?.length ?? 0;
  const soul = (bot.soul ?? "").trim();
  const row = (page: BotSettingsRow, value?: string, hint: string | undefined = BOT_HINTS[page]?.(), tooltip?: string) => (
    <NavRow data-panel-page={page} title={sheetLabel(page, bot)} value={value} hint={hint} tooltip={tooltip} onClick={() => open(`bot:${page}`, sheetLabel(page, bot))} />
  );

  return (
    <>
      <SettingsGroup label={t("model.simple.model")} block="bot-model">
        <SettingsRows>
          <ModelSelectRow bot={bot} />
          <ReasoningRow bot={bot} />
          {row("backups", backups > 0 ? t("botPanel.backups.count", { count: backups }) : t("botPanel.none"))}
        </SettingsRows>
      </SettingsGroup>
      <Card label={t("botPanel.section.thisBot")} data-settings-block="bot-knows">
        {row("instructions", undefined, soul ? soul.split("\n")[0] : t("settings.bots.hint.noInstructions"))}
        <SwitchRow title={t("botPanel.memoryRow")} hint={memoryOn ? memoryLine : t("botPanel.memory.off")} label={t("memory.enable")} checked={memoryOn}
          disabled={Boolean(bot.busy) || !editable} onChange={() => derived.patch({ memoryEnabled: !memoryOn })} />
        {memoryOn && <NavRow data-panel-page="memory" title={t("sheet.rows.notes")} hint={t("settings.bots.hint.notes")} onClick={() => open("bot:memory", sheetLabel("memory", bot))} />}
        {row("skills", skills.loading ? undefined : skillsOn > 0 ? t("botPanel.skills.on", { count: skillsOn }) : t("botPanel.none"))}
      </Card>
      <Card label={t("botSettings.sections.access")} data-settings-block="bot-access">
        {row("tools", bot.toolScope !== undefined ? t("botPanel.tools.custom") : undefined)}
        {row("permissions", bot.chiefOfStaff ? t("permissions.chief.title") : undefined)}
        {row("folder", bot.cwd ? shortPath(bot.cwd, capabilities.host?.homeDir) : t("botPanel.folder.private"), undefined, bot.cwd ?? undefined)}
        {row("where", currentLabel ?? t("computer.simple.dest.letItChoose"))}
        {slackUrl && row("slack")}
      </Card>
      <Card data-settings-block="bot-identity">
        {row("identity", bot.title?.trim() || bot.name)}
      </Card>
    </>
  );
}

function BotPage({ bot, page, onDone }: { bot: Bot; page: SheetPage; onDone: () => void }) {
  const derived = useBotSettingsDerived(bot);
  const slackUrl = useSlackManagementUrl(bot.id);
  return (
    <SheetInSettings.Provider value={1}>
      <DialogPane.Provider value>
        <div data-bot-page={page} className="contents">
          <PanelModal page={page} bot={bot} derived={derived} slackUrl={slackUrl} onClose={onDone} />
        </div>
      </DialogPane.Provider>
    </SheetInSettings.Provider>
  );
}

function useMembers(group: Group): Bot[] {
  const { state } = useStore();
  return group.memberIds.map((id) => state.bots.find((bot) => bot.id === id)).filter((bot): bot is Bot => Boolean(bot));
}

function RoomPage({ group, page, onDone }: { group: Group; page: RoomSettingsRow; onDone: () => void }) {
  const members = useMembers(group);
  return (
    <SheetInSettings.Provider value={1}>
      <DialogPane.Provider value>
        <div data-room-page={page} className="contents">
          {page === "instructions" && <RoomInstructionsModal group={group} onClose={onDone} />}
          {page === "responder" && <RoomResponderModal group={group} members={members} onClose={onDone} />}
          {page === "folder" && <RoomFolderModal group={group} onClose={onDone} />}
          {page === "about" && <RoomAboutModal group={group} onClose={onDone} />}
        </div>
      </DialogPane.Provider>
    </SheetInSettings.Provider>
  );
}

function turnLimitLabel(minutes: number): string {
  if (minutes === 60) return t("room.panel.hour");
  if (minutes % 60 === 0) return t("room.panel.hours", { hours: minutes / 60 });
  return t("room.panel.minutes", { minutes });
}

/** A group chat's settings, the same rows: who answers, how long a turn may run, its instructions, folder and name. */
function RoomRows({ group }: { group: Group }) {
  const { open } = useSubPage();
  const members = useMembers(group);
  const limit = useConversationTurnLimit(group);
  const { capabilities } = useDesktopCapabilities();
  const row = (page: RoomSettingsRow, value?: string) => (
    <NavRow data-panel-page={page} title={ROOM_TITLE[page]()} hint={ROOM_HINTS[page]()} value={value} onClick={() => open(`room:${page}`, ROOM_TITLE[page]())} />
  );
  return (
    <>
      <SettingsGroup label={t("room.panel.section.chat")} block="room-chat">
        <SettingsRows>
          {row("responder", responderShortLabel(group, members))}
          <SettingRow title={t("room.panel.turnLimit")}>
            <SettingsSelect
              data-settings-select="turn-limit"
              aria-label={t("room.panel.turnLimit")}
              value={limit.saved === null ? "default" : String(limit.saved)}
              options={[
                { value: "default", label: t("room.turnLimit.default", { minutes: limit.globalMinutes }) },
                ...PRESET_TURN_LIMITS.map((minutes) => ({ value: String(minutes), label: turnLimitLabel(minutes) })),
              ]}
              onChange={(event) => limit.save(event.target.value === "default" ? null : Number(event.target.value))}
            />
          </SettingRow>
        </SettingsRows>
      </SettingsGroup>
      <Card label={t("room.panel.section.room")} data-settings-block="room-knows">
        {row("instructions", group.bulletin.trim() ? undefined : t("botPanel.none"))}
        {row("folder", group.cwd ? shortPath(group.cwd, capabilities.host?.homeDir) : t("botPanel.none"))}
        {row("about", group.name)}
      </Card>
    </>
  );
}
