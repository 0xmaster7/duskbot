import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

import { isDone, plainWhen } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { Routine, RoutineInput, RoutineRunOn } from "@/lib/routines";
import { autoRoutineName, newWhenDraft, scheduleFromDraft, whenDraftFor, type WhenDraft, type WhenPreset } from "@/lib/routine-when";
import { imeComposing } from "@/lib/send-key";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "../bot-settings/BotEditorContext";
import { buttonCls, fieldCls } from "../bot-panel/rows";
import { SelectPill } from "../ui/SelectPill";

const labelCls = "block text-[12px] leading-4 tracking-[0.01em] text-ink-secondary";
const primaryCls = cn(buttonCls, "bg-ink text-app shadow-none enabled:hover:bg-ink/85");
const PRESETS: readonly Exclude<WhenPreset, "keep">[] = ["daily", "weekdays", "weekly", "hourly", "once"];

const dayName = (day: number) => new Date(2026, 0, 4 + day).toLocaleDateString(activeLocale(), { weekday: "long" });

/** One routine's name, when and what, edited in place: a new one for `bot`, or `routine` as it is saved. Only these three
 * change here; everything else a routine carries (where it runs, where results go, files) is kept as it is. */
export function RoutineForm({ bot, routine, defaultRunOn, onDone }: {
  bot: Bot;
  routine?: Routine;
  defaultRunOn?: RoutineRunOn;
  onDone: (saved?: Routine) => void;
}) {
  const { dispatch } = useStore();
  const { request } = useBotEditor();
  const id = useId();
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [when, setWhen] = useState<WhenDraft>(() => (routine ? whenDraftFor(routine.schedule) : newWhenDraft()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const patchWhen = (next: Partial<WhenDraft>) => setWhen((current) => ({ ...current, ...next }));

  const presetOptions = [
    ...(when.preset === "keep" && routine ? [{ value: "keep" as const, label: plainWhen(routine.schedule) }] : []),
    ...PRESETS.map((preset) => ({ value: preset, label: t(`routines.inline.preset.${preset}`) })),
  ];

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    const what = prompt.trim();
    if (!what) { setError(t("routines.inline.error.what")); return; }
    const { schedule, error: whenError } = scheduleFromDraft(when);
    if (whenError) { setError(t(whenError)); return; }
    const named = name.trim() || autoRoutineName(what);
    const body: Partial<RoutineInput> = routine
      ? { name: named, prompt: what, ...(schedule ? { schedule } : {}), ...(schedule && !routine.enabled && isDone(routine) ? { enabled: true } : {}) }
      : { name: named, prompt: what, botId: bot.id, enabled: true, schedule, ...(defaultRunOn ? { runOn: defaultRunOn } : {}) };
    setSaving(true);
    setError("");
    try {
      const response = await request(routine ? `/api/routines/${routine.id}` : "/api/routines", { method: routine ? "PATCH" : "POST", body: JSON.stringify(body) });
      dispatch({ type: "routinePatched", routine: response.routine });
      onDone(response.routine as Routine);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.stopPropagation(); onDone(); }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !imeComposing(event.nativeEvent)) void save();
  };

  return (
    <form data-routine-form={routine?.id ?? "new"} onSubmit={(event) => void save(event)} onKeyDown={keys} className="flex flex-col gap-3 px-2 pb-2 pt-1.5">
      <div>
        <label htmlFor={`${id}-name`} className={labelCls}>{t("routines.inline.name")}</label>
        <input
          id={`${id}-name`}
          autoFocus={Boolean(routine)}
          value={name}
          maxLength={80}
          placeholder={autoRoutineName(prompt) || t("routines.inline.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
          className={cn(fieldCls, "mt-1 w-full")}
        />
      </div>
      <div>
        <span id={`${id}-when`} className={labelCls}>{t("routines.inline.when")}</span>
        <div role="group" aria-labelledby={`${id}-when`} className="mt-1 flex flex-wrap items-center gap-1.5">
          <SelectPill data-panel-select="routine-when" aria-label={t("routines.inline.when")} value={when.preset} options={presetOptions} onChange={(preset) => patchWhen({ preset })} />
          {when.preset === "weekly" && (
            <SelectPill aria-label={t("routines.inline.day")} value={String(when.day)} options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({ value: String(day), label: dayName(day) }))} onChange={(day) => patchWhen({ day: Number(day) })} />
          )}
          {when.preset === "once" && (
            <input type="date" aria-label={t("routines.inline.date")} value={when.date} onChange={(event) => patchWhen({ date: event.target.value })} className={cn(fieldCls, "w-auto flex-none")} />
          )}
          {when.preset !== "hourly" && when.preset !== "keep" && (
            <input type="time" aria-label={t("routines.inline.time")} value={when.time} onChange={(event) => patchWhen({ time: event.target.value })} className={cn(fieldCls, "w-auto flex-none")} />
          )}
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-what`} className={labelCls}>{t("routines.inline.what")}</label>
        <textarea
          id={`${id}-what`}
          autoFocus={!routine}
          rows={3}
          value={prompt}
          placeholder={t("routines.inline.whatPlaceholder")}
          onChange={(event) => setPrompt(event.target.value)}
          className={cn(fieldCls, "mt-1 h-auto w-full resize-none py-1.5")}
        />
      </div>
      {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={() => onDone()} className={buttonCls}>{t("common.cancel")}</button>
        <button type="submit" disabled={saving || !prompt.trim()} className={primaryCls}>{t("common.save")}</button>
      </div>
    </form>
  );
}
