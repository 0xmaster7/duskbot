import { useCallback, useEffect, useRef, useState } from "react";

import { api, type Bot, type Message } from "@/state/store";
import { ApiError } from "@/state/api";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { AUTHORIZATION_LINK_MS, reserveConnectionPage, reusableConnectionUrl, type PendingAuthorization } from "@/lib/connector-oauth";
import { accountAliasTaken, requiresAccountAlias } from "@/lib/connector-status";
import { mcpSignInLink } from "@/lib/mcp-sign-in";
import { cn } from "@/lib/cn";
import { CARD_FIELD } from "./AskCard";
import { CardHint } from "./CardHint";
import { ServiceTile } from "./ServiceIcon";
import { appLogo } from "./connect-apps/logos";
import { openConnectApps } from "./connect-apps/open";
import { Icon } from "./Icon";
import { friendlyError } from "@/lib/plain-error";

const STATUS_CHECK_MS = 4_000;
/** Composio marks an unfinished account EXPIRED shortly after its link lapses; the card keeps asking until it can say so. */
const STATUS_WATCH_MS = AUTHORIZATION_LINK_MS + 2 * 60 * 1_000;

export function ConnectorCard({ botId, threadId, message }: { botId: string; color?: Bot["color"]; threadId: string; message: Message }) {
  const connector = message.connector!;
  const gone = connector.dismissed || connector.superseded;
  const isMcp = connector.source === "mcp";
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | { key: LocaleKey } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<(PendingAuthorization & { target: string }) | null>(null);
  const [label, setLabel] = useState("");
  const polling = useRef(false);
  const opening = useRef<ReturnType<typeof reserveConnectionPage> | null>(null);

  const endpoint = `/api/bots/${encodeURIComponent(botId)}/connector-cards/${encodeURIComponent(message.id)}`;
  const target = `${endpoint}?threadId=${encodeURIComponent(threadId)}`;
  const currentTarget = useRef(target);
  currentTarget.current = target;
  const pendingAuthorization = authorization?.target === target && connector.status !== "failed" && connector.status !== "connected" && !gone
    ? authorization : null;
  const authorizationUrl = reusableConnectionUrl(pendingAuthorization);
  useEffect(() => {
    setBusy(false);
    setLocalError(null);
    setRefusal(null);
    setAuthorization(null);
    setLabel("");
    return () => {
      opening.current?.cancel();
      opening.current = null;
    };
  }, [target, gone]);
  const checkStatus = useCallback(async () => {
    const result = await api(`${endpoint}/status?threadId=${encodeURIComponent(threadId)}`);
    return Boolean(result.connected);
  }, [endpoint, threadId]);

  useEffect(() => {
    if (connector.status !== "authorizing" || gone) return;
    polling.current = true;
    const startedAt = Date.now();
    const check = () => {
      if (!polling.current) return;
      void checkStatus()
        .then((connected) => {
          if (connected) polling.current = false;
        })
        .catch(() => {});
    };
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= STATUS_WATCH_MS) clearInterval(timer);
      else check();
    }, STATUS_CHECK_MS);
    const onReturn = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      polling.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [checkStatus, gone, connector.status]);

  if (gone) return null;

  const connect = async (alias?: string) => {
    if (busy || opening.current) return;
    const launch = reserveConnectionPage();
    opening.current = launch;
    const isCurrent = () => opening.current === launch && currentTarget.current === target;
    setBusy(true);
    setLocalError(null);
    setRefusal(null);
    try {
      const reusableUrl = alias ? null : reusableConnectionUrl(pendingAuthorization);
      const createdAt = reusableUrl ? pendingAuthorization!.createdAt : Date.now();
      const result = reusableUrl ? { url: reusableUrl } : await api(`${endpoint}/authorize`, {
          method: "POST",
          body: JSON.stringify(alias ? { threadId, alias } : { threadId }),
        });
      if (!isCurrent()) return;
      const url = mcpSignInLink(typeof result.url === "string" ? result.url : null);
      if (!url) throw new Error(t("connectors.invalidAuthorizationUrl"));
      setAuthorization({ target, url, createdAt });
      if (!await launch.open(url) && isCurrent()) {
        setLocalError({ key: "connectors.card.popupBlocked" });
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (isMcp && error instanceof ApiError && error.status === 409) setRefusal(friendlyError(error));
      else setLocalError(friendlyError(error));
    } finally {
      launch.cancel();
      if (isCurrent()) {
        opening.current = null;
        setBusy(false);
      }
    }
  };

  const resume = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      await api(`${endpoint}/resume`, { method: "POST", body: JSON.stringify({ threadId }) });
    } catch (error) {
      setLocalError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    opening.current?.cancel();
    opening.current = null;
    setBusy(false);
    setAuthorization(null);
    void api(`${endpoint}/dismiss`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
  };

  const connected = connector.status === "connected";
  const authorizing = connector.status === "authorizing";
  const error = localError ?? connector.error;
  const stopped = connector.stopped === true;
  const errorText = typeof error === "string" ? error : "";
  const labelNeeded = !authorizing && (requiresAccountAlias(errorText) || accountAliasTaken(errorText));

  const logo = appLogo(connector.slug, connector.label);
  const tile = (
    <ServiceTile size={44} card={logo
      ? { label: connector.label, image: logo.src, padded: logo.padded, background: logo.background, scale: logo.scale }
      : { label: connector.label, logo: isMcp ? null : `https://logos.composio.dev/api/${encodeURIComponent(connector.slug)}`, padded: true }} />
  );
  const errorLine = error && !labelNeeded && <p role="alert" className="px-4 pb-3 text-[13px] leading-[18px] text-danger">{typeof error === "string" ? error : t(error.key)}</p>;

  if (stopped && !connected) {
    return (
      <ConnectorFrame state="settled" label={connector.label} tile={tile} description={t("chat.turnStopped")} />
    );
  }

  if (connected) {
    return (
      <ConnectorFrame
        state="settled"
        label={connector.label}
        tile={tile}
        title={connector.resumed ? t("connectors.card.resumed") : t("connectors.card.paused")}
        description={`${t("connectors.card.connected")}${connector.resumed ? ` · ${t("connectors.card.continuing")}` : stopped ? ` · ${t("chat.turnStopped")}` : ""}`}
        actions={<>
          {!connector.resumed && !stopped && (
            <button type="button" onClick={() => void resume()} disabled={busy} className={CONNECTOR_SECONDARY}>{t("connectors.card.continueTask")}</button>
          )}
          <button type="button" onClick={() => openConnectApps({ kind: "detail", id: connector.slug })} className={CONNECTOR_SECONDARY}>{t("connectApps.manageApp")}</button>
        </>}
      >
        {errorLine}
      </ConnectorFrame>
    );
  }

  return (
    <ConnectorFrame
      state="pending"
      label={connector.label}
      tile={tile}
      name={isMcp ? t("connectors.card.signInTo", { label: connector.label }) : connector.label}
      description={authorizing ? t("connectors.card.waiting") : connector.description}
      note={t(isMcp ? "connectors.card.mcpSignInHint" : "connectors.card.signInHint")}
      actions={<>
        <button
          type="button"
          onClick={() => void connect(labelNeeded ? label.trim() : undefined)}
          disabled={busy || (labelNeeded && !label.trim())}
          className={authorizing ? CONNECTOR_SECONDARY : CONNECTOR_PRIMARY}
        >
          {authorizing
            ? t("connectors.card.openAgain")
            : connector.status === "failed"
              ? t("connectors.card.tryAgain")
              : t(isMcp ? "connectors.card.signIn" : "connectors.card.connect")}
        </button>
        <button type="button" onClick={dismiss} aria-label={t("connectors.card.notNow")} title={t("connectors.card.notNow")} className={CONNECTOR_DISMISS}>
          <Icon name="close" size={14} />
        </button>
      </>}
    >
      <div className="px-4 pb-3 empty:hidden"><CardHint id="spot.connector" /></div>
      {refusal && <p role="status" className="px-4 pb-3 text-[13px] leading-[18px] text-ink/[0.68]">{refusal}</p>}
      {labelNeeded ? (
        <form className="flex flex-col gap-2 px-4 pb-4" onSubmit={(event) => {
          event.preventDefault();
          if (label.trim()) void connect(label.trim());
        }}>
          <p role="alert" className="text-[13px] leading-[18px] text-danger">
            {t(requiresAccountAlias(errorText) ? "connectors.aliasNeeded" : "connectors.aliasTaken")}
          </p>
          <input
            value={label}
            maxLength={64}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("connectors.card.aliasPlaceholder")}
            aria-label={t("connectors.aliasAriaAnother", { service: connector.label })}
            className={cn(CARD_FIELD, "w-full")}
          />
        </form>
      ) : errorLine}
      {authorizationUrl && (
        <a href={authorizationUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => {
          if (!reusableConnectionUrl(pendingAuthorization)) {
            event.preventDefault();
            void connect();
          }
        }} className="mx-4 mb-3 inline-block self-start text-[12px] leading-4 tracking-[0.015em] text-ink/[0.68] underline">
          {t("connectors.openAuthorizationPage")}
        </a>
      )}
    </ConnectorFrame>
  );
}

