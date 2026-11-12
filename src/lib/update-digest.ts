// The one quiet line a server install shows after it updated itself or rolled an update back (server/update-state.ts):
// only "Update rolled back, nothing lost" is shown; a plain update is marked seen quietly. Asked once per page, in the background.
import { useEffect, useState } from "react";
import { api } from "@/state/store";
import { whenServerHas } from "./server-compat";
import { t } from "@/lib/i18n";

export interface UpdateDigest { kind: "updated" | "rolled_back"; version: string; at: number }

export function updateDigestLine(digest: UpdateDigest): string {
  return digest.kind === "updated" ? t("updates.updated", { version: digest.version }) : t("updates.rolledBack");
}

/** the unseen digest line, and the call that marks it seen; null when there is none */
export function useUpdateDigest(): { line: string; seen: () => void } | null {
  const [digest, setDigest] = useState<UpdateDigest | null>(null);
  useEffect(() => {
    let active = true;
    void whenServerHas("updateDigest", () => api<{ digest: UpdateDigest | null }>("/api/updates/digest", { background: true }))
      .then(answer => {
        if (!active || !answer?.digest) return;
        // a plain update goes by quietly; only a rollback is worth a line
        if (answer.digest.kind === "updated") void api("/api/updates/digest/seen", { method: "POST", body: "{}" }).catch(() => {});
        else if (answer.digest.kind === "rolled_back") setDigest(answer.digest);
      }, () => {});
    return () => { active = false; };
  }, []);
  if (!digest) return null;
  return { line: updateDigestLine(digest), seen: () => { setDigest(null); void api("/api/updates/digest/seen", { method: "POST", body: "{}" }).catch(() => {}); } };
}
