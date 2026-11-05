import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { t, tFromServer } from "@/lib/i18n";
import {
  describePart,
  describeSkip,
  notesLine,
  preparePictures,
  requestedSkills,
  saveShareFile,
  SHARE_DIALOG_DEFAULTS,
  SHARE_VIEW_START,
  shareAnswered,
  shareRefused,
  shareRequestBody,
  tickedSkills,
  type ShareChoices,
  type ShareResponse,
  type ShareView,
} from "@/lib/team-share";
import { api, useStore } from "@/state/store";
import type { NewBotDefaults } from "../../shared/new-bot-defaults";
import { cn } from "@/lib/cn";
import { dialogPrimaryCls, fieldLabelCls, footnoteCls, formBodyCls, formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, mdPrimaryCls, mdSecondaryCls, rowHintCls, textAreaCls, textFieldCls } from "./ui/GrokDialog";

const shareLabelCls = "pl-3.5 text-[12px] leading-4 tracking-[0.01em] text-ink/68";
const shareCardCls = "rounded-[14px] bg-menu px-3.5 py-2.5 text-[13px] leading-[18px] outline-1 -outline-offset-1 outline-ink/8 [outline-style:solid]";
const shareCheckCls = "flex cursor-pointer items-center gap-2 text-[13px] leading-[18px] text-ink";
const shareHintCls = "m-0 pl-6 text-[12px] leading-4 text-ink/56";

