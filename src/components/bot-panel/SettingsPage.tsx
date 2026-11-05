import { t } from "@/lib/i18n";
import { shortPath } from "@/lib/short-path";
import { firstSentence } from "@/lib/soul";
import { useStore, type Bot } from "@/state/store";
import { useTeamName } from "../bot-access/ShareBotButton";
import { BotApiCard } from "../bot-settings/BotApiCard";
import { useManagedSkills } from "../bot-settings/SkillsSection";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { useDeleteAllThreads } from "../BotMenuDelete";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { SoulField } from "../SoulField";
import { BackupAis } from "./BackupAis";
import { usePlaceChoices } from "./ComputerTab";
import { BotConversations } from "./Conversations";
import { panelMemoryNotes } from "./memory-notes";
import type { ModalPage } from "./modals/panel-modal";
import { Card, NavRow } from "./rows";
import { useMemoryDoc } from "./use-memory-doc";

type Derived = ReturnType<typeof useBotSettingsDerived>;

function useMemoryLine(bot: Bot): string {
  const memory = useMemoryDoc(bot);
  if (bot.memoryEnabled === false) return t("botPanel.memory.off");
  const notes = memory.docs ? panelMemoryNotes(memory.docs).length : 0;
  return notes === 0 ? t("botPanel.memory.nothingYet") : notes === 1 ? t("botPanel.memory.note") : t("botPanel.memory.notes", { count: notes });
}

/** The bot's settings as Grok-style list rows: one card of rows that each open their dialog, then its rare actions. The
 * Advanced tab draws it; the model lives on Details. */
export function SettingsPage({ bot, onOpen }: {
  bot: Bot;
  derived?: Derived;
  onOpen?: (page: ModalPage) => void;
}) {
  const { state, dispatch } = useStore();
  const skills = useManagedSkills(bot);
  const { capabilities } = useDesktopCapabilities();
  const { currentLabel } = usePlaceChoices(bot);
  const memoryLine = useMemoryLine(bot);
  const clearThreads = useDeleteAllThreads(true);
  const team = useTeamName();
  const name = bot.name;
  const open = (page: ModalPage) => () => onOpen?.(page);

  const skillsOn = skills.skills.filter((skill) => skill.enabled).length;
  const backups = bot.fallback?.length ?? 0;
  const engineCoordinates = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.agentsMcp;
  const editable = bot.yourAccess !== "view";

  return (
    <div data-panel-settings className="contents">
      <Card label={t("botPanel.section.thisBot")} anchor="uses">
        <NavRow data-panel-page="instructions" title={t("botSettings.simple.instructions")} hint={<span className="block truncate">{firstSentence(bot.soul ?? "") || t("botPanel.instructionsHint", { name })}</span>} onClick={open("instructions")} />
        <NavRow data-panel-page="memory" title={t("botPanel.memoryRow")} hint={memoryLine} onClick={open("memory")} />
        <NavRow data-panel-page="skills" title={t("botSettings.simple.skills")} hint={skills.loading ? "\u00a0" : skillsOn > 0 ? t("botPanel.skills.on", { count: skillsOn }) : t("botPanel.none")} onClick={open("skills")} />
        <NavRow data-panel-page="folder" title={t("computer.files.folder")} hint={<span className="block truncate">{bot.cwd ? shortPath(bot.cwd, capabilities.host?.homeDir) : t("botPanel.folder.private")}</span>} onClick={open("folder")} />
        <NavRow data-panel-page="where" title={t("computer.simple.whereWorks", { name })} hint={currentLabel ?? t("computer.simple.dest.letItChoose")} onClick={open("where")} />
        <NavRow data-panel-page="backups" title={t("botPanel.page.backups")} hint={backups > 0 ? t("botPanel.backups.count", { count: backups }) : t("botPanel.none")} onClick={open("backups")} />
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
