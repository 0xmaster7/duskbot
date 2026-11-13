import { Check, Loader2, X } from "../icons";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { t, tFromServer } from "@/lib/i18n";
import { describePart, describeSkip, preparePictures, saveShareFile, type ShareSkip } from "@/lib/team-share";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { dialogPrimaryCls, fieldLabelCls, footnoteCls, formBodyCls, formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, mdPrimaryCls, mdSecondaryCls, rowHintCls, textAreaCls, textFieldCls } from "./ui/GrokDialog";
import type { NewBotDefaults } from "../../shared/new-bot-defaults";
import type { PackageDocument, PackageSummary } from "../../shared/package-format";
import { friendlyError } from "@/lib/plain-error";

const shareLabelCls = "pl-3.5 text-[12px] leading-4 tracking-[0.01em] text-ink/68";
const shareCardCls = "rounded-[14px] bg-menu px-3.5 py-2.5 text-[13px] leading-[18px] outline-1 -outline-offset-1 outline-transparent [outline-style:solid]";
const shareCheckCls = "flex cursor-pointer items-center gap-2 text-[13px] leading-[18px] text-ink";

export interface PresetShareResponse {
  document: PackageDocument;
  filename: string;
  redacted: string[];
  skipped: ShareSkip[];
  summary: PackageSummary;
}

export interface PresetShareChoices {
  name: string;
  description?: string;
  release?: string;
  notes?: string;
  includeNotes: boolean;
  picture?: string;
  dryRun?: boolean;
}

export function presetShareBody(choices: PresetShareChoices): Record<string, unknown> {
  const text = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  return {
    format: "package",
    version: 2,
    kind: "library",
    name: text(choices.name),
    presetName: text(choices.name),
    presetDescription: text(choices.description),
    release: text(choices.release),
    notes: text(choices.notes),
    includeMemory: choices.includeNotes,
    ...(choices.picture ? { presetAvatar: choices.picture } : {}),
    ...(choices.dryRun ? { dryRun: true } : {}),
  };
}

