import { useState } from "react";

import { cn } from "@/lib/cn";
import { useComposerChannelMode } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { shortPath } from "@/lib/short-path";
import { firstSentence } from "@/lib/soul";
import { useStore, type Bot } from "@/state/store";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { archiveBotWithNotice } from "../bot-archive";
import { useTeamName } from "../bot-access/ShareBotButton";
import { BotApiCard } from "../bot-settings/BotApiCard";
import { useManagedSkills } from "../bot-settings/SkillsSection";
import { useBotApps } from "../bot-settings/useBotApps";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { useDeleteAllThreads } from "../BotMenuDelete";
import { showDefaultBot } from "../DefaultBotControls";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { SoulField } from "../SoulField";
import { BackupAis } from "./BackupAis";
import { usePlaceChoices } from "./ComputerTab";
import { BotConversations } from "./Conversations";
import { CallModeRow } from "./DetailsTab";
import { panelMemoryNotes } from "./memory-notes";
import type { SimplePageId } from "./page-registry";
import { BotSwitch, Card, NavRow, rowCls, RowText } from "./rows";
import { useMemoryDoc } from "./use-memory-doc";

type Derived = ReturnType<typeof useBotSettingsDerived>;

function useMemoryLine(bot: Bot): string {
  const memory = useMemoryDoc(bot);
  if (bot.memoryEnabled === false) return t("botPanel.memory.off");
  const notes = memory.docs ? panelMemoryNotes(memory.docs).length : 0;
  return notes === 0 ? t("botPanel.memory.nothingYet") : notes === 1 ? t("botPanel.memory.note") : t("botPanel.memory.notes", { count: notes });
}

/** The bot's settings as Grok-style list rows: one card of rows that each open their page, then its rare actions. The
 * Advanced tab draws it; the model lives on Details. */