export function ShareTeamContents({ preview, includeMemory, localSkips }: {
  preview: ShareResponse;
  includeMemory: boolean;
  localSkips: string[];
}) {
  const pkg = preview.document.package;
  const counts = preview.summary.counts;
  const leader = pkg.team?.leader ? pkg.agents.find((agent) => agent.key === pkg.team?.leader)?.name : undefined;
  const pictures = pkg.agents.filter((agent) => agent.appearance.avatar).length;
  const notes = pkg.agents.reduce((total, agent) => total + Object.keys(agent.seed?.memory ?? {}).length, 0);
  const rows: Array<[string, string]> = [
    [t("teamShare.part.bots"), `${counts.bots} · ${preview.summary.botNames.join(", ")}`],
    [t("teamShare.part.skills"), String(counts.skills)],
    [t("teamShare.part.playbooks"), String(counts.playbooks)],
    [t("teamShare.part.rooms"), String(counts.rooms)],
    [t("teamShare.part.routines"), String(counts.routines)],
    [t("teamShare.part.brief"), pkg.team?.brief ? t("teamShare.yes") : t("teamShare.none")],
    [t("teamShare.part.leader"), leader ?? t("teamShare.none")],
    [t("teamShare.part.connections"), String(counts.connections)],
    [t("teamShare.part.pictures"), String(pictures)],
    [t("teamShare.part.notes"), includeMemory ? String(notes) : t("teamShare.none")],
    ...(counts.presets ? [[t("teamShare.part.presets"), `${counts.presets} · ${preview.summary.presetNames.join(", ")}`] as [string, string]] : []),
  ];
  const skipped = [...localSkips, ...preview.skipped.map((skip) => describeSkip(skip, preview.document))];
  return (
    <div className="flex flex-col gap-2">
      <div className={shareLabelCls}>{t("teamShare.included")}</div>
      <dl className={cn(shareCardCls, "m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5")}>
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink/68">{label}</dt>
            <dd className="max-w-[260px] truncate text-right text-ink" title={value}>{value}</dd>
          </div>
        ))}
      </dl>
      {pkg.connections?.length ? (
        // Security: the whole address shows before Save, since hosted server URLs often carry a key.
        <div className={cn(shareCardCls, "text-ink/68")}>
          <div className="text-ink">{t("teamShare.addresses")}</div>
          <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
            {pkg.connections.map((connection) => (
              <li key={connection.key} className="break-all"><span className="text-ink">{connection.label}</span> · {connection.mcp.url}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className={footnoteCls}>{t("teamShare.never")}</p>
      {preview.redacted.length > 0 && (
        <div className={cn(shareCardCls, "text-ink/68")}>
          <div className="text-ink">{t("teamShare.redacted")}</div>
          <ul className="m-0 mt-1 list-disc pl-5">
            {preview.redacted.map((part) => <li key={part}>{describePart(part, preview.document)}</li>)}
          </ul>
        </div>
      )}
      {skipped.length > 0 && (
        <div className={cn(shareCardCls, "text-ink/68")}>
          <div className="text-ink">{t("teamShare.skipped")}</div>
          <ul className="m-0 mt-1 list-disc pl-5">
            {skipped.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ShareSkillChoices({ available, ticked, counted, onToggle }: {
  available: readonly string[];
  ticked: ReadonlySet<string>;
  counted: boolean;
  onToggle: (skill: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[13px] leading-[18px] text-ink">{t("teamShare.includeSkills")}</div>
      {counted && available.length === 0 && <p className="m-0 text-[12px] leading-4 text-ink/56">{t("teamShare.noSkills")}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {available.map((skill) => (
          <label key={skill} className="flex cursor-pointer items-center gap-1.5 text-[13px] leading-[18px] text-ink">
            <input type="checkbox" className="size-3.5 accent-[var(--color-ink)]" checked={ticked.has(skill)} onChange={() => onToggle(skill)} />
            {skill}
          </label>
        ))}
      </div>
    </div>
  );
}

export function ShareTeamDialog({ team, onClose }: { team: string; onClose: () => void }) {
  const { state } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const teamBots = useMemo(
    () => state.bots.filter((bot) => !bot.hidden && (bot.section?.trim() ?? "") === team),
    [state.bots, team],
  );
  const botNames = useMemo(() => new Map(teamBots.map((bot) => [bot.id, bot.name])), [teamBots]);
  const [name, setName] = useState(team || t("teamLibrary.general"));
  const [tagline, setTagline] = useState("");
  const [summary, setSummary] = useState("");
  const [release, setRelease] = useState("");
  const [notes, setNotes] = useState("");
  const [includePictures, setIncludePictures] = useState<boolean>(SHARE_DIALOG_DEFAULTS.includePictures);
  const [includeMemory, setIncludeMemory] = useState<boolean>(SHARE_DIALOG_DEFAULTS.includeMemory);
  const [includePreset, setIncludePreset] = useState(false);
  const [presetPicture, setPresetPicture] = useState<{ dataUrl?: string } | null>(null);
  const [skillChoice, setSkillChoice] = useState<Set<string> | null>(null);
  const [pictures, setPictures] = useState<{ avatars: Record<string, string>; skipped: string[] } | null>(null);
  const [view, setView] = useState<ShareView>(SHARE_VIEW_START);
  const { preview, available, included, error } = view;
  const setError = (message: string) => setView((current) => ({ ...current, error: message }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ShareResponse | null>(null);
  const request = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void preparePictures(teamBots).then((result) => {
      if (cancelled) return;
      setPictures({
        avatars: result.avatars,
        skipped: result.skipped.map((skip) =>
          `${botNames.get(skip.botId) ?? skip.botId} · ${t("teamShare.field.picture")} — ${tFromServer(`teamShare.skip.${skip.reason}`, skip.reason)}`),
      });
    }).catch(() => {
      if (!cancelled) setPictures({ avatars: {}, skipped: [] });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!includePreset || presetPicture) return;
    let cancelled = false;
    void api<{ defaults: NewBotDefaults }>("/api/bot-defaults")
      .then(({ defaults }) => preparePictures([{ id: "defaults", avatarUrl: defaults.profile.avatarUrl, avatarCrop: defaults.profile.avatarCrop }]))
      .then((prepared) => { if (!cancelled) setPresetPicture({ dataUrl: prepared.avatars.defaults }); })
      .catch(() => { if (!cancelled) setPresetPicture({}); });
    return () => { cancelled = true; };
  }, [includePreset, presetPicture]);

  const choices = useCallback((dryRun: boolean): ShareChoices => ({
    team,
    name,
    tagline,
    summary,
    release,
    notes,
    skills: requestedSkills(skillChoice, available),
    includeMemory,
    ...(includePictures && pictures ? { avatars: pictures.avatars } : {}),
    ...(includePreset ? { includeDefaultsPreset: true, ...(includePictures && presetPicture?.dataUrl ? { presetAvatar: presetPicture.dataUrl } : {}) } : {}),
    dryRun,
  }), [team, name, tagline, summary, release, notes, skillChoice, available, includeMemory, includePictures, pictures, includePreset, presetPicture]);

  useEffect(() => {
    if (!pictures) return;
    if (includePreset && !presetPicture) { setView((current) => ({ ...current, preview: null })); return; }
    const id = ++request.current;
    const all = skillChoice === null;
    const timer = window.setTimeout(() => {
      api<ShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(shareRequestBody({ ...choices(true), release: undefined })) })
        .then((result) => {
          if (id !== request.current) return;
          setView((current) => shareAnswered(current, result, all));
          setRelease((current) => current || result.document.package.release);
        })
        .catch((cause) => {
          if (id !== request.current) return;
          setView((current) => shareRefused(current, cause));
        });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pictures, skillChoice, includeMemory, includePictures, includePreset, presetPicture]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<ShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(shareRequestBody(choices(false))) });
      saveShareFile(result.filename, result.document);
      setSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  const ticked = tickedSkills(skillChoice, included, available);
  const toggleSkill = (skill: string) => {
    const next = new Set(ticked);
    if (next.has(skill)) next.delete(skill);
    else next.add(skill);
    setSkillChoice(next);
  };

  return createPortal(
    <div className="ui-dialog-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-team-title" tabIndex={-1}
        className={cn(formSheetCls, "max-h-[90vh] max-w-[520px]", "focus-visible:outline-none!")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>("input:enabled, textarea:enabled, button:enabled");
            if (!controls?.length) return;
            const first = controls[0]!, last = controls[controls.length - 1]!;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <header className={formHeaderCls}>
          <h2 id="share-team-title" className={formTitleCls}>{t("teamShare.title", { name: team || t("teamLibrary.general") })}</h2>
          <button aria-label={t("teamShare.close")} disabled={saving} onClick={onClose} className={formCloseCls}><X size={16} /></button>
        </header>

        {saved ? (
          <div className={cn(formBodyCls, "flex flex-col gap-3")}>
            <div className="flex flex-col gap-0.5">
              <p className="m-0 flex items-center gap-1.5 text-[13px] leading-[18px] text-ink"><Check size={14} className="shrink-0 text-success" />{t("teamShare.saved", { filename: saved.filename })}</p>
              <p className={cn(rowHintCls, "m-0")}>{t("teamShare.savedHint")}</p>
            </div>
            <ShareTeamContents preview={saved} includeMemory={includeMemory} localSkips={includePictures ? pictures?.skipped ?? [] : []} />
          </div>
        ) : (
          <div className={cn(formBodyCls, "flex flex-col gap-3")}>
            <p className={cn(rowHintCls, "m-0 text-pretty")}>{t("teamShare.intro")}</p>
            {preview
              ? <ShareTeamContents preview={preview} includeMemory={includeMemory} localSkips={includePictures ? pictures?.skipped ?? [] : []} />
              : !error && <div className={cn(rowHintCls, "flex items-center gap-2 py-3")}><Loader2 size={14} className="animate-spin" />{t("teamShare.preparing")}</div>}

            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={saving}>
              <label className={shareCheckCls}>
                <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={includePictures} onChange={(event) => setIncludePictures(event.target.checked)} />
                {t("teamShare.includePictures")}
              </label>
              <label className={shareCheckCls}>
                <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={includeMemory} onChange={(event) => setIncludeMemory(event.target.checked)} />
                {t("teamShare.includeNotes")}
              </label>
              <p className={shareHintCls}>{notesLine(includeMemory)}</p>
              <ShareSkillChoices available={available ?? []} ticked={ticked} counted={available !== null} onToggle={toggleSkill} />
              <label className={shareCheckCls}>
                <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={includePreset} onChange={(event) => setIncludePreset(event.target.checked)} />
                {t("teamShare.includePreset")}
              </label>
              {includePreset && <p className={shareHintCls}>{t("teamShare.presetHint")}</p>}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamShare.name")}</span>
                <input value={name} maxLength={100} disabled={saving} onChange={(event) => setName(event.target.value)} className={textFieldCls} />
              </label>
              <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamShare.release")}</span>
                <input value={release} maxLength={20} disabled={saving} placeholder="1.0.0" aria-describedby="share-team-release-hint" onChange={(event) => setRelease(event.target.value)} className={textFieldCls} />
              </label>
            </div>
            <p id="share-team-release-hint" className={cn(fieldLabelCls, "-mt-2 m-0")}>{t("teamShare.releaseHint")}</p>
            <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamShare.notes")}</span>
              <textarea value={notes} maxLength={4000} rows={2} disabled={saving} onChange={(event) => setNotes(event.target.value)} className={textAreaCls} />
            </label>
            <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamShare.tagline")}</span>
              <input value={tagline} maxLength={160} disabled={saving} onChange={(event) => setTagline(event.target.value)} className={textFieldCls} />
            </label>
            <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamShare.summary")}</span>
              <textarea value={summary} maxLength={2000} rows={2} disabled={saving} onChange={(event) => setSummary(event.target.value)} className={textAreaCls} />
            </label>
          </div>
        )}

        {error && <p role="alert" className="m-0 px-4 pt-2 text-[12px] leading-4 text-danger">{error}</p>}
        <footer className={formFooterCls}>
          {saved ? (
            <button onClick={onClose} className={dialogPrimaryCls}>{t("teamShare.done")}</button>
          ) : (
            <>
              <button disabled={saving} onClick={onClose} className={mdSecondaryCls}>{t("common.cancel")}</button>
              <button disabled={saving || !preview || !name.trim()} onClick={() => void save()}
                className={mdPrimaryCls}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? t("teamShare.saving") : t("teamShare.save")}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
