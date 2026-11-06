import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { Switch } from "../SettingsPrimitives";
import { FormDialog } from "../ListRows";
import { fieldLabelCls, smallButtonCls, textFieldCls } from "../ui/GrokDialog";
import type { KeyEntry } from "./key-catalog";
import { KEY_FIELD, KeyMarkIcon, KeyPlainRow } from "./KeyRow";
import { cleanKey, looksLikeKey } from "./key-save";

/** Security: write-only; the server returns names, never keys, and hands the keys to OpenCode alone. */
export function OpenCodeProviderKeys() {
  const { state, dispatch } = useStore();
  const names = state.config?.opencodeGo?.providerKeys ?? [];
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = adding || removing !== null;

  const put = (target: string, value: string) =>
    api("/api/config", { method: "PUT", body: JSON.stringify({ opencodeGo: { providerKeys: { [target]: value } } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }));

  const add = () => {
    const target = name.trim().toUpperCase();
    const value = cleanKey(key);
    if (busy || !target || !value) return;
    if (!looksLikeKey(value)) {
      setError(t("keys.notAKey"));
      return;
    }
    setAdding(true);
    setError(null);
    put(target, value)
      .then(() => { setName(""); setKey(""); })
      .catch((e) => setError(e.message))
      .finally(() => setAdding(false));
  };

  const remove = (target: string) => {
    if (busy) return;
    setRemoving(target);
    setError(null);
    put(target, "")
      .catch((e) => setError(e.message))
      .finally(() => setRemoving(null));
  };

  return (
    <div data-opencode-provider-keys className="flex flex-col gap-2">
      {state.config?.cloudHome !== true && (
        <p className="text-[12px] leading-4 text-ink-secondary">
          {t("settings.w6b.opencode.providersHint").split("{command}").flatMap((part, index) =>
            index === 0 ? [part] : [<code key={index} className="font-mono">opencode auth login</code>, part])}
        </p>
      )}
      {names.map((saved) => (
        <div key={saved} data-opencode-provider-key={saved} className="flex flex-wrap items-center gap-2">
          <span className={cn(KEY_FIELD, "block flex-1 truncate text-ink")}>{saved}</span>
          <button
            type="button"
            onClick={() => remove(saved)}
            disabled={busy}
            aria-label={t("keys.opencode.otherProviders.removeAria", { name: saved })}
            className="ui-button shrink-0"
          >
            {removing === saved ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : t("keys.row.remove")}
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => { setError(null); setName(e.target.value); }}
          onKeyDown={(e) => e.key === "Enter" && add()}
          disabled={busy}
          placeholder="VENICE_API_KEY"
          aria-label={t("keys.opencode.otherProviders.name")}
          autoComplete="off"
          spellCheck={false}
          className={cn(KEY_FIELD, "w-auto min-w-[min(100%,10rem)] flex-1 uppercase placeholder:normal-case")}
        />
        <input
          type="password"
          value={key}
          onChange={(e) => { setError(null); setKey(e.target.value); }}
          onKeyDown={(e) => e.key === "Enter" && add()}
          disabled={busy}
          placeholder={t("keys.opencode.otherProviders.keyPlaceholder")}
          aria-label={t("keys.opencode.otherProviders.key")}
          autoComplete="off"
          className={cn(KEY_FIELD, "w-auto min-w-[min(100%,10rem)] flex-1")}
        />
        <button type="button" onClick={add} disabled={busy || !name.trim() || !key.trim()} className="ui-button ui-button-primary shrink-0">
          {adding ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : t("common.save")}
        </button>
      </div>
      {error && <div role="alert" className="text-[12px] leading-4 text-danger">{error}</div>}
    </div>
  );
}

export function AnthropicEveryClaudeBot() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.config?.anthropic?.configured) return null;
  const on = state.config.anthropic.everyClaudeBot === true;
  const toggle = () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ anthropic: { everyClaudeBot: !on } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };
  return (
    <div data-anthropic-every-claude-bot className="flex flex-col gap-1.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-[18px] text-ink">{t("keys.anthropic.everyBot")}</div>
          <div className="text-[12px] leading-4 text-ink-secondary">{on ? t("keys.anthropic.everyBotOn") : t("keys.anthropic.everyBotOff")}</div>
        </div>
        <Switch checked={on} disabled={saving} onClick={toggle} aria-label={t("keys.anthropic.everyBot")} />
      </div>
      {on && (
        <p className="flex gap-1.5 text-[12px] leading-4 text-warning">
          <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden="true" />
          <span>{t("keys.anthropic.warning")}</span>
        </p>
      )}
      {error && <div role="alert" className="text-[12px] leading-4 text-danger">{error}</div>}
    </div>
  );
}

