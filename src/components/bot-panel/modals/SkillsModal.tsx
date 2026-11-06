import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { OrgSkillsCard } from "../../bot-settings/OrgSkillsCard";
import { SkillReviewDialog } from "../../bot-settings/SkillsSection";
import { Card, FormDialog, FormField, NavRow, NoteRow, rowCls, RowText, SheetPane, useSubPage } from "../../ListRows";
import { RowIconButton, textFieldCls } from "../../ui/GrokDialog";
import { Toggle } from "../../ui/Toggle";
import { useSkillActions } from "./use-skill-actions";

/** The bot's skills: how many are on, opening the list of them (each switchable and removable), a small form to add one
 * from a link, and the ways to find more. */
export function SkillsModal({ bot }: { bot: Bot; onClose: () => void }) {
  return (
    <SheetPane data-panel-modal="skills" title={t("botSettings.simple.skills")}>
      <SkillRows bot={bot} />
    </SheetPane>
  );
}

function SkillRows({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const actions = useSkillActions(bot);
  const { skills, remove, browse } = actions;
  const { at, open } = useSubPage();
  const [adding, setAdding] = useState(false);
  const busy = Boolean(skills.working);
  const on = skills.skills.filter((skill) => skill.enabled).length;
  const errorRow = skills.error && !skills.reviewing && !adding ? <Card><NoteRow tone="warn">{skills.error}</NoteRow></Card> : null;
  const review = skills.reviewing && (
    <SkillReviewDialog
      skill={skills.reviewing.skill}
      text={skills.reviewing.text}
      error={skills.error}
      working={skills.working === skills.reviewing.skill.name}
      onCancel={() => skills.setReviewing(null)}
      onEnable={() => void skills.enableReviewed()}
    />
  );

  if (at === "installed") {
    return (
      <>
        <Card data-sheet-group="installed">
          {skills.loading ? <NoteRow>{t("skills.loading")}</NoteRow>
            : skills.skills.length === 0 ? <NoteRow>{t("botPanel.sheet.noSkills")}</NoteRow>
              : skills.skills.map((skill) => (
                <div key={skill.name} data-panel-row={`skill:${skill.name}`} className={cn(rowCls, "group/row")}>
                  <RowText title={skill.name} hint={skill.description || skill.source} />
                  <RowIconButton
                    reveal
                    icon="trash"
                    data-modal-action={`remove-skill:${skill.name}`}
                    label={t("botPanel.skills.remove", { name: skill.name })}
                    disabled={busy}
                    onClick={() => void remove(skill)}
                  />
                  <Toggle
                    checked={skill.enabled}
                    disabled={busy}
                    aria-label={t("botSettings.simple.skillToggle", { name: skill.name })}
                    onClick={() => void skills.toggle(skill)}
                  />
                </div>
              ))}
        </Card>
        {errorRow}
        <OrgSkillsCard bot={bot} onAdded={() => void skills.refresh()} />
        {review}
      </>
    );
  }

  return (
    <>
      <Card data-sheet-group="skills">
        <NavRow
          data-sheet-row="installed"
          title={t("sheet.rows.installed")}
          value={skills.loading ? t("skills.loading") : skills.skills.length === 0 ? t("botPanel.sheet.noSkills") : t("botPanel.skills.on", { count: on })}
          onClick={() => open("installed", t("sheet.rows.installed"))}
        />
        <NavRow data-sheet-row="add-skill" title={t("sheet.rows.addSkill")} onClick={() => setAdding(true)} />
      </Card>
      <Card label={t("sheet.rows.findMore")}>
        <NavRow data-panel-link="browse-skills" title={t("botPanel.skills.browse")} onClick={browse} />
        <NavRow data-panel-link="connect-apps" title={t("sheet.rows.connectApps")} onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })} />
      </Card>
      {errorRow}
      {adding && <AddSkillDialog actions={actions} onClose={() => setAdding(false)} />}
      {review}
    </>
  );
}

function AddSkillDialog({ actions, onClose }: { actions: ReturnType<typeof useSkillActions>; onClose: () => void }) {
  const { skills, source, setSource, importing, importSkill } = actions;
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (sent && !importing && !skills.error && source === "") onClose();
  }, [sent, importing, skills.error, source, onClose]);
  return (
    <FormDialog
      data-panel-modal="skill-import"
      title={t("sheet.rows.addSkill")}
      saveLabel={importing ? t("skills.import.importing") : t("common.add")}
      canSave={Boolean(source.trim())}
      busy={importing}
      error={sent && skills.error ? skills.error : null}
      onSave={() => { setSent(true); return importSkill(); }}
      onClose={onClose}
    >
      <FormField label={t("skills.import.label")}>
        <input
          data-autofocus
          data-panel-form="skill-import"
          value={source}
          placeholder={t("botPanel.skills.importPlaceholder")}
          aria-label={t("skills.import.label")}
          onChange={(event) => setSource(event.target.value)}
          className={textFieldCls}
        />
      </FormField>
    </FormDialog>
  );
}
