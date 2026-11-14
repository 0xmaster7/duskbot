import { useState } from "react";
import { Loader2 } from "../../icons";
import { requiredFields, type Place } from "../../../shared/model-providers";
import { useStore, type InstanceInfo } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { friendlyError } from "@/lib/plain-error";
import { connectProvider, listModels, listVerdict, placeLine, type ProviderFields, type ProviderInfo } from "@/lib/model-providers";
import { FormDialog, FormField } from "../ListRows";
import { textFieldCls } from "../ui/GrokDialog";

const FIELD = cn(textFieldCls, "bg-ink/[0.04]");

/** The short sheet that connects one provider on the server the bots run on: a sign-in where the provider has one, else
 * its details and key, an optional check that lists its models, and Connect. */
export function ConnectProviderDialog({ provider, place, model, onClose, onConnected }: {
  provider: ProviderInfo;
  place: Place;
  /** A model the person picked from the search, kept as the connection's model for a custom endpoint. */
  model?: string;
  onClose: () => void;
  onConnected?: (instanceId: string, instances: InstanceInfo[]) => void;
}) {
  const { dispatch, refreshInstances } = useStore();
  const [fields, setFields] = useState<ProviderFields>(model && provider.section === "custom" ? { model } : {});
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; text: string } | "checking" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsKey = !provider.keyless;
  const ready = requiredFields(provider).every((field) => fields[field.id]?.trim()) && (!needsKey || key.trim().length > 0);

  const set = (id: keyof ProviderFields, value: string) => {
    setFields((current) => ({ ...current, [id]: value }));
    setCheck(null);
  };

  const runCheck = () => {
    if (!ready || check === "checking") return;
    setCheck("checking");
    listModels(provider.id, fields, key)
      .then((answer) => setCheck(listVerdict(answer)))
      .catch((cause: unknown) => setCheck({ ok: false, text: friendlyError(cause, t("models.check.unexpected")) }));
  };

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await connectProvider(provider.id, fields, key, []);
      if (Array.isArray(answer.instances)) dispatch({ type: "instances", instances: answer.instances as InstanceInfo[] });
      else await refreshInstances({ reportErrors: true });
      onConnected?.(answer.instanceId, Array.isArray(answer.instances) ? answer.instances as InstanceInfo[] : []);
      onClose();
    } catch (cause) {
      setError(friendlyError(cause, t("models.connect.failed")));
    } finally {
      setBusy(false);
    }
  };

  const openSignIn = () => {
    onClose();
    dispatch({ type: "toggleAppSettings", open: true, section: "engines" });
  };

  return (
    <FormDialog
      data-panel-modal="connect-provider"
      title={t("models.connect.title", { name: provider.label })}
      description={[provider.note, placeLine(place)].filter(Boolean).join(" ")}
      saveLabel={busy ? t("models.connect.saving") : t("models.connect.save")}
      canSave={ready}
      busy={busy}
      error={error}
      onSave={save}
      onClose={onClose}
    >
      {provider.signIn && (
        <div className="flex flex-col gap-1.5">
          <button type="button" data-connect-sign-in onClick={openSignIn}
            className="h-8 rounded-[10px] bg-ink/[0.06] px-3 text-[13px] leading-[18px] text-ink hover:bg-ink/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {provider.signIn.label}
          </button>
          <p className="m-0 text-center text-[12px] leading-4 text-ink-tertiary">{t("models.connect.orKey")}</p>
        </div>
      )}
      {(provider.fields ?? []).map((field) => (
        <FormField key={field.id} label={field.optional ? t("models.connect.optional", { label: field.label }) : field.label}>
          <input data-connect-field={field.id} value={fields[field.id] ?? ""} onChange={(event) => set(field.id, event.target.value)}
            placeholder={field.placeholder} spellCheck={false} autoComplete="off" className={cn(FIELD, field.id !== "model" && "font-mono text-[12px] placeholder:font-sans")} />
        </FormField>
      ))}
      {needsKey && (
        <FormField label={t("models.connect.key")}>
          <input data-connect-key type="password" value={key} onChange={(event) => { setKey(event.target.value); setCheck(null); }}
            placeholder={provider.keyPlaceholder ?? "…"} spellCheck={false} autoComplete="off" className={cn(FIELD, "font-mono text-[12px] placeholder:font-sans")} />
        </FormField>
      )}
      <div className="flex min-h-5 items-center gap-3 text-[12px] leading-4">
        {provider.keyUrl && needsKey && (
          <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-ink-secondary underline-offset-2 hover:text-ink hover:underline">
            {t("models.connect.getKey")}
          </a>
        )}
        <button type="button" data-connect-check disabled={!ready || check === "checking"} onClick={runCheck}
          className="text-ink-secondary underline-offset-2 enabled:hover:text-ink enabled:hover:underline disabled:opacity-45">
          {t("models.connect.check")}
        </button>
        {check === "checking" && <Loader2 size={13} className="animate-spin text-ink-tertiary" aria-label={t("models.connect.checking")} />}
        {check && check !== "checking" && (
          <span role="status" data-connect-check-result={check.ok ? "ok" : "failed"} className={cn("min-w-0 truncate", check.ok ? "text-ink-secondary" : "text-danger")}>{check.text}</span>
        )}
      </div>
    </FormDialog>
  );
}
