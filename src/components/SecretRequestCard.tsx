import { useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, KeyRound, Loader2, LockKeyhole, RefreshCw } from "lucide-react";

import { CUSTOM_SECRET_TARGET, credentialResumeOutcome, credentialSaveRequest, desktopCredentialSlot, isConfigCredentialTarget, isCredentialTargetId } from "../../shared/credential-request";
import { credentialProvider } from "@/lib/analytics-allowlist";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { keySaved, keySaveFailure, savedKeyResult } from "@/lib/product-events";
import { api, useStore, type Bot, type ConfigStatus, type Message } from "@/state/store";
import { ASK_FIELD, askPrimary, ASK_QUIET_BUTTON, AskCard, returnFocusToComposer } from "./AskCard";
import { EmailServerInputs } from "./EmailCard";
import type { EmailServerFields } from "../../shared/email";
import { productName } from "@/lib/brand";
import { sealCardSecret, SealTrustError } from "@/lib/card-seal";
import type { CardSealKey } from "../../shared/saved-secrets";
import { GrokIcon } from "./GrokIcon";

// Security: the value goes straight to the host's settings, never into the chat. A custom secret leaves this app only
// sealed for the server that keeps it, so a relay between them (the VPS tunnel, a Cloud's proxy) never reads it.

/** Grok's settled secret line: a key in a small rounded square, "Secrets", then one grey line with what happened. */
export function SecretSettledRow({ label, status, tone = "done", title, action, detail }: {
  label: string;
  status: string;
  tone?: "done" | "off" | "failed";
  title?: string;
  action?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} data-ask-card="settled" data-secret-row={tone} className="w-full max-w-[560px] text-start text-[13px] leading-[18px]">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-ink/10 text-ink-secondary">
          <GrokIcon name="key" size={14} />
        </span>
        <span className="shrink-0 text-ink">{t("secretCard.title")}</span>
        <span dir="auto" aria-live="polite" title={title} className={cn("min-w-0 truncate", tone === "failed" ? "text-danger" : "text-ink-tertiary")}>{status}</span>
        {action}
      </div>
      {detail}
    </div>
  );
}

