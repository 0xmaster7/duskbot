import { useState } from "react";
import { Check, Copy, RotateCw } from "lucide-react";

import { automationStatus, automationSubtitle, capital, lastReceived, lastWhen, runLine, STATUS_WORD, webhookCalls, type Automation } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { loadWebhookCredentials, webhookCredentialStore } from "@/lib/webhook-credentials";
import { useStore } from "@/state/store";
import { AppEventsSection } from "./AppEventsSection";
import { useAllAutomationActions } from "./app-actions";
import { FixButton, StatusMark } from "./parts";
import { GrokIcon } from "../GrokIcon";
import { mdPrimaryCls, mdSecondaryCls } from "../ui/GrokDialog";

const RECENT = 5;
const LABEL = "m-0 mb-1 text-[12px] font-normal leading-4 tracking-[0.01em] text-ink/56";

/** One automation, simply: its sentence, its status, the last five runs, and what can be done to it. */
export function AutomationPanel({ automation, sentence, onClose, onEdit, onDeleted }: {
  automation: Automation;
  sentence: string;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { state } = useStore();
  const actions = useAllAutomationActions();
  const status = automationStatus(automation);
  const webhook = automation.kind === "webhook" ? state.webhooks.find((candidate) => candidate.id === automation.id) : undefined;
  const credential = webhook ? loadWebhookCredentials(webhookCredentialStore())[webhook.id] : undefined;
  const receiving = state.webhookIngress?.available !== false;
  const statusWord = t(STATUS_WORD[status.state]);
  const name = automation.name.trim();
  const botName = state.bots.find((bot) => bot.id === automation.botId)?.name ?? t("routines.unavailableBot");
  const instructions = automation.instructions.trim();
  const reason = status.state === "done" ? t("automations.reason.done") : status.reason;
  const calls = webhook ? webhookCalls(webhook.id, state.webhookAttempts) : [];
  const received = webhook ? lastReceived(webhook, state.webhookAttempts) : null;
  const [openCall, setOpenCall] = useState<string | null>(null);
  // Shown only on Show: More is opened for Recent calls, often on a shared screen.
  const [secretShown, setSecretShown] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const copySecret = async (secret: string) => {
    if (await copyText(secret) !== "copied") { actions.setError(t("automations.address.copyFailed")); return; }
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 1_800);
  };

  return (
    <aside aria-label={t("automations.panel.label")} className="flex h-full w-[min(380px,100vw)] shrink-0 flex-col border-l border-ink/8 bg-panel">
      <div className="flex items-start gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 pt-1.5 text-[14px] font-semibold leading-5 tracking-[0.01em] text-ink">{name || sentence}</h2>
          {name && <p className="m-0 mt-0.5 text-[12px] leading-4 text-ink/56">{automationSubtitle(automation, botName)}</p>}
        </div>
        <button type="button" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink/68 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" aria-label={t("automations.panel.close")}><GrokIcon name="close" size={14} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px]" data-automation-status={status.state}>
          <StatusMark status={status} />
          <span className={cn("font-medium", status.state === "needs-you" ? "text-warning" : "text-ink")}>{statusWord}</span>
          {reason && <span className="min-w-0 text-ink-secondary">{reason}</span>}
          <FixButton automation={automation} status={status} actions={actions} onEdit={onEdit} />
        </div>

        {webhook && (
          <section>
            <h3 className={LABEL}>{t("automations.address.title")}</h3>
            <button type="button" disabled={Boolean(actions.busy) || !receiving} onClick={() => void actions.copyAddress(webhook.id)} className={cn(mdPrimaryCls, "mt-1")}>
              {actions.copied === webhook.id ? <Check size={14} /> : <Copy size={14} />}
              {actions.copied === webhook.id ? t("automations.address.copied") : t("automations.address.copy")}
            </button>
            {(!receiving || !state.config?.cloudHome) && <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{receiving ? t("automations.address.keepOpen") : t("automations.address.unavailable")}</p>}
            <details className="mt-2.5 text-[12px] text-ink-secondary">
              <summary className="cursor-pointer select-none font-medium text-ink-secondary hover:text-ink">{t("automations.more")}</summary>
              <div className="mt-2 space-y-2 leading-relaxed">
                {received && (
                  <section aria-label={t("automations.received.title")}>
                    <p className="font-medium text-ink">{t("automations.received.title")} · {lastWhen(received.at)}</p>
                    <p className="mt-0.5">{t("automations.received.help")}</p>
                    <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-ink/4 px-3 py-2 font-mono text-[12px] leading-[18px] text-ink/68">{received.preview.slice(0, 1_000)}</pre>
                  </section>
                )}
                <section aria-label={t("automations.calls.title")}>
                  <p className="font-medium text-ink">{t("automations.calls.title")}</p>
                  {calls.length === 0 ? <p className="mt-0.5">{t("automations.calls.none")}</p> : (
                    <ul className="mt-1 space-y-0.5">{calls.map((call) => (
                      <li key={call.id} data-call={call.ok ? "ok" : "refused"}>
                        <button type="button" aria-expanded={openCall === call.id} onClick={() => setOpenCall((current) => (current === call.id ? null : call.id))} className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-raised">
                          <span className="shrink-0">{capital(lastWhen(call.at))}</span>
                          <span className={cn("shrink-0 font-semibold", call.ok ? "text-success" : "text-danger")}>{call.ok ? "✓" : "✗"}</span>
                          <span className="min-w-0 truncate text-ink">{call.reason}</span>
                        </button>
                        {openCall === call.id && <pre className="mx-1.5 mb-1 whitespace-pre-wrap break-all rounded-[8px] bg-ink/4 px-3 py-2 font-mono text-[12px] leading-[18px] text-ink/68">{call.preview || t("automations.calls.empty")}</pre>}
                      </li>
                    ))}</ul>
                  )}
                </section>
                <p className="font-medium text-ink">{t("automations.address.showSecret")}</p>
                {credential ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-secret={secretShown ? "shown" : "masked"}>
                    <span className="min-w-0 break-all font-mono text-[11px]">{t("automations.address.secret", { secret: secretShown ? credential.secret : "••••••••" })}</span>
                    <button type="button" aria-label={t(secretShown ? "automations.address.hideSecretLabel" : "automations.address.showSecretLabel")} onClick={() => setSecretShown((shown) => !shown)} className="rounded-md px-1.5 py-0.5 font-medium text-ink hover:bg-raised">{t(secretShown ? "automations.address.hideSecret" : "automations.address.revealSecret")}</button>
                    <button type="button" aria-label={t("automations.address.copySecretLabel")} onClick={() => void copySecret(credential.secret)} className="rounded-md px-1.5 py-0.5 font-medium text-ink hover:bg-raised">{secretCopied ? t("automations.address.copied") : t("automations.address.copySecret")}</button>
                  </div>
                ) : <p className="break-all font-mono text-[11px]">{t("automations.address.secretUnknown")}</p>}
                <p>{t("automations.address.header")}</p>
                {webhook.eventTypes?.length ? <p>{t("automations.address.events", { events: webhook.eventTypes.join(", ") })}</p> : null}
                <button type="button" disabled={Boolean(actions.busy)} onClick={() => { if (window.confirm(t("automations.address.replaceConfirm"))) void actions.copyAddress(webhook.id, true); }} className="flex items-center gap-1.5 rounded-lg border border-hairline/50 px-2.5 py-1.5 text-ink hover:bg-raised"><RotateCw size={12} />{t("automations.address.replace")}</button>
              </div>
            </details>
          </section>
        )}

        {name && instructions && <p data-testid="automation-instructions" className="whitespace-pre-wrap break-words text-[13px] leading-[18px] text-ink">{instructions}</p>}

        {automation.appTrigger && <AppEventsSection trigger={automation.appTrigger} />}

        <section>
          <h3 className={LABEL}>{t("automations.panel.recent")}</h3>
          {automation.runs.length === 0
            ? <p className="text-[13px] leading-[18px] text-ink/68">{t("automations.panel.noRuns")}</p>
            : <ul className="space-y-1">{automation.runs.slice(0, RECENT).map((run) => {
              const line = runLine(run);
              return (
                <li key={run.id}>
                  <button type="button" disabled={!run.threadId} onClick={() => actions.openRun(automation, run)} title={run.threadId ? t("automations.panel.open") : undefined}
                    className="-mx-2 flex w-[calc(100%+16px)] items-baseline gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] leading-[18px] transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5 disabled:hover:bg-transparent">
                    <span className="shrink-0 text-ink/68">{line.when}</span>
                    <span className={cn("shrink-0 font-semibold", line.mark === "✓" ? "text-success" : line.mark === "✗" ? "text-danger" : "text-warning")}>{line.mark}</span>
                    <span className="min-w-0 truncate text-ink">{line.text}</span>
                  </button>
                </li>
              );
            })}</ul>}
        </section>
        {actions.error && <p role="alert" className="text-[12px] leading-4 text-danger">{actions.error}</p>}
      </div>

      <div className="flex items-center gap-2 px-4 pb-4 pt-2.5">
        <button type="button" disabled={Boolean(actions.busy)} onClick={() => void actions.runNow(automation)} className={cn(mdPrimaryCls, "min-w-0 flex-1")}>{actions.busy === `run:${automation.id}` ? t("automations.starting") : t("automations.runNow")}</button>
        {status.state !== "done" && <button type="button" disabled={Boolean(actions.busy)} onClick={() => void actions.toggle(automation)} className={cn(mdSecondaryCls, "min-w-0 flex-1")}>{automation.enabled ? t("automations.pause") : t("automations.resume")}</button>}
        <button type="button" onClick={onEdit} className={cn(mdSecondaryCls, "min-w-0 flex-1")}>{t("automations.edit")}</button>
        <button type="button" disabled={Boolean(actions.busy)} onClick={() => void actions.remove(automation, t("automations.deleteConfirm", { sentence })).then((gone) => { if (gone) onDeleted(); })} aria-label={t("automations.delete")} title={t("automations.delete")} className={cn(mdSecondaryCls, "w-8 px-0 text-danger")}><GrokIcon name="trash" size={14} /></button>
      </div>
    </aside>
  );
}
