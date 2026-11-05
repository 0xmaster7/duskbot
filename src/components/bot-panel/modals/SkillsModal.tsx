import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { SkillReviewDialog } from "../../bot-settings/SkillsSection";
import { DialogEmpty, DialogLinkRow, DialogSection, DialogSkeleton, FilledField, footnoteCls, GrokDialog, listRowCls, RowIconButton, rowHintCls, rowTitleCls } from "../../ui/GrokDialog";
import { BotSwitch } from "../rows";
import { useSkillActions } from "./use-skill-actions";

/** The bot's skills: each switchable and removable, a line to add one from a link, and the ways to find more. */
export function SkillsModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { dispatch } = useStore();
  const { skills, source, setSource, importing, remove, importSkill, browse } = useSkillActions(bot);
  const busy = Boolean(skills.working);
  const count = skills.skills.length;

  return (
    <GrokDialog
      data-panel-modal="skills"
      title={t("botSettings.simple.skills")}
      description={t("botSettings.simple.skillsHint", { name: bot.name })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2.5">
          <DialogSection bare={!skills.loading && count === 0} label={skills.loading || count === 0 ? "Installed" : `${count} ${count === 1 ? "skill" : "skills"}`}>
            {skills.loading ? (
              <DialogSkeleton />
            ) : count === 0 ? (
              <DialogEmpty>{t("botSettings.simple.noSkills")} Paste a skill link below, or browse for one.</DialogEmpty>
            ) : (
              <ul className="m-0 flex max-h-[min(280px,calc(100dvh-460px))] list-none flex-col overflow-y-auto p-0 [scrollbar-width:thin]">
                {skills.skills.map((skill) => (
                  <li key={skill.name} data-panel-row={`skill:${skill.name}`} className={cn("group/row", listRowCls, "gap-x-3")}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={cn(rowTitleCls, "truncate")}>{skill.name}</span>
                      {(skill.description || skill.source) && <span className={cn(rowHintCls, "line-clamp-2")}>{skill.description || skill.source}</span>}
                    </span>
                    <RowIconButton
                      reveal
                      icon="trash"
                      data-modal-action={`remove-skill:${skill.name}`}
                      label={t("botPanel.skills.remove", { name: skill.name })}
                      disabled={busy}
                      onClick={() => void remove(skill)}
                    />
                    <BotSwitch
                      color={bot.color}
                      checked={skill.enabled}
                      disabled={busy}
                      aria-label={t("botSettings.simple.skillToggle", { name: skill.name })}
                      onClick={() => void skills.toggle(skill)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </DialogSection>
          <FilledField
            data-panel-form="skill-import"
            icon="link"
            value={source}
            placeholder={t("botPanel.skills.importPlaceholder")}
            label={t("skills.import.label")}
            busy={importing}
            submitLabel={importing ? t("skills.import.importing") : t("common.add")}
            onChange={setSource}
            onSubmit={() => void importSkill()}
          />
          {skills.error && !skills.reviewing && <p role="alert" className={cn(footnoteCls, "text-warning")}>{skills.error}</p>}
        </div>

        <DialogSection label="Find more">
          <DialogLinkRow data-panel-link="browse-skills" icon="book-open" title={t("botPanel.skills.browse")} hint="Ready-made skills anyone can add" onClick={browse} />
          <DialogLinkRow
            data-panel-link="connect-apps"
            icon="extensions"
            title="Connect Apps"
            hint={`Apps come with skills ${bot.name} can use`}
            onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })}
          />
        </DialogSection>
      </div>
      {skills.reviewing && (
        <SkillReviewDialog
          skill={skills.reviewing.skill}
          text={skills.reviewing.text}
          error={skills.error}
          working={skills.working === skills.reviewing.skill.name}
          onCancel={() => skills.setReviewing(null)}
          onEnable={() => void skills.enableReviewed()}
        />
      )}
    </GrokDialog>
  );
}