/** Non-secret Docker-over-SSH target. Keys and passwords stay with SSH. The row shows the alias; Set up opens its field. */
export function VpsRow({ entry }: { entry: KeyEntry }) {
  const { state, dispatch } = useStore();
  const titleId = useId();
  const savedAlias = state.config?.vps?.sshAlias ?? "";
  const configured = Boolean(state.config?.vps?.configured);
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearing = !alias.trim() && configured;
  const name = t(entry.labelKey);
  const action = configured ? t("keys.row.change") : t("keys.row.setUp");

  const start = () => {
    setAlias(savedAlias);
    setError(null);
    setOpen(true);
  };

  const save = () => {
    if (saving || (!alias.trim() && !configured)) return;
    setSaving(true);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ vps: { sshAlias: alias.trim() } }) })
      .then((status: ConfigStatus) => {
        dispatch({ type: "configStatus", config: status });
        setOpen(false);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <KeyPlainRow data-key-row={entry.id} titleId={titleId} mark={<KeyMarkIcon entry={entry} />} title={name}
      hint={configured ? t("keys.connected") : t("keys.row.notConnected")} value={configured ? savedAlias : undefined}
      actions={<button type="button" data-key-open="" className={smallButtonCls} aria-label={`${action}: ${name}`} onClick={start}>{action}</button>}>
      {open && (
        <FormDialog data-panel-modal="vps" title={name} description={t("settings.w6b.vps.desc")}
          saveLabel={clearing ? t("keys.row.remove") : t("common.save")}
          canSave={(Boolean(alias.trim()) || configured) && alias.trim() !== savedAlias}
          busy={saving} error={error} onSave={save} onClose={() => { if (!saving) setOpen(false); }}>
          <div data-key-dialog={entry.id} className="flex flex-col gap-1">
            <label htmlFor={`${titleId}-alias`} className={fieldLabelCls}>{t("keys.vps.aria")}</label>
            <input
              id={`${titleId}-alias`}
              type="text"
              data-key-input
              data-autofocus=""
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="my-vps"
              autoComplete="off"
              spellCheck={false}
              className={textFieldCls}
            />
          </div>
          <a href="https://github.com/milind-soni/OpenMausBot/blob/main/docs/byo-vps.md" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 self-start rounded-sm text-[12px] leading-4 text-ink-secondary transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
            {t("settings.w6b.vps.guide")}<ExternalLink size={11} aria-hidden="true" />
          </a>
        </FormDialog>
      )}
    </KeyPlainRow>
  );
}

export function OpenAiCompatUrl() {
  const { state, dispatch } = useStore();
  const saved = state.config?.openaiCompat?.url ?? "";
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  useEffect(() => { setValue(saved); }, [saved]);
  const dirty = value.trim() !== saved;

  const save = () => {
    if (savingRef.current || !dirty) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ openaiCompat: { url: value.trim() } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e) => setError(e.message))
      .finally(() => { savingRef.current = false; setSaving(false); });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[13px] leading-[18px] text-ink">{t("keys.openaiCompat.url")}</div>
      <div className="relative">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="https://api.groq.com/openai/v1"
          aria-label={t("keys.openaiCompat.url")}
          spellCheck={false}
          className={cn(KEY_FIELD, "pr-8")}
        />
        {saving && <Loader2 size={13} aria-hidden="true" className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-ink-secondary" />}
      </div>
      <p className="text-[12px] leading-4 text-ink-secondary">{t("keys.openaiCompat.urlHint")}</p>
      {error && <div role="alert" className="text-[12px] leading-4 text-danger">{error}</div>}
    </div>
  );
}
