// Security: the key is write-only; the server reports configured-or-not, never the value.
import { useEffect, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SettingRow, SettingsRows, Switch } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";
import { Card as RowsCard, FormDialog, FormField, ItemRow, NavRow, NoteRow } from "./ListRows";
import { textFieldCls } from "./ui/GrokDialog";
import { WorkersAiKeyCard } from "./WorkersAiKeyCard";
import { openKeySettings } from "./keys/key-focus";

const KEY_URL = { jev: "https://typesafe.ai", openrouter: "https://openrouter.ai/keys" } as const;
/** The room decision budget in server/decider/room-routing.ts; slower falls back to the lead. */
const ROOM_BUDGET_MS = 1_500;

type Provider = "jev" | "openrouter";
type ModelList = { source: "openrouter" | "builtin"; models: Array<{ id: string; name: string; group: "recommended" | "more"; api?: "chat" | "decisions" }> };
type TestResult = { ok: true; latencyMs: number } | { ok: false; reason: string; status?: number };

const FAILURES: Record<string, LocaleKey> = {
  rejected: "decider.error.rejected",
  unreachable: "decider.error.unreachable",
  timeout: "decider.error.timeout",
  rate_limited: "decider.error.rateLimited",
  overloaded: "decider.error.overloaded",
  malformed: "decider.error.malformed",
  no_key: "decider.error.noKey",
  misconfigured: "decider.error.misconfigured",
};

/** Cloud Pro's relay refuses an inactive subscription (402) and a used-up month of decisions (429). */
const INCLUDED_FAILURES: Record<string, LocaleKey> = {
  rejected: "decider.included.error.rejected",
  rate_limited: "decider.included.error.limited",
};

const OPENROUTER_FAILURES: Record<string, LocaleKey> = {
  ...FAILURES,
  rejected: "decider.openrouter.error.rejected",
  unreachable: "decider.openrouter.error.unreachable",
  timeout: "decider.openrouter.error.timeout",
  rate_limited: "decider.openrouter.error.rateLimited",
  overloaded: "decider.openrouter.error.overloaded",
  malformed: "decider.openrouter.error.malformed",
};

const WORKERS_AI_FAILURES: Record<string, LocaleKey> = {
  ...FAILURES,
  rejected: "decider.workersAi.error.rejected",
  unreachable: "decider.workersAi.error.unreachable",
  timeout: "decider.workersAi.error.timeout",
  rate_limited: "decider.workersAi.error.rateLimited",
  overloaded: "decider.workersAi.error.overloaded",
  malformed: "decider.workersAi.error.malformed",
};

const BY: Record<"jev" | "workersai" | "openrouter", LocaleKey> = {
  jev: "decider.status.byJev", workersai: "decider.status.byWorkersAi", openrouter: "decider.status.byOpenRouter",
};

/** Who decides and who reads, in a word each: the person's own key, the Cloud plan's, or nothing yet. */
export function helpersStatusLine(config: ConfigStatus | null): string {
  const decider = config?.decider;
  const extraction = config?.helpers?.extraction;
  const decisions = !decider?.configured ? t("decider.status.notSetUp")
    : decider.included ? t("decider.status.byCloud") : t(BY[decider.provider] ?? BY.jev);
  const reading = !extraction?.provider ? t("decider.status.notSetUp")
    : extraction.included ? t("decider.status.byCloud") : t(BY[extraction.provider]);
  return t("decider.status.line", { decisions, extraction: reading });
}

/** A fixed sentence per failure: the vendor's own body never reaches the UI. */
export function deciderFailureText(result: { reason: string; status?: number }, included = false, provider: Provider | "workersai" = "jev"): string {
  if (provider === "workersai") {
    if (result.reason === "http_error") return t("decider.workersAi.error.http", { status: String(result.status ?? "?") });
    const key = WORKERS_AI_FAILURES[result.reason];
    return key ? t(key) : t("decider.error.other");
  }
  if (provider === "openrouter") {
    // 402 is OpenRouter's answer for an account with no credits left.
    if (result.reason === "http_error" && result.status === 402) return t("decider.openrouter.error.credits");
    if (result.reason === "http_error") return t("decider.openrouter.error.http", { status: String(result.status ?? "?") });
    const key = OPENROUTER_FAILURES[result.reason];
    return key ? t(key) : t("decider.error.other");
  }
  if (included && result.reason === "http_error" && result.status === 402) return t("decider.included.error.subscription");
  if (included && INCLUDED_FAILURES[result.reason]) return t(INCLUDED_FAILURES[result.reason]!);
  if (result.reason === "http_error") return t("decider.error.http", { status: String(result.status ?? "?") });
  const key = FAILURES[result.reason];
  return key ? t(key) : t("decider.error.other");
}