const CONNECTOR_BUTTON = "inline-flex h-8 shrink-0 items-center justify-center rounded-full px-3 text-[14px] font-medium leading-5 tracking-[0.01em] transition-colors duration-[120ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:bg-ink/15 disabled:text-ink/30";
const CONNECTOR_PRIMARY = cn(CONNECTOR_BUTTON, "bg-ink text-app hover:bg-[color-mix(in_srgb,var(--color-ink)_88.5%,var(--color-composer))]");
const CONNECTOR_SECONDARY = cn(CONNECTOR_BUTTON, "bg-ink/[0.06] text-ink hover:bg-ink/10");
const CONNECTOR_DISMISS = "-me-1 flex size-7 shrink-0 items-center justify-center rounded-full text-ink/[0.56] transition-colors duration-[120ms] ease-out hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus pointer-coarse:size-9";

/** Grok's in-chat connector card: a 24px-round white sheet on a half-pixel ring, the app's 44px tile, its name and what
 * it is for, the action at the end, and a 12px note under the sheet. */
function ConnectorFrame({ state, label, tile, name, title, description, actions, note, children }: {
  state: "pending" | "settled";
  label: string;
  tile: React.ReactNode;
  name?: string;
  title?: string;
  description: string;
  actions?: React.ReactNode;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} data-tour={state === "pending" ? "connector" : undefined} data-ask-card={state} className="w-full max-w-[560px] rounded-[24px] text-start">
      <section className="flex flex-col rounded-[24px] bg-composer shadow-[0_2px_8px_0_color-mix(in_srgb,var(--color-ink)_3.5%,transparent)]">
        <div className="flex items-center gap-2.5 p-4">
          {tile}
          <div className="min-w-0 flex-1 py-0.5" title={title}>
            <p className="m-0 truncate text-[14px] font-medium leading-5 tracking-[0.01em] text-ink"><bdi dir="auto">{name ?? label}</bdi></p>
            <div className="text-[14px] leading-5 tracking-[0.01em] text-ink/[0.68]">{description}</div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children}
      </section>
      {note && <p className="m-0 px-4 py-2.5 text-[12px] leading-4 tracking-[0.01em] text-ink/[0.56]">{note}</p>}
    </div>
  );
}
