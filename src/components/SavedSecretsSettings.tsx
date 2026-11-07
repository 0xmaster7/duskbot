import { useEffect, useState } from "react";

import type { SavedSecretSummary } from "../../shared/saved-secrets";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { DialogPane, GrokDialog, mdSecondaryCls } from "./ui/GrokDialog";

// Security: nothing here ever holds a value, which no route returns. A saved secret is only ever removed.

/** The Vault's saved secrets, by label and the bots that may use them. */
export function useSavedSecrets(enabled: boolean) {
  const [secrets, setSecrets] = useState<SavedSecretSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      const answer = (await api("/api/saved-secrets")) as { secrets?: unknown } | undefined;
      setSecrets(Array.isArray(answer?.secrets) ? answer.secrets as SavedSecretSummary[] : []);
      setError(null);
    } catch (cause) {
      setSecrets([]);
      setError(cause instanceof Error && cause.message ? cause.message : t("settings.secrets.loadError"));
    }
  };
  useEffect(() => { if (enabled) void load(); }, [enabled]);
  const remove = async (secret: SavedSecretSummary) => {
    try {
      await api(`/api/saved-secrets/${encodeURIComponent(secret.id)}`, { method: "DELETE" });
      await load();
    } catch {
      setError(t("settings.secrets.removeError", { label: secret.label }));
    }
  };
  return { secrets, error, remove };
}

/** A saved secret opened from the Vault: what it is, who may use it, and Remove (twice, like a login's Delete). */
export function SavedSecretDialog({ secret, hint, onClose, onRemove }: { secret: SavedSecretSummary; hint: string; onClose: () => void; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    try { await onRemove(); } finally { setBusy(false); }
  };
  return (
    <DialogPane.Provider value={false}>
      <GrokDialog data-panel-modal="saved-secret" title={secret.label} description={t("settings.secrets.footnote")} onClose={onClose}>
        <p className="m-0 text-[13px] leading-[18px] text-ink-secondary" dir="auto">{hint}</p>
        <div className="mt-3 flex justify-start">
          <button type="button" disabled={busy} onClick={() => void remove()}
            aria-label={confirming ? t("settings.secrets.removeConfirm") : t("settings.secrets.removeFor", { label: secret.label })}
            className={cn(mdSecondaryCls, confirming && "bg-danger text-danger-ink enabled:hover:bg-danger")}>
            {confirming ? t("settings.secrets.removeConfirm") : t("settings.secrets.remove")}
          </button>
        </div>
      </GrokDialog>
    </DialogPane.Provider>
  );
}
