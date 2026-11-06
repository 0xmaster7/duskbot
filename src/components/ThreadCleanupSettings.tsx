import { useEffect, useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Card as RowsCard, FormDialog, FormField, ItemRow, NoteRow } from "./ListRows";
import { Toggle } from "./ui/Toggle";
import { textFieldCls } from "./ui/GrokDialog";

/** Server bounds from server/config.ts, mirrored to reject out-of-range input before the round trip. */
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_RETENTION_DAYS = 30;
const MIB = 1024 * 1024;
const MIN_CAP_BYTES = 256 * 1024;
const MAX_CAP_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_CAP_MIB = 50;

function parseDays(value: string): number | null {
  const days = Number(value);
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS ? days : null;
}

export function parseCapMib(value: string): number | null {
  const mib = Number(value);
  if (!Number.isFinite(mib)) return null;
  const bytes = Math.round(mib * MIB);
  // Exact 0.25 MiB steps only: mibText shows two decimals, so 0.251 would redisplay as 0.25 and silently shrink on the
  // next save.
  return bytes >= MIN_CAP_BYTES && bytes <= MAX_CAP_BYTES && bytes % MIN_CAP_BYTES === 0 ? bytes : null;
}

function mibText(bytes: number): string {
  const mib = bytes / MIB;
  return String(Number.isInteger(mib) ? mib : Number(mib.toFixed(2)));
}

type Knob = "retention" | "cap";

const FIELD = cn(textFieldCls, "flex items-center px-0");