export function SettingsPage({ bot, derived, onOpen }: {
  bot: Bot;
  derived: Derived;
  onOpen?: (page: SimplePageId) => void;
  editingInstructions?: boolean;
  onEditInstructions?: (open: boolean) => void;
}) {
  const { state, dispatch } = useStore();
  const apps = useBotApps(bot);
  const skills = useManagedSkills(bot);
  const { capabilities } = useDesktopCapabilities();
  const { currentLabel } = usePlaceChoices(bot);
  const memoryLine = useMemoryLine(bot);
  const clearThreads = useDeleteAllThreads(true);
  const team = useTeamName();
  const [mode, setMode] = useComposerChannelMode(`bot:${bot.id}:${bot.threadId}`);
  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  const name = bot.name;
  const open = (page: SimplePageId) => () => onOpen?.(page);

  const skillsOn = skills.skills.filter((skill) => skill.enabled).length;
  const enabledApps = apps.apps.filter((app) => app.scope !== null).map((app) => app.label);
  const backups = bot.fallback?.length ?? 0;
  const conversations = (bot.tasks ?? []).filter((task) => !task.routineRunId).length || 1;
  const engineCoordinates = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.agentsMcp;
  const visibleBots = state.bots.filter((candidate) => !candidate.hidden).length;
  const hidden = bot.defaultBot ? Boolean(bot.sidebarHidden) : Boolean(bot.hidden);
  const hideBlocked = !hidden && !bot.defaultBot && (Boolean(bot.chiefOfStaff) || visibleBots <= 1);
  const editable = bot.yourAccess !== "view";

  const toggleHidden = () => {
    if (bot.defaultBot) return showDefaultBot(dispatch, bot, hidden);
    if (hidden) return dispatch({ type: "updateBot", botId: bot.id, patch: { hidden: false } });
    void archiveBotWithNotice(bot, { bots: state.bots, selectedId: state.selectedId, dispatch, showThreads: false, notify: () => {} });
  };
  const commitLabel = () => {
    if (labelDraft !== null && labelDraft.trim() !== bot.title.trim()) derived.patch({ title: labelDraft.trim() });
    setLabelDraft(null);
  };

  return (
    <div data-panel-settings className="contents">
      <Card label={t("botPanel.section.thisBot")} anchor="uses">
        <NavRow data-panel-page="instructions" title={t("botSettings.simple.instructions")} hint={<span className="block truncate">{firstSentence(bot.soul ?? "") || t("botPanel.instructionsHint", { name })}</span>} onClick={open("instructions")} />
        <NavRow data-panel-page="memory" title={t("botPanel.memoryRow")} hint={memoryLine} onClick={open("memory")} />
        <NavRow data-panel-page="skills" title={t("botSettings.simple.skills")} hint={skills.loading ? "\u00a0" : skillsOn > 0 ? t("botPanel.skills.on", { count: skillsOn }) : t("botPanel.none")} onClick={open("skills")} />
        <NavRow data-panel-page="folder" title={t("computer.files.folder")} hint={<span className="block truncate">{bot.cwd ? shortPath(bot.cwd, capabilities.host?.homeDir) : t("botPanel.folder.private")}</span>} onClick={open("folder")} />
        <NavRow data-panel-page="apps" title={t("botPanel.appsRow")} hint={<span className="block truncate">{enabledApps.length > 0 ? enabledApps.join(", ") : t("botPanel.appsNoneYet")}</span>} onClick={open("apps")} />
        <NavRow data-panel-page="where" title={t("computer.simple.whereWorks", { name })} hint={currentLabel ?? t("computer.simple.dest.letItChoose")} onClick={open("where")} />
        <NavRow data-panel-page="browser" title={t("settings.sites.title")} hint={t("botPanel.sites.hint", { name })} onClick={open("browser")} />
        <NavRow data-panel-page="backups" title={t("botPanel.page.backups")} hint={backups > 0 ? t("botPanel.backups.count", { count: backups }) : t("botPanel.none")} onClick={open("backups")} />
        <NavRow data-panel-page="api" title={t("botPanel.page.api")} hint={t("botPanel.api.hint", { name })} onClick={open("api")} />
        <NavRow data-panel-page="threads" title={t("botPanel.conversations.title")} hint={conversations === 1 ? t("botPanel.threads.one") : t("botPanel.threads.count", { count: conversations })} onClick={open("threads")} />
        <div data-panel-row="goal" className={rowCls}>
          <RowText title={t("composer.goal.soloAria")} hint={t("botPanel.goal.hint")} />
          <BotSwitch color={bot.color} checked={mode === "goal"} aria-label={t("composer.goal.soloAria")} onClick={() => setMode(mode === "goal" ? "chat" : "goal")} />
        </div>
        {editable && (
          <div data-panel-row="hide" className={rowCls}>
            <RowText title={t("botPanel.hide.title")} hint={t("botPanel.hide.hint")} />
            <BotSwitch color={bot.color} checked={hidden} disabled={hideBlocked} aria-label={t("botPanel.hide.title")} onClick={toggleHidden} />
          </div>
        )}
        <CallModeRow />
        <label data-panel-row="job" className={cn(rowCls, "cursor-text")}>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-[18px] tracking-[0.015em] text-ink">{t("botPanel.labelField")}</span>
            <input
              data-panel-job
              value={labelDraft ?? bot.title}
              placeholder={t("botPanel.addLabel")}
              aria-label={t("botPanel.labelField")}
              maxLength={BOT_PROFILE_LIMITS.title}
              disabled={!editable}
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape" && labelDraft !== null) {
                  event.preventDefault();
                  event.stopPropagation();
                  setLabelDraft(null);
                }
              }}
              className="block w-full border-transparent! bg-transparent p-0 text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary outline-none placeholder:text-ink-tertiary focus:text-ink"
            />
          </span>
        </label>
      </Card>

      {editable && (
        <Card label={t("botPanel.section.actions")} anchor="actions">
          {!team && (
            <NavRow
              data-panel-row="chief"
              drill={false}
              title={bot.chiefOfStaff ? t("sidebar.bot.removeChief") : t("sidebar.bot.makeChief")}
              disabled={!bot.chiefOfStaff && engineCoordinates !== true}
              tooltip={!bot.chiefOfStaff && engineCoordinates !== true ? t("sidebar.bot.chiefNeedsEngine") : undefined}
              onClick={() => dispatch({ type: "updateBot", botId: bot.id, patch: { chiefOfStaff: !bot.chiefOfStaff } })}
            />
          )}
          <NavRow data-panel-row="duplicate" drill={false} title={t("botPanel.actions.duplicate")} onClick={() => dispatch({ type: "duplicateBot", botId: bot.id })} />
          <NavRow data-panel-row="delete-all" drill={false} danger title={t("task.deleteAllConversations")} onClick={() => clearThreads.ask(bot.id)} />
        </Card>
      )}
      {clearThreads.dialog}
    </div>
  );
}

/** Instructions on their own page: the bot's soul, saved as it is typed. */
export function InstructionsPage({ bot, derived }: { bot: Bot; derived: Derived }) {
  return (
    <Card>
      <div className="px-2 py-1.5">
        <SoulField
          bot={bot}
          onPatch={derived.patch}
          simple={{ label: t("botSettings.simple.instructions"), placeholder: t("botSettings.simple.instructionsPlaceholder", { name: bot.name }) }}
        />
      </div>
    </Card>
  );
}

export function BackupsPage({ bot, derived }: { bot: Bot; derived: Derived }) {
  return <BackupAis bot={bot} onChange={(fallback) => derived.patch({ fallback })} />;
}

export function ThreadsPage({ bot }: { bot: Bot }) {
  return <BotConversations bot={bot} />;
}

export function ApiPage({ bot }: { bot: Bot }) {
  return <BotApiCard bot={bot} webhooksLink />;
}
