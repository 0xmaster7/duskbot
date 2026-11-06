// The person's own Cloudflare Workers AI key: an account ID (not a secret, shown back) and a write-only token. With it,
// Clef decides and Clairic reads, and the free tier covers light use.
import { useState } from "react";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { Card as RowsCard, FormDialog, FormField, ItemRow, NavRow, NoteRow } from "./ListRows";
import { textFieldCls } from "./ui/GrokDialog";

const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

type TestResult = { ok: true; latencyMs: number; extraction?: { ok: boolean } } | { ok: false; reason: string; status?: number; extraction?: { ok: boolean } };

export function WorkersAiKeyCard({ failureText }: { failureText: (result: { reason: string; status?: number }) => string }) {
  const { state, dispatch } = useStore();
  const helpers = state.config?.helpers;
  const saved = helpers?.own.workersAi === true;
  const savedAccount = helpers?.workersAiAccountId ?? "";
  const [account, setAccount] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const accountId = (account ?? savedAccount).trim();
  const draft = token.trim();
  const clearing = !draft && saved && account === null;
  const accountChanged = account !== null && accountId !== savedAccount;

  const applied = (config: ConfigStatus) => dispatch({ type: "configStatus", config });

  const save = async () => {
    if (saving || (!draft && !saved && !accountChanged)) return;
    if (draft && !ACCOUNT_ID.test(accountId)) return setError(t("decider.workersAi.needsAccount"));
    setSaving(true);
    setError(null);
    setVerdict(null);
    try {
      // The account ID first: the token's check on save needs it.
      if (accountChanged || (draft && !savedAccount)) {
        applied(await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ decider: { workersAiAccountId: accountId } }) }));
      }
      if (draft || clearing) {
        applied(window.ogb?.setCredential
          ? await window.ogb.setCredential("workersAiToken", draft)
          : await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ decider: { workersAiToken: draft } }) }));
      }
      setToken("");
      setAccount(null);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (testing || saving || (!draft && !saved)) return;
    setTesting(true);
    setVerdict(null);
    setError(null);
    try {
      const result = await api<TestResult>("/api/decider/test", {
        method: "POST",
        body: JSON.stringify({ provider: "workersai", ...(draft ? { key: draft, accountId } : {}) }),
      });
      const extraction = result.extraction ? [t(result.extraction.ok ? "decider.test.extractionOk" : "decider.test.extractionFailed")] : [];
      setVerdict(result.ok
        ? { ok: result.extraction?.ok !== false, text: [t("decider.workersAi.test.ok", { ms: String(result.latencyMs) }), ...extraction].join(" ") }
        : { ok: false, text: failureText(result) });
    } catch (cause) {
      setVerdict({ ok: false, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <RowsCard label={t("decider.workersAi.title")}>
      <ItemRow title={saved ? <span role="status">{t("decider.status.connected")}</span> : t("decider.workersAi.token")} hint={savedAccount || undefined}>
        <button type="button" data-testid="workers-ai-test" onClick={() => void test()} disabled={testing || saving || (!draft && !saved)} className="ui-button cursor-pointer">
          {testing ? t("keys.testing") : t("keys.test")}
        </button>
        <button type="button" data-testid="workers-ai-open" onClick={() => { setError(null); setEditing(true); }} className="ui-button cursor-pointer">
          {saved ? t("settings.s2.key.replace") : t("settings.s2.key.add")}
        </button>
      </ItemRow>
      {error && !editing && <NoteRow tone="danger">{error}</NoteRow>}
      {verdict && <div role="status" className="contents"><NoteRow tone={verdict.ok ? undefined : "danger"}>{verdict.text}</NoteRow></div>}
      <NavRow external title={t("decider.workersAi.getKey")} onClick={() => void openExternalLink(TOKEN_URL)} />
      {editing && (
        <FormDialog
          data-panel-modal="workers-ai-key"
          title={t("decider.workersAi.title")}
          saveLabel={clearing ? t("keys.clear") : t("common.save")}
          canSave={Boolean(draft) || saved || accountChanged}
          busy={saving}
          error={error ?? undefined}
          onSave={save}
          onClose={() => { setEditing(false); setToken(""); setAccount(null); }}
        >
          <FormField label={t("decider.workersAi.accountId")}>
            <input type="text" data-testid="workers-ai-account" value={account ?? savedAccount}
              onChange={(event) => { setVerdict(null); setError(null); setAccount(event.target.value); }} disabled={saving}
              placeholder={t("decider.workersAi.accountIdPlaceholder")} aria-label={t("decider.workersAi.accountId")} autoComplete="off" spellCheck={false} className={textFieldCls} />
          </FormField>
          <FormField label={t("decider.workersAi.token")}>
            <input type="password" data-testid="workers-ai-token" value={token}
              onChange={(event) => { setVerdict(null); setError(null); setToken(event.target.value); }} disabled={saving}
              placeholder={saved ? t("keys.replace") : t("decider.workersAi.tokenPlaceholder")} aria-label={t("decider.workersAi.token")} autoComplete="off" spellCheck={false} className={textFieldCls} />
          </FormField>
        </FormDialog>
      )}
    </RowsCard>
  );
}
