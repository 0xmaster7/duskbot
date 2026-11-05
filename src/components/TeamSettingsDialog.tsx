import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  applyTeamPlan,
  planNeedsLocalAutoConsent,
  planTeamChange,
  TEAM_APPROVAL_MODES,
  teamBots,
  teamEffortChoices,
  teamModelChoices,
  teamResultCounts,
  type TeamApprovalMode,
  type TeamChange,
  type TeamPlanRow,
  type TeamResultRow,
} from "@/lib/team-bulk-settings";
import { api, desktopApprovalBridge, persistBotUpdate, useStore } from "@/state/store";
import { EFFORT_LEVELS, type EffortLevel } from "../../shared/wire";
import { approvalModeOptions } from "./ApprovalModeSelector";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { effortLabel } from "./ModelPicker";
import { Select } from "./Select";
import { dialogPrimaryCls, fieldLabelCls, footnoteCls, formBodyCls, formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, listCardCls, mdPrimaryCls, mdSecondaryCls, rowHintCls, rowTitleCls } from "./ui/GrokDialog";

type Tab = "approval" | "model";
const KEEP = "";
const ENGINE_DEFAULT = "default";

export function TeamSettingsRows({ rows }: { rows: ReadonlyArray<TeamPlanRow | TeamResultRow> }) {
  return (
    <ul className={cn(listCardCls, "m-0 list-none p-0 py-1")} data-testid="team-settings-rows">
      {rows.map((row) => {
        const [label, tone] = row.status === "apply" ? [t("teamSettings.row.willChange"), "text-accent"]
          : row.status === "applied" ? [t("teamSettings.row.applied"), "text-success"]
            : row.status === "unchanged" ? [t("teamSettings.row.unchanged"), "text-ink/56"]
              : [t("teamSettings.row.skipped", { reason: row.reason }), "text-warning"];
        return (
          <li key={row.bot.id} className="flex items-start justify-between gap-3 px-3.5 py-2 text-[13px] leading-[18px]">
            <span className="min-w-0 truncate text-ink">{row.bot.name}</span>
            <span className={cn("max-w-[65%] text-right text-[12px] leading-[18px]", tone)}>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function TeamSettingsDialog({ team, onClose }: { team: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>("approval");
  const [mode, setMode] = useState<TeamApprovalMode | null>(null);
  const [model, setModel] = useState<string>(KEEP);
  const [effort, setEffort] = useState<string>(KEEP);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<TeamResultRow[] | null>(null);
  const [consent, setConsent] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  const bots = useMemo(() => teamBots(state.bots, team), [state.bots, team]);
  const models = useMemo(() => teamModelChoices(bots, state.instances), [bots, state.instances]);
  const efforts = useMemo(() => teamEffortChoices(bots, state.instances, EFFORT_LEVELS), [bots, state.instances]);
  const change: TeamChange | null = tab === "approval"
    ? mode ? { kind: "approval", mode } : null
    : model === KEEP && effort === KEEP ? null
      : {
        kind: "model",
        ...(model === KEEP ? {} : { model }),
        ...(effort === KEEP ? {} : { effort: effort === ENGINE_DEFAULT ? null : effort as EffortLevel }),
      };
  const plan = change ? planTeamChange(bots, state.instances, change) : [];
  const applying = plan.filter((row) => row.status === "apply").length;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  const run = async (acknowledgeLocalAuto: boolean) => {
    if (running || !applying) return;
    setRunning(true);
    setProgress(0);
    const outcome = await applyTeamPlan(plan, async (bot, patch) => {
      const saved = await persistBotUpdate(bot.id, patch, new AbortController().signal, api, desktopApprovalBridge(), bot);
      dispatch({ type: "botPatched", bot: saved });
    }, { acknowledgeLocalAuto, onProgress: setProgress });
    setResults(outcome);
    setRunning(false);
  };
  const apply = () => {
    if (planNeedsLocalAutoConsent(plan)) setConsent(true);
    else void run(false);
  };
  const close = () => { if (!running) onClose(); };
  const counts = results ? teamResultCounts(results) : null;
  const tabClass = (active: boolean) => cn("h-7 cursor-pointer rounded-full px-3 text-[13px] leading-[18px] tracking-[0.195px] transition-[background-color,color] duration-[120ms] ease-[ease] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default",
    active ? "bg-ink/8 text-ink" : "text-ink/68 hover:text-ink");

  return createPortal(
    <div className="ui-dialog-scrim fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="team-settings-title" data-testid="team-settings-dialog"
        className={cn(formSheetCls, "max-w-[460px]", "focus-visible:outline-none!")}
        onKeyDown={(event) => { if (event.key === "Escape" && !consent) { event.stopPropagation(); close(); } }}>
        <header className={formHeaderCls}>
          <h2 id="team-settings-title" className={formTitleCls}>{t("teamSettings.title", { name: team || t("teamSettings.general") })}</h2>
          <button type="button" aria-label={t("teamSettings.close")} disabled={running} onClick={close} className={formCloseCls}><X size={16} /></button>
        </header>
        {results && counts ? (
          <>
            <div className={cn(formBodyCls, "flex flex-col gap-3")}>
              <p role="status" className={cn(rowHintCls, "m-0")}>
                {t("teamSettings.summary", { applied: counts.applied, unchanged: counts.unchanged, skipped: counts.skipped })}
              </p>
              <TeamSettingsRows rows={results} />
            </div>
            <div className={formFooterCls}>
              <button type="button" onClick={onClose} className={dialogPrimaryCls}>{t("teamSettings.done")}</button>
            </div>
          </>
        ) : (
          <>
            <div className={cn(formBodyCls, "flex flex-col gap-3")}>
            <p className={cn(rowHintCls, "m-0 text-pretty")}>{t("teamSettings.intro", { count: bots.length })}</p>
            <div className="flex gap-1" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "approval"} disabled={running} className={tabClass(tab === "approval")} onClick={() => setTab("approval")}>{t("teamSettings.tab.approval")}</button>
              <button type="button" role="tab" aria-selected={tab === "model"} disabled={running} className={tabClass(tab === "model")} onClick={() => setTab("model")}>{t("teamSettings.tab.model")}</button>
            </div>
            {tab === "approval" ? (
              <fieldset disabled={running} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                <legend className="sr-only">{t("teamSettings.tab.approval")}</legend>
                <div className={listCardCls}>
                {approvalModeOptions().filter((option) => (TEAM_APPROVAL_MODES as readonly string[]).includes(option.mode)).map((option) => (
                  <label key={option.mode} className="mx-1.5 flex cursor-pointer items-start gap-2.5 rounded-[10px] px-2 py-2.5 transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5">
                    <input type="radio" name="team-approval" className="mt-0.5 accent-[var(--color-ink)]" checked={mode === option.mode}
                      onChange={() => setMode(option.mode as TeamApprovalMode)} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={rowTitleCls}>{option.label}</span>
                      <span className={rowHintCls}>{option.description}</span>
                    </span>
                  </label>
                ))}
                </div>
                <p className={footnoteCls}>{t("teamSettings.allThreads")} {t("teamSettings.customPerBot")}</p>
              </fieldset>
            ) : (
              <fieldset disabled={running} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
                <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamSettings.model")}</span>
                  <Select className="w-full" aria-label={t("teamSettings.model")} value={model} onChange={(event) => setModel(event.target.value)}>
                    <option value={KEEP}>{t("teamSettings.keepModel")}</option>
                    {models.map((choice) => <option key={choice.id} value={choice.id}>{`${choice.label} · ${choice.engines.join(", ")}`}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamSettings.effort")}</span>
                  <Select className="w-full" aria-label={t("teamSettings.effort")} value={effort} onChange={(event) => setEffort(event.target.value)}>
                    <option value={KEEP}>{t("teamSettings.keepEffort")}</option>
                    <option value={ENGINE_DEFAULT}>{t("teamSettings.engineDefaultEffort")}</option>
                    {efforts.map((level) => <option key={level} value={level}>{effortLabel(level)}</option>)}
                  </Select>
                </label>
                <p className={cn(footnoteCls, "pl-0")}>{t("teamSettings.threadModels")}</p>
              </fieldset>
            )}
            {change && (
              <div className="flex flex-col gap-2">
                <div className="pl-3.5 text-[12px] leading-4 text-ink/68">{t("teamSettings.preview")}</div>
                <TeamSettingsRows rows={plan} />
              </div>
            )}
            </div>
            <div className={formFooterCls}>
              {running && <span role="status" className="mr-auto text-[12px] leading-4 text-ink/56">{t("teamSettings.progress", { done: progress, count: plan.length })}</span>}
              <button type="button" disabled={running} onClick={close} className={mdSecondaryCls}>{t("common.cancel")}</button>
              <button type="button" disabled={running || !applying} onClick={apply}
                className={mdPrimaryCls}>
                {t(applying === 1 ? "teamSettings.applyOne" : "teamSettings.applyMany", { count: applying })}
              </button>
            </div>
          </>
        )}
      </div>
      <LocalComputerAutoWarning
        open={consent}
        onCancel={() => setConsent(false)}
        onConfirm={() => { setConsent(false); void run(true); }}
      />
    </div>, document.body,
  );
}