export function SharePresetContents({ preview, localSkips }: { preview: PresetShareResponse; localSkips: string[] }) {
  const preset = preview.document.package.presets?.[0];
  const notes = Object.keys(preset?.seed?.memory ?? {}).length;
  const rows: Array<[string, string]> = [
    [t("teamShare.part.skills"), preset?.skills?.length ? `${preset.skills.length} · ${preset.skills.join(", ")}` : "0"],
    [t("teamShare.part.notes"), notes ? String(notes) : t("teamShare.none")],
    [t("teamShare.part.pictures"), preset?.bot.appearance?.avatar ? t("teamShare.yes") : t("teamShare.none")],
  ];
  const skipped = [...localSkips, ...preview.skipped.map((skip) => describeSkip(skip, preview.document))];
  return (
    <div className="flex flex-col gap-2">
      <div className={shareLabelCls}>{t("teamShare.included")}</div>
      <dl className={cn(shareCardCls, "m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5")}>
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink/68">{label}</dt>
            <dd className="max-w-[300px] truncate text-right text-ink" title={value}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={footnoteCls}>{t("presetShare.never")}</p>
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

export function SharePresetDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [release, setRelease] = useState("");
  const [notes, setNotes] = useState("");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includePicture, setIncludePicture] = useState(true);
  const [picture, setPicture] = useState<{ dataUrl?: string; skipped: string[] } | null>(null);
  const [preview, setPreview] = useState<PresetShareResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PresetShareResponse | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void api<{ defaults: NewBotDefaults }>("/api/bot-defaults")
      .then(async ({ defaults }) => {
        if (!cancelled && defaults.profile.name?.trim()) setName((current) => current || defaults.profile.name!.trim());
        const prepared = await preparePictures([{ id: "defaults", avatarUrl: defaults.profile.avatarUrl, avatarCrop: defaults.profile.avatarCrop }]);
        if (cancelled) return;
        setPicture({
          dataUrl: prepared.avatars.defaults,
          skipped: prepared.skipped.map((skip) => `${t("teamShare.field.picture")} (${tFromServer(`teamShare.skip.${skip.reason}`, skip.reason)})`),
        });
      })
      .catch(() => { if (!cancelled) setPicture({ skipped: [] }); });
    return () => { cancelled = true; };
  }, []);

  const choices = (dryRun: boolean): PresetShareChoices => ({
    name, description, release, notes, includeNotes, dryRun,
    ...(includePicture && picture?.dataUrl ? { picture: picture.dataUrl } : {}),
  });

  useEffect(() => {
    if (!picture) return;
    const id = ++request.current;
    const timer = window.setTimeout(() => {
      api<PresetShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(presetShareBody({ ...choices(true), release: undefined })) })
        .then((result) => {
          if (id !== request.current) return;
          setPreview(result);
          setError("");
          setRelease((current) => current || result.document.package.release);
        })
        .catch((cause) => {
          if (id !== request.current) return;
          setPreview(null);
          setError(friendlyError(cause));
        });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture, includeNotes, includePicture]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<PresetShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(presetShareBody(choices(false))) });
      saveShareFile(result.filename, result.document);
      setSaved(result);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  const localSkips = includePicture ? picture?.skipped ?? [] : [];
  return createPortal(
    <div className="ui-dialog-scrim fixed inset-0 z-[80] flex items-center justify-center p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-preset-title" tabIndex={-1}
        className={cn(formSheetCls, "max-h-[90vh] max-w-[480px]", "focus-visible:outline-none!")}
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
          <h2 id="share-preset-title" className={formTitleCls}>{t("presetShare.title")}</h2>
          <button aria-label={t("presetShare.close")} disabled={saving} onClick={onClose} className={formCloseCls}><X size={16} /></button>
        </header>

        <div className={cn(formBodyCls, "flex flex-col gap-3")}>
          {saved ? (
            <>
              <div className="flex flex-col gap-0.5">
                <p className="m-0 flex items-center gap-1.5 text-[13px] leading-[18px] text-ink"><Check size={14} className="shrink-0 text-success" />{t("teamShare.saved", { filename: saved.filename })}</p>
                <p className={cn(rowHintCls, "m-0")}>{t("presetShare.savedHint")}</p>
              </div>
              <SharePresetContents preview={saved} localSkips={localSkips} />
            </>
          ) : (
            <>
              <p className={cn(rowHintCls, "m-0 text-pretty")}>{t("presetShare.intro")}</p>
              {preview
                ? <SharePresetContents preview={preview} localSkips={localSkips} />
                : !error && <div className={cn(rowHintCls, "flex items-center gap-2 py-3")}><Loader2 size={14} className="animate-spin" />{t("presetShare.preparing")}</div>}
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={saving}>
                <label className={shareCheckCls}>
                  <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={includePicture} onChange={(event) => setIncludePicture(event.target.checked)} />
                  {t("presetShare.includePicture")}
                </label>
                <label className={shareCheckCls}>
                  <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
                  {t("presetShare.includeNotes")}
                </label>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("presetShare.name")}</span>
                  <input value={name} maxLength={100} disabled={saving} onChange={(event) => setName(event.target.value)} className={textFieldCls} />
                </label>
                <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamShare.release")}</span>
                  <input value={release} maxLength={20} disabled={saving} placeholder="1.0.0" onChange={(event) => setRelease(event.target.value)} className={textFieldCls} />
                </label>
              </div>
              <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("presetShare.description")}</span>
                <input value={description} maxLength={300} disabled={saving} onChange={(event) => setDescription(event.target.value)} className={textFieldCls} />
              </label>
              <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("teamShare.notes")}</span>
                <textarea value={notes} maxLength={4000} rows={2} disabled={saving} onChange={(event) => setNotes(event.target.value)} className={textAreaCls} />
              </label>
            </>
          )}
        </div>

        {error && <p role="alert" className="m-0 px-4 pt-2 text-[12px] leading-4 text-danger">{error}</p>}
        <footer className={formFooterCls}>
          {saved ? (
            <button onClick={onClose} className={dialogPrimaryCls}>{t("teamShare.done")}</button>
          ) : (
            <>
              <button disabled={saving} onClick={onClose} className={mdSecondaryCls}>{t("common.cancel")}</button>
              <button disabled={saving || !preview} onClick={() => void save()}
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