export function DecisionModelSettings() {
  const { state, dispatch } = useStore();
  const decider = state.config?.decider;
  const provider: Provider = decider?.provider === "openrouter" ? "openrouter" : "jev";
  const openrouter = provider === "openrouter";
  const configured = decider?.configured ?? false;
  const included = configured && decider?.included === true;
  const usingShared = openrouter && configured && decider?.keySource === "shared";
  const sharedKey = openrouter && decider?.sharedKey === true;
  const ownKey = configured && !included && !usingShared;
  const enabled = decider?.enabled ?? false;
  const roomRouting = decider?.jobs.roomRouting ?? true;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<ModelList | null>(null);
  const [editing, setEditing] = useState(false);
  const draft = value.trim();
  const clearing = !draft && ownKey;
  const keyHint: LocaleKey | null = !openrouter || included
    ? null
    : usingShared
      ? "decider.openrouter.status.sharedHint"
      : !configured
        ? "decider.openrouter.status.notConnectedHint"
        : sharedKey
          ? "decider.openrouter.status.ownFallbackHint"
          : null;

  const applied = (config: ConfigStatus) => dispatch({ type: "configStatus", config });

  const patch = async (decision: Record<string, unknown>) => {
    if (switching) return;
    setSwitching(true);
    setError(null);
    try {
      applied(await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ decider: decision }) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSwitching(false);
    }
  };

  useEffect(() => {
    if (!openrouter || models) return;
    let cancelled = false;
    api<ModelList>("/api/decider/models").then(
      (list) => { if (!cancelled) setModels(list); },
      () => undefined,
    );
    return () => { cancelled = true; };
  }, [openrouter, models]);

  const choose = (decision: { provider: Provider } | { openrouterModel: string; openrouterApi: "chat" | "decisions" }) => {
    setValue("");
    setVerdict(null);
    void patch(decision);
  };

  const save = async () => {
    if (saving || (!draft && !ownKey)) return;
    setSaving(true);
    setError(null);
    setVerdict(null);
    try {
      const status = window.ogb?.setCredential
        ? await window.ogb.setCredential(openrouter ? "openrouterDeciderKey" : "jevApiKey", draft)
        : await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ decider: { [openrouter ? "openrouterKey" : "key"]: draft } }) });
      applied(status);
      setValue("");
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (testing || saving || (!draft && !configured)) return;
    setTesting(true);
    setVerdict(null);
    setError(null);
    const testingIncluded = !draft && included;
    const testingShared = !draft && usingShared;
    try {
      const result = await api<TestResult>("/api/decider/test", { method: "POST", body: JSON.stringify(draft ? { key: draft } : {}) });
      setVerdict(result.ok
        ? {
          ok: true,
          text: openrouter
            ? [
              t(testingShared ? "decider.openrouter.test.okShared" : "decider.openrouter.test.ok", { ms: String(result.latencyMs) }),
              ...(result.latencyMs > ROOM_BUDGET_MS ? [t("decider.test.slow")] : []),
            ].join(" ")
            : t("decider.test.ok", { ms: String(result.latencyMs) }),
        }
        : { ok: false, text: deciderFailureText(result, testingIncluded, provider) });
    } catch (cause) {
      setVerdict({ ok: false, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <SettingsRows>
        <SettingRow
          title={t(openrouter ? "decider.openrouter.master" : "decider.master")}
          subtitle={<span role="status" data-testid="helpers-status">{helpersStatusLine(state.config)}</span>}
        >
          <Switch
            data-testid="decider-master"
            aria-label={t(openrouter ? "decider.openrouter.master" : "decider.master")}
            checked={enabled}
            disabled={!configured || switching || !state.config}
            onClick={() => void patch({ enabled: !enabled })}
            className="cursor-pointer"
          />
        </SettingRow>
        <SettingRow title={t("decider.provider.label")}>
          <SettingsSelect
            data-testid="decider-provider"
            value={provider}
            onChange={(event) => choose({ provider: event.target.value === "openrouter" ? "openrouter" : "jev" })}
            disabled={switching || !state.config}
            aria-label={t("decider.provider.label")}
          >
            <option value="jev">{t("decider.provider.jev")}</option>
            <option value="openrouter">{t("decider.provider.openrouter")}</option>
          </SettingsSelect>
        </SettingRow>
        {openrouter && (
          <SettingRow title={t("decider.model.label")} subtitle={models?.source === "builtin" ? t("decider.model.builtinNote") : undefined}>
            <SettingsSelect
              data-testid="decider-model"
              value={decider?.model ?? ""}
              onChange={(event) => choose({
                openrouterModel: event.target.value,
                openrouterApi: models?.models.find((model) => model.id === event.target.value)?.api ?? "chat",
              })}
              disabled={switching}
              aria-label={t("decider.model.label")}
            >
              {decider?.model && !models?.models.some((model) => model.id === decider.model) && (
                <option value={decider.model}>{decider.model}</option>
              )}
              {(["recommended", "more"] as const).map((group) => {
                const inGroup = models?.models.filter((model) => model.group === group) ?? [];
                return inGroup.length > 0 && (
                  <optgroup key={group} label={t(group === "recommended" ? "decider.model.recommended" : "decider.model.more")}>
                    {inGroup.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </optgroup>
                );
              })}
            </SettingsSelect>
          </SettingRow>
        )}
        <SettingRow title={t("decider.jobs.roomRouting")}>
          <Switch
            data-testid="decider-job-roomRouting"
            aria-label={t("decider.jobs.roomRouting")}
            checked={enabled && roomRouting}
            disabled={!enabled || switching}
            onClick={() => void patch({ jobs: { roomRouting: !roomRouting } })}
            className="cursor-pointer"
          />
        </SettingRow>
      </SettingsRows>

      <RowsCard label={t(openrouter ? "decider.openrouter.key.label" : "decider.key.label")}>
        <ItemRow
          title={<span role="status">{included
            ? t("keys.includedWithCloudPro")
            : usingShared
              ? t("decider.openrouter.status.shared")
              : configured
                ? t(sharedKey ? "decider.openrouter.status.own" : "decider.status.connected")
                : t("decider.status.notConnected")}</span>}
          hint={keyHint ? t(keyHint) : undefined}
        >
          <button type="button" data-testid="decider-test" onClick={() => void test()} disabled={testing || saving || (!draft && !configured)} className="ui-button cursor-pointer">
            {testing ? t("keys.testing") : t("keys.test")}
          </button>
          <button type="button" data-testid="decider-key-open" onClick={() => { setError(null); setEditing(true); }} className="ui-button cursor-pointer">
            {ownKey ? t("settings.s2.key.replace") : t("settings.s2.key.add")}
          </button>
        </ItemRow>
        {keyHint && !ownKey && <NavRow data-testid="decider-manage-keys" title={t("decider.openrouter.key.manageLink")} onClick={() => dispatch(openKeySettings("openrouter"))} />}
        {error && !editing && <NoteRow tone="danger">{error}</NoteRow>}
        {verdict && <div role="status" className="contents"><NoteRow tone={verdict.ok ? undefined : "danger"}>{verdict.text}</NoteRow></div>}
        {!usingShared && <NavRow external title={t(openrouter ? "decider.openrouter.key.getKey" : "decider.key.getKey")} onClick={() => void openExternalLink(KEY_URL[provider])} />}
      </RowsCard>
      {editing && (
        <FormDialog
          data-panel-modal="decider-key"
          title={t(openrouter ? "decider.openrouter.key.label" : "decider.key.label")}
          description={ownKey ? t("settings.s2.key.paste") : undefined}
          saveLabel={clearing ? t("keys.clear") : t("common.save")}
          canSave={Boolean(draft) || ownKey}
          busy={saving}
          error={error ?? undefined}
          onSave={save}
          onClose={() => { setEditing(false); setValue(""); }}
        >
          <FormField label={t(openrouter ? "decider.openrouter.key.label" : "decider.key.label")}>
            <input
              type="password"
              value={value}
              onChange={(event) => { setVerdict(null); setError(null); setValue(event.target.value); }}
              disabled={saving}
              placeholder={ownKey ? t("keys.replace") : t(usingShared ? "decider.openrouter.key.overridePlaceholder" : openrouter ? "decider.openrouter.key.placeholder" : "decider.key.placeholder")}
              aria-label={t(openrouter ? "decider.openrouter.key.label" : "decider.key.label")}
              autoComplete="off"
              spellCheck={false}
              className={textFieldCls}
            />
          </FormField>
        </FormDialog>
      )}

      <WorkersAiKeyCard failureText={(result) => deciderFailureText(result, false, "workersai")} />
    </>
  );
}
