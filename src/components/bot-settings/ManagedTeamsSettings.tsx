import { useState } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { mdPrimaryCls, rowHintCls, rowTitleCls } from "../ui/GrokDialog";

export function ManagedTeamsSettings({
  name, ownTeam, teams, allowed, onSave,
}: {
  name: string;
  ownTeam: string;
  teams: string[];
  allowed: string[];
  onSave: (teams: string[]) => void;
}) {
  const [selected, setSelected] = useState(allowed);
  const choices = [...new Set([...teams, ...allowed])].filter(team => team !== ownTeam).sort();
  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...allowed].sort());
  return (
    <section data-managed-teams className="mt-3 flex flex-col gap-1 border-t border-transparent pt-3">
      <h4 className={cn(rowTitleCls, "m-0 font-medium")}>{t("botAccess.teams.title")}</h4>
      <p className={cn(rowHintCls, "m-0")}>{t("botPanel.chiefTeams.hint", { name })}</p>
      <fieldset className="m-0 mt-1.5 flex max-h-52 flex-col overflow-y-auto border-0 p-0 [scrollbar-width:thin]">
        <legend className="sr-only">{t("botAccess.teams.legend", { name })}</legend>
        {choices.map(team => (
          <label key={team} className={cn(rowTitleCls, "flex min-h-8 cursor-pointer items-center gap-2.5 rounded-[8px] px-1 hover:bg-ink/4")}>
            <input type="checkbox" className="size-3.5 accent-[var(--color-ink)]" checked={selected.includes(team)}
              onChange={event => setSelected(current => event.target.checked
                ? [...current, team] : current.filter(value => value !== team))} />
            {team === "General" || !team ? t("botAccess.teams.general") : team}
          </label>
        ))}
        {!choices.length && <p className={cn(rowHintCls, "m-0 py-1.5")}>{t("botAccess.teams.empty")}</p>}
      </fieldset>
      {choices.length > 0 && (
        <div className="mt-1.5 flex justify-end">
          <button type="button" disabled={!changed} onClick={() => onSave(selected)} className={mdPrimaryCls}>
            {t("botAccess.teams.save")}
          </button>
        </div>
      )}
    </section>
  );
}
