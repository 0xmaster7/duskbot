import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { api, type ConfigStatus } from "@/state/store";

/** What a paired phone calls this computer; empty keeps the default. Saved when the field loses focus or on Enter. */
export function ComputerNameRow({ saved, onSaved, className }: { saved: string; onSaved: (name: string) => void; className?: string }) {
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(saved), [saved]);

  async function save() {
    const next = draft.trim();
    if (saving || next === saved) return;
    setSaving(true);
    setError(null);
    try {
      const config: ConfigStatus = await api("/api/config", { method: "PATCH", body: JSON.stringify({ computerName: next }) });
      onSaved(config.computerName ?? next);
    } catch (e) {
      setError(t("remote.computerName.error", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-computer-name className={cn("flex flex-col gap-1", className)}>
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <label htmlFor="computer-name" className="text-[13px] leading-[18px] text-ink">{t("remote.computerName.title")}</label>
        <input id="computer-name" value={draft} disabled={saving} placeholder={t("remote.computerName.placeholder")}
          aria-describedby={error ? "computer-name-error" : undefined} onChange={(event) => setDraft(event.target.value)} onBlur={() => void save()}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          className="ms-auto w-full max-w-[220px] rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none" />
      </div>
      {error ? <p id="computer-name-error" role="alert" className="text-[12px] leading-4 text-danger">{error}</p> : null}
    </div>
  );
}
