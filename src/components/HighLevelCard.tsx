import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { reserveConnectionPage } from "@/lib/connector-oauth";
import { openExternalLink } from "@/lib/app-links";
import {
  HIGHLEVEL_API,
  cancelHighLevelSignIn,
  isHighLevelStatus,
  runHighLevelSignIn,
  watchHighLevelSignIn,
  type HighLevelFlow,
  type HighLevelSignInResult,
  type HighLevelStatus,
} from "@/lib/highlevel-sign-in";
import { forgetHighLevelStatus, rememberHighLevelStatus } from "@/lib/highlevel-status";
import { KitActions, KitBody, KitButton, KitField, KitLink, KitStatus, KitText } from "./connect-apps/detail-kit";


/** HighLevel on its Connect Apps page: one connection per installation, set up by signing in. */
export function HighLevelCard({ refreshKey = 0, onConnection }: {
  refreshKey?: number;
  /** true once connected, false otherwise, null until the server has answered */
  onConnection?: (connected: boolean | null) => void;
}) {
  const [status, setStatus] = useState<HighLevelStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"connect" | "token" | "disconnect" | null>(null);
  const [flow, setFlow] = useState<HighLevelFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenMode, setTokenMode] = useState(false);
  const [token, setToken] = useState("");
  const [locationId, setLocationId] = useState("");
  const mounted = useRef(true);
  const watching = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<HighLevelStatus | null> => {
    try {
      const response = await api(HIGHLEVEL_API);
      if (!mounted.current) return null;
      if (!isHighLevelStatus(response)) throw new Error(t("highlevel.failed"));
      rememberHighLevelStatus(response);
      setStatus(response);
      setLoadFailed(false);
      return response;
    } catch {
      if (mounted.current) setLoadFailed(true);
      return null;
    }
  }, []);

  const finish = useCallback(async (result: HighLevelSignInResult) => {
    if (!mounted.current) return;
    if (result.phase === "failed") setError(result.message || t("highlevel.failed"));
    else if (result.phase === "expired") setError(t("highlevel.expired"));
    await load();
  }, [load]);

  /** Follows a flow the server already has (after a reload, or started elsewhere) without opening anything. */
  const follow = useCallback((current: HighLevelFlow) => {
    if (watching.current) return;
    const controller = new AbortController();
    watching.current = controller;
    setFlow(current);
    void watchHighLevelSignIn(current, { api, open: openExternalLink, signal: controller.signal })
      .then(finish)
      .finally(() => {
        if (watching.current === controller) watching.current = null;
        if (mounted.current) setFlow(null);
      });
  }, [finish]);

  useEffect(() => {
    mounted.current = true;
    void load().then((loaded) => {
      if (loaded?.state === "connecting" && loaded.flow && mounted.current) follow(loaded.flow);
    });
    return () => {
      mounted.current = false;
      watching.current?.abort();
      watching.current = null;
    };
  }, [load, follow, refreshKey]);

  useEffect(() => {
    onConnection?.(status ? status.state === "connected" : null);
  }, [status, onConnection]);

  const connect = async () => {
    if (busy || watching.current) return;
    // Reserve the tab during the click, before the request consumes the browser's user activation.
    const launch = reserveConnectionPage();
    const controller = new AbortController();
    watching.current = controller;
    setBusy("connect");
    setError(null);
    try {
      const result = await runHighLevelSignIn({
        api,
        signal: controller.signal,
        onStarted: (started) => {
          if (!mounted.current) return;
          setFlow(started);
          setBusy(null);
        },
        open: async (url) => {
          const opened = await launch.open(url);
          launch.cancel();
          if (!opened && mounted.current && !controller.signal.aborted) setError(t("connectors.popupBlockedContinue"));
          return opened;
        },
      });
      await finish(result);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      launch.cancel();
      if (watching.current === controller) watching.current = null;
      if (mounted.current) {
        setFlow(null);
        setBusy(null);
      }
    }
  };

  const cancel = () => {
    const controller = watching.current;
    if (controller) {
      controller.abort();
      return;
    }
    // A flow the server reported but nobody here is following (its watcher ended): tell the server directly.
    if (flow) void cancelHighLevelSignIn(flow.flowId, api).then(() => load());
  };

  const connectWithToken = async () => {
    if (busy) return;
    const trimmedToken = token.trim();
    const trimmedLocation = locationId.trim();
    if (!trimmedToken || !trimmedLocation) {
      setError(t("highlevel.tokenIncomplete"));
      return;
    }
    setBusy("token");
    setError(null);
    try {
      await api(`${HIGHLEVEL_API}/token`, { method: "POST", body: JSON.stringify({ token: trimmedToken, locationId: trimmedLocation }) });
      if (!mounted.current) return;
      setToken("");
      setLocationId("");
      setTokenMode(false);
      await load();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    if (!window.confirm(t("highlevel.disconnectConfirm"))) return;
    setBusy("disconnect");
    setError(null);
    try {
      await api(HIGHLEVEL_API, { method: "DELETE" });
      forgetHighLevelStatus();
      await load();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  if (status?.state === "unavailable") return null;

  const state = status?.state ?? null;
  const connecting = flow !== null || busy === "connect" || state === "connecting";
  const connected = state === "connected";
  const needsSignIn = state === "needs-sign-in";
  const description = connected && status?.location?.name
    ? t("highlevel.connectedTo", { name: status.location.name })
    : connected
      ? t("apps.connected")
      : needsSignIn
        ? t("connectors.signedOut")
        : t("highlevel.description");

  return (
    <KitBody data-app-tile="highlevel" data-highlevel-state={state ?? "loading"}>
      {status === null && !connecting
        ? (loadFailed
          ? <KitActions><KitButton variant="secondary" onClick={() => void load()}>{t("connectors.action.retry")}</KitButton></KitActions>
          : <KitStatus>{t("common.checking")}</KitStatus>)
        : <KitText>{description}</KitText>}
      {connecting && (
        <>
          <KitStatus>{t("highlevel.finishInBrowser")}</KitStatus>
          <KitActions>
            <KitButton variant="secondary" onClick={cancel}>{t("mcp.auth.cancel")}</KitButton>
            {flow && <KitLink onClick={() => void openExternalLink(flow.authorizationUrl).catch(() => setError(t("mcp.auth.openFailed")))}>{t("mcp.auth.openAgain")}</KitLink>}
          </KitActions>
        </>
      )}
      {!connecting && status !== null && !tokenMode && (
        <KitActions>
          {!connected && (
            <KitButton aria-label={t(needsSignIn ? "highlevel.reconnect" : "highlevel.connect")} disabled={busy !== null} onClick={() => void connect()}>
              {t(needsSignIn ? "connectors.action.reconnect" : "connectors.action.connect")}
            </KitButton>
          )}
          {(connected || needsSignIn) && (
            <KitButton variant="secondary" tone="danger" disabled={busy !== null} onClick={() => void disconnect()}>
              {busy === "disconnect" ? t("common.checking") : t("connectors.disconnect")}
            </KitButton>
          )}
        </KitActions>
      )}
      {!connecting && status !== null && !connected && !needsSignIn && (tokenMode ? (
        <form data-highlevel-token-form className="ca-kit" style={{ alignSelf: "stretch" }} onSubmit={(event) => { event.preventDefault(); void connectWithToken(); }}>
          <KitText>{t("highlevel.tokenHelp")}</KitText>
          <KitField label={t("highlevel.tokenField")} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} />
          <KitField label={t("highlevel.locationField")} type="text" autoComplete="off" spellCheck={false} value={locationId} onChange={(event) => setLocationId(event.target.value)} />
          <KitActions>
            <KitButton type="submit" disabled={busy !== null}>{busy === "token" ? t("connectApps.connecting") : t("connectors.action.connect")}</KitButton>
            <KitButton variant="secondary" onClick={() => { setTokenMode(false); setError(null); }}>{t("common.cancel")}</KitButton>
          </KitActions>
          <KitLink onClick={() => { setTokenMode(false); setError(null); }}>{t("highlevel.useSignIn")}</KitLink>
        </form>
      ) : <KitLink onClick={() => { setTokenMode(true); setError(null); }}>{t("highlevel.useToken")}</KitLink>)}
      {error && <KitStatus tone="danger">{error}</KitStatus>}
    </KitBody>
  );
}
