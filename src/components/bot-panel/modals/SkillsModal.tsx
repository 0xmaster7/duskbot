import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { GrokIcon, type GrokIconName } from "../../GrokIcon";
import { SkillReviewDialog } from "../../bot-settings/SkillsSection";
import { BotSwitch } from "../rows";
import { kitPrimaryCls, kitSecondaryCls, ListGroup, listRowCls, ModalSheet, RowIconButton, rowHintCls, rowTitleCls } from "./ModalSheet";
import { useSkillActions } from "./use-skill-actions";

function LinkRow({ icon, title, hint, onClick, ...rest }: { icon: GrokIconName; title: string; hint: string; onClick: () => void; "data-panel-link"?: string }) {
  return (
    <button
      type="button"
      {...rest}
      onClick={onClick}
      className={cn(listRowCls, "w-full cursor-pointer text-left transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/[0.03] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus")}
    >
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-ink/[0.05] text-ink/80">
        <GrokIcon name={icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={rowTitleCls}>{title}</span>
        <span className={cn(rowHintCls, "truncate")}>{hint}</span>
      </span>
      <span aria-hidden="true" className="flex shrink-0 text-ink/40"><GrokIcon name="chevron-right" size={14} /></span>
    </button>
  );
}

/** The bot's skills: each switchable and removable, a line to add one from a link, and the ways to find more. */
export function SkillsModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { dispatch } = useStore();
  const { skills, source, setSource, importing, remove, importSkill, browse } = useSkillActions(bot);
  const busy = Boolean(skills.working);

  return (
    <ModalSheet
      data-panel-modal="skills"
      width={480}
      title={t("botSettings.simple.skills")}
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className={kitPrimaryCls}><span>{t("common.done")}</span></button>}
    >
      <div className="flex flex-col gap-5">
        <p className={cn(rowHintCls, "-mb-1 px-0.5")}>{t("botSettings.simple.skillsHint", { name: bot.name })}</p>
        <ListGroup label={skills.loading || skills.skills.length === 0 ? undefined : `${skills.skills.length} ${skills.skills.length === 1 ? "skill" : "skills"}`}>
          {skills.loading ? (
            <div aria-busy="true" className="flex flex-col gap-2 px-3.5 py-3">
              <span className="h-3.5 w-1/2 rounded-full bg-ink/6" />
              <span className="h-3.5 w-2/3 rounded-full bg-ink/6" />
            </div>
          ) : skills.skills.length === 0 ? (
            <div data-modal-empty className="flex flex-col items-center gap-1.5 px-6 py-6 text-center">
              <span aria-hidden="true" className="flex text-ink/40"><GrokIcon name="sparkle" size={20} /></span>
              <span className={rowTitleCls}>{t("botSettings.simple.noSkills")}</span>
              <span className={cn(rowHintCls, "text-pretty")}>Paste a skill link below, or browse for one.</span>
            </div>
          ) : (
            <ul className="m-0 flex max-h-[min(300px,calc(100dvh-420px))] list-none flex-col overflow-y-auto p-0 [scrollbar-width:thin]">
              {skills.skills.map((skill) => (
                <li key={skill.name} data-panel-row={`skill:${skill.name}`} className={cn("group/row", listRowCls, "hover:bg-ink/[0.03]")}>
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
          <form
            data-panel-form="skill-import"
            className="mx-2 mt-1 flex items-center gap-2 border-t border-ink/[0.08] pl-1.5 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (source.trim() && !importing) void importSkill();
            }}
          >
            <input
              value={source}
              placeholder={t("botPanel.skills.importPlaceholder")}
              aria-label={t("skills.import.label")}
              disabled={importing}
              onChange={(event) => setSource(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-[6px] bg-transparent px-1 text-[13px] leading-[18px] tracking-[-0.08px] text-ink outline-none placeholder:text-ink/56 focus-visible:shadow-[0_0_0_2px_var(--color-focus)] disabled:opacity-50"
            />
            <button type="submit" disabled={importing || !source.trim()} className={kitSecondaryCls}>
              <span>{importing ? t("skills.import.importing") : t("common.add")}</span>
            </button>
          </form>
        </ListGroup>
        {skills.error && !skills.reviewing && <p role="alert" className={cn(rowHintCls, "-mt-2 px-3.5 text-warning")}>{skills.error}</p>}

        <ListGroup label="Find more">
          <LinkRow data-panel-link="browse-skills" icon="book-open" title={t("botPanel.skills.browse")} hint="Ready-made skills anyone can add" onClick={browse} />
          <LinkRow
            data-panel-link="connect-apps"
            icon="extensions"
            title="Connect Apps"
            hint={`Apps come with skills ${bot.name} can use`}
            onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })}
          />
        </ListGroup>
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
    </ModalSheet>
  );
}