export function SecretRequestCard({
  botId,
  color,
  threadId,
  message,
}: {
  botId: string;
  color?: Bot["color"];
  threadId: string;
  message: Message;
}) {
  const { dispatch } = useStore();
  const secret = message.secret!;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const email = secret.delivery === "email";
  const [address, setAddress] = useState(secret.address ?? "");
  const [server, setServer] = useState<EmailServerFields>({});
  const [needsServer, setNeedsServer] = useState(false);
  // Grok's default: a custom secret is saved to the Vault so the bot can use it again; off, it is used once and forgotten.
  const [remember, setRemember] = useState(true);
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/secret-cards/${encodeURIComponent(message.id)}`;
  const error = localError ?? secret.error;
  const custom = secret.target === CUSTOM_SECRET_TARGET;
  // A page reached through a desktop paired to another computer: a key that computer keeps in its own encrypted store can
  // only be typed there. Anything its server keeps, a custom secret or a provider key, is typed here like on any page.
  const onlyOnHost = window.ogb?.remoteClient?.active === true && secret.target !== CUSTOM_SECRET_TARGET && desktopCredentialSlot(secret.target) !== null;
  const outcome = credentialResumeOutcome(secret);
  const provided = outcome === "provided";
  const declined = outcome === "dismissed";
  const superseded = secret.superseded === true;
  const stopped = secret.stopped === true;
  const description = superseded
    ? "This request was replaced by a newer one for the same key. Use the newest card to provide it."
    : provided
    ? stopped
      ? "Saved securely."
      : secret.resumed
      ? "Saved securely. Your bot is continuing the task."
      : "Saved securely. Your bot will continue when its current turn settles."
    : declined
      ? `You chose not to provide this credential. ${productName()} could not resume the bot yet.`
      : custom && secret.reason ? secret.reason : secret.description;
  if (!custom && !isCredentialTargetId(secret.target)) return <SecretSettledRow label={secret.label} tone="off" status="This credential request is no longer supported." />;

  const notifyProvided = async () => {
    await api(`${endpoint}/provided`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    });
  };

  const retryResume = async () => {
    if (saving) return;
    setSaving(true);
    setLocalError(null);
    try {
      await api(`${endpoint}/resume`, {
        method: "POST",
        body: JSON.stringify({ threadId }),
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  // Kept behind the card on the server, never in Settings; saving it resumes the bot, and no product event names it.
  const saveCustom = async () => {
    if (saving || !value.trim()) return;
    setSaving(true);
    setLocalError(null);
    try {
      // A password goes as typed: a mailbox's can begin or end with a space.
      const typed = email ? value : value.trim();
      const keep = !email && remember;
      const send = async (key: CardSealKey) => {
        const sealed = await sealCardSecret(typed, key, { botId, threadId, messageId: message.id, requestKey: secret.requestKey, remember: keep });
        return api(`${endpoint}/save`, { method: "POST", body: JSON.stringify(email ? { threadId, sealed, address: address.trim(), ...server } : { threadId, sealed, remember: keep }) });
      };
      const prepared = await api(`${endpoint}/save`, { method: "POST", body: JSON.stringify({ threadId, prepare: true }) }) as { sealKey: CardSealKey };
      try {
        await send(prepared.sealKey);
      } catch (error) {
        // The server restarted between the two steps: seal once more for its new key.
        const fresh = (error as { body?: { sealKey?: CardSealKey } }).body?.sealKey;
        if (!fresh || fresh.keyId === prepared.sealKey.keyId) throw error;
        await send(fresh);
      }
      setValue("");
      returnFocusToComposer();
    } catch (error) {
      if ((error as { body?: { needsServer?: unknown } }).body?.needsServer === true) setNeedsServer(true);
      setLocalError(error instanceof SealTrustError ? t("seal.untrusted") : error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (custom) return saveCustom();
    if (saving || (!value.trim() && !savedLocally)) return;
    setSaving(true);
    setLocalError(null);
    const provider = credentialProvider(secret.target);
    let saved = savedLocally;
    try {
      if (!savedLocally && secret.target !== CUSTOM_SECRET_TARGET) {
        const next = value.trim();
        const target = secret.target;
        // The 1Password token goes to this server's Logins, which checks it with 1Password first, never the settings file.
        const request = credentialSaveRequest(target, next);
        const slot = desktopCredentialSlot(target);
        if (isConfigCredentialTarget(target)) {
          const status: ConfigStatus = slot && window.ogb?.setCredential
            ? await window.ogb.setCredential(slot, next)
            : await api(request.path, { method: request.method, body: JSON.stringify(request.body) });
          dispatch({ type: "configStatus", config: status });
        } else await api(request.path, { method: request.method, body: JSON.stringify(request.body) });
        saved = true;
        keySaved(provider, "chat_request", savedKeyResult(provider));
        setValue("");
        setSavedLocally(true);
      }
      await notifyProvided();
      returnFocusToComposer();
    } catch (error) {
      if (!saved) keySaved(provider, "chat_request", keySaveFailure(error));
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const dismiss = () => {
    void api(`${endpoint}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    }).catch(() => {});
  };

  if (superseded) {
    return <SecretSettledRow label={secret.label} tone="off" title={description} status={t("secretCard.replaced", { label: secret.label })} />;
  }

  if (stopped && !provided) {
    return <SecretSettledRow label={secret.label} tone="off" title={secret.description} status={t("secretCard.stopped", { label: secret.label })} />;
  }

  if (provided || declined) {
    const retry = !secret.resumed && !stopped && error ? (
      <button type="button" onClick={() => void retryResume()} disabled={saving} className={cn(ASK_QUIET_BUTTON, "text-accent-text")}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {t("common.tryAgain")}
      </button>
    ) : undefined;
    const status = declined
      ? t("secretCard.cancelled", { label: secret.label })
      : t(secret.kept === "once" ? "secretCard.usedOnce" : "secretCard.saved", { label: secret.label });
    return (
      <SecretSettledRow
        label={secret.label}
        tone={declined ? "off" : "done"}
        title={description}
        status={status}
        action={retry}
        detail={error && <p role="alert" className="ms-8 mt-1 text-[12px] text-danger">{t("secretCard.resumeFailed")}: {error}</p>}
      />
    );
  }

  return (
    <AskCard
      ariaLabel={secret.label}
      icon={<KeyRound size={15} />}
      title={secret.label}
      explanation={description}
      onDismiss={dismiss}
      dismissLabel="Not now"
      stays
    >
      {onlyOnHost ? (
        <div className="text-[13px] leading-relaxed text-ink-secondary">
          This key must be saved on the host computer. Open this conversation on the host to continue securely.
        </div>
      ) : (
        <form onSubmit={(event) => void save(event)}>
          {email && (
            <div className="mb-2 flex flex-col gap-2">
              <input type="email" autoComplete="off" spellCheck={false} dir="ltr" value={address} onChange={(event) => setAddress(event.target.value)} placeholder={t("email.address")} disabled={saving} aria-label={t("email.address")} className={cn(ASK_FIELD, "w-full")} />
              {needsServer && <EmailServerInputs value={server} onChange={setServer} className={cn(ASK_FIELD, "w-full")} />}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              dir="ltr"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={secret.placeholder}
              disabled={saving || savedLocally}
              aria-label={secret.label}
              className={cn(ASK_FIELD, "min-w-[10rem] flex-1")}
            />
            <button type="submit" disabled={saving || (!value.trim() && !savedLocally) || (email && !address.trim())} {...askPrimary(color)}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
              {savedLocally ? "Continue task" : custom ? t("secretCard.submit") : "Save securely"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-tertiary">
            <span className="flex items-center gap-1">
              <LockKeyhole size={11} />{" "}
              {!custom ? `Stored securely by ${productName()} and never added to chat.` : email ? t("secretCard.email") : secret.delivery === "file" ? t("secretCard.file") : t("secretCard.ref")}
            </span>
            {custom && !email && (
              <label className="ms-auto inline-flex cursor-pointer items-center gap-1.5 text-ink-secondary" data-secret-remember="">
                <input type="checkbox" checked={remember} disabled={saving} onChange={(event) => setRemember(event.target.checked)} className="size-3.5 accent-current" />
                {t("secretCard.saveToVault")}
              </label>
            )}
            {secret.helpUrl && (
              <a
                href={secret.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent-text hover:underline"
              >
                Where to get this key <ExternalLink size={11} />
              </a>
            )}
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </AskCard>
  );
}