export function ThreadCleanupSettings() {
  const { state, dispatch } = useStore();
  const confirmedRetentionDays = state.config?.threads?.eventLogRetentionDays ?? null;
  const confirmedCapBytes = state.config?.threads?.eventLogMaxBytes ?? null;
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<Knob | null>(null);
  const [error, setError] = useState("");
  const [errorKnob, setErrorKnob] = useState<Knob | null>(null);
  const [editing, setEditing] = useState<Knob | null>(null);
  const saving = useRef(false);

  const retentionValue = retentionDraft ?? (confirmedRetentionDays === null ? String(DEFAULT_RETENTION_DAYS) : String(confirmedRetentionDays));
  const capValue = capDraft ?? (confirmedCapBytes === null ? String(DEFAULT_CAP_MIB) : mibText(confirmedCapBytes));

  useEffect(() => {
    if (retentionDraft !== null && confirmedRetentionDays !== null && String(confirmedRetentionDays) === retentionDraft) setRetentionDraft(null);
  }, [confirmedRetentionDays, retentionDraft]);
  useEffect(() => {
    if (capDraft !== null && confirmedCapBytes !== null && mibText(confirmedCapBytes) === capDraft) setCapDraft(null);
  }, [confirmedCapBytes, capDraft]);

  const save = async (patch: { eventLogRetentionDays?: number | null; eventLogMaxBytes?: number | null }, knob: Knob) => {
    if (saving.current) return;
    saving.current = true;
    setPending(knob);
    setError("");
    setErrorKnob(null);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ threads: patch }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.threadCleanup.error"));
    } finally {
      saving.current = false;
      setPending(null);
    }
  };

  const toggleRetention = (enabled: boolean) => {
    if (!enabled) {
      setRetentionDraft(null);
      setError("");
      setErrorKnob(null);
      void save({ eventLogRetentionDays: null }, "retention");
      return;
    }
    const days = parseDays(retentionValue);
    if (days === null) {
      setError(t("settings.threadCleanup.invalidRetention"));
      setErrorKnob("retention");
      return;
    }
    void save({ eventLogRetentionDays: days }, "retention");
  };

  const toggleCap = (enabled: boolean) => {
    if (!enabled) {
      setCapDraft(null);
      setError("");
      setErrorKnob(null);
      void save({ eventLogMaxBytes: null }, "cap");
      return;
    }
    const bytes = parseCapMib(capValue);
    if (bytes === null) {
      setError(t("settings.threadCleanup.invalidCap"));
      setErrorKnob("cap");
      return;
    }
    void save({ eventLogMaxBytes: bytes }, "cap");
  };

  const commitRetention = (): boolean => {
    if (confirmedRetentionDays === null) return true;
    const days = parseDays(retentionValue);
    if (days === null) {
      setError(t("settings.threadCleanup.invalidRetention"));
      setErrorKnob("retention");
      return false;
    }
    if (days === confirmedRetentionDays) {
      setRetentionDraft(null);
      setError("");
      return true;
    }
    void save({ eventLogRetentionDays: days }, "retention");
    return true;
  };

  const commitCap = (): boolean => {
    if (confirmedCapBytes === null) return true;
    const bytes = parseCapMib(capValue);
    if (bytes === null) {
      setError(t("settings.threadCleanup.invalidCap"));
      setErrorKnob("cap");
      return false;
    }
    if (bytes === confirmedCapBytes) {
      setCapDraft(null);
      setError("");
      return true;
    }
    void save({ eventLogMaxBytes: bytes }, "cap");
    return true;
  };

  // a number field inside the knob's own small dialog; Save commits it as leaving the field did before
  const field = (knob: Knob) => knob === "retention" ? (
    <div className={FIELD}>
      <input id="thread-log-retention-days" type="number" min={MIN_RETENTION_DAYS} max={MAX_RETENTION_DAYS} step={1} inputMode="numeric" value={retentionValue}
        disabled={pending !== null} aria-invalid={errorKnob === "retention"} aria-label={t("settings.threadCleanup.retention.enable")}
        onChange={(event) => { setRetentionDraft(event.target.value); setError(""); setErrorKnob(null); }}
        className="h-full min-w-0 flex-1 bg-transparent px-[9px] text-[13px] tabular-nums text-ink outline-none" />
      <span className="pr-3 text-[13px] text-ink-secondary">{t("settings.threadCleanup.retention.unit")}</span>
    </div>
  ) : (
    <div className={FIELD}>
      <input id="thread-log-cap-mib" type="number" min={MIN_CAP_BYTES / MIB} max={MAX_CAP_BYTES / MIB} step={0.25} inputMode="decimal" value={capValue}
        disabled={pending !== null} aria-invalid={errorKnob === "cap"} aria-label={t("settings.threadCleanup.cap.enable")}
        onChange={(event) => { setCapDraft(event.target.value); setError(""); setErrorKnob(null); }}
        className="h-full min-w-0 flex-1 bg-transparent px-[9px] text-[13px] tabular-nums text-ink outline-none" />
      <span className="pr-3 text-[13px] text-ink-secondary">{t("settings.threadCleanup.cap.unit")}</span>
    </div>
  );
  const knobRow = (knob: Knob) => {
    const on = knob === "retention" ? confirmedRetentionDays !== null : confirmedCapBytes !== null;
    const title = t(knob === "retention" ? "settings.s2.cleanup.retention" : "settings.s2.cleanup.cap");
    const hint = !on ? t("settings.s2.off") : knob === "retention"
      ? t("settings.s2.cleanup.retentionHint", { days: String(confirmedRetentionDays) })
      : t("settings.s2.cleanup.capHint", { size: mibText(confirmedCapBytes!) });
    return (
      <ItemRow title={title} hint={hint}>
        {on && <button type="button" className="ui-button" disabled={pending !== null} onClick={() => { setError(""); setErrorKnob(null); setEditing(knob); }}>{t("settings.s2.change")}</button>}
        <Toggle id={`thread-log-${knob}-enabled`} checked={on} disabled={pending !== null} aria-label={title}
          onClick={() => (knob === "retention" ? toggleRetention(!on) : toggleCap(!on))} />
      </ItemRow>
    );
  };
  return (
    <RowsCard data-settings-block="thread-cleanup-rows">
      {knobRow("retention")}
      {knobRow("cap")}
      {pending !== null && !editing && <NoteRow><span role="status">{t("settings.threadCleanup.saving")}</span></NoteRow>}
      {error && !editing && <NoteRow tone="danger">{error}</NoteRow>}
      {editing && (
        <FormDialog data-panel-modal="thread-cleanup" title={t(editing === "retention" ? "settings.s2.cleanup.retention" : "settings.s2.cleanup.cap")}
          busy={pending !== null} error={error || undefined}
          onSave={() => { const done = editing === "retention" ? commitRetention() : commitCap(); if (done) setEditing(null); }}
          onClose={() => { setEditing(null); setRetentionDraft(null); setCapDraft(null); setError(""); setErrorKnob(null); }}>
          <FormField label={t(editing === "retention" ? "settings.threadCleanup.retention.enable" : "settings.threadCleanup.cap.enable")}>{field(editing)}</FormField>
        </FormDialog>
      )}
    </RowsCard>
  );
}
