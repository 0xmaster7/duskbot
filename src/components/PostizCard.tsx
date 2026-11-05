import { useCallback, useEffect, useRef, useState } from "react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { reserveConnectionPage } from "@/lib/connector-oauth";
import { completeMcpSignIn, mcpSignInLink, runMcpSignIn, type McpSignInStatus } from "@/lib/mcp-sign-in";
import { keySaved, keySaveFailure } from "@/lib/product-events";
import { POSTIZ_API, postizErrorText, postizHost, postizSaveErrorText } from "@/lib/postiz";
import { isPostizStatus, POSTIZ_CLOUD, POSTIZ_KEY_PAGE, POSTIZ_SERVER, type PostizStatus } from "../../shared/postiz";
import { cleanKey, looksLikeKey, saveCredential } from "./keys/key-save";
import { KitActions, KitBody, KitButton, KitField, KitLink, KitStatus, KitText } from "./connect-apps/detail-kit";

const SERVER = encodeURIComponent(POSTIZ_SERVER);
const OWN_SIGN_IN_POLL_MS = 1_500;
const OWN_SIGN_IN_WAIT_MS = 5 * 60_000;

/** OpenMausBot's own mark for Postiz: no Postiz artwork is bundled. */
export function PostizIcon() {
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0 rounded-[10px]" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#612bd3" />
      <path d="M14 29V11h7.2c4.1 0 6.8 2.3 6.8 5.9s-2.7 5.9-6.8 5.9h-3.1V29zm4.1-9.7h2.8c1.9 0 3-0.9 3-2.4s-1.1-2.4-3-2.4h-2.8z" fill="#fff" fillRule="evenodd" />
    </svg>
  );
}

type OwnConnection = { connected: boolean; how: "sign-in" | "key" | null } | null;

/** Postiz on its Connect Apps page: Postiz Cloud's sign-in, or an organisation API key for Postiz Cloud or a person's own
 * Postiz server. Once connected, bots get Postiz's tools as the `postiz` MCP server. */
export function PostizCard({ refreshKey = 0, onConnection }: {
  refreshKey?: number;
  /** true once connected, false otherwise, null until the server has answered */
  onConnection?: (connected: boolean | null) => void;
}) {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<PostizStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"sign-in" | "key" | "disconnect" | null>(null);
  const [flow, setFlow] = useState<McpSignInStatus | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [keyMode, setKeyMode] = useState(false);
  const [key, setKey] = useState("");
  const [address, setAddress] = useState("");
  const [onlyMe, setOnlyMe] = useState(false);
  const [own, setOwn] = useState<OwnConnection>(null);
  const mounted = useRef(true);
  const signIn = useRef<{ controller: AbortController; complete?: (result: McpSignInStatus) => void } | null>(null);

  const ownConnection = useCallback(async (): Promise<OwnConnection> => {
    const mine = await api("/api/team/my-connections").catch(() => null) as { mcp?: Array<{ name: string; connected: boolean; how: "sign-in" | "key" | null }> } | null;
    const entry = mine?.mcp?.find((each) => each.name === POSTIZ_SERVER);
    return entry ? { connected: entry.connected, how: entry.how } : { connected: false, how: null };
  }, []);

  const load = useCallback(async (check = false): Promise<PostizStatus | null> => {
    try {
      const response = await api(check ? `${POSTIZ_API}/check` : POSTIZ_API, check ? { method: "POST" } : undefined);
      if (!mounted.current) return null;
      if (!isPostizStatus(response)) throw new Error("unexpected Postiz status");
      setStatus(response);
      setLoadFailed(false);
      if (response.team && response.scope === "person") setOwn(await ownConnection());
      return response;
    } catch (cause) {
      if (!mounted.current) return null;
      if ((cause as { status?: number }).status === 403) setHidden(true);
      else setLoadFailed(true);
      return null;
    }
  }, [ownConnection]);

  useEffect(() => {
    mounted.current = true;
    void load().then((loaded) => {
      // A sign-in or key revoked in Postiz shows as such: the server checks again at most every few minutes.
      if (loaded?.state === "connected" && loaded.scope === "team") void load(true);
    });
    return () => {
      mounted.current = false;
      signIn.current?.controller.abort();
      signIn.current = null;
    };
  }, [load, refreshKey]);

  const person = status?.team === true && status.scope === "person";
  const connected = person ? own?.connected === true : status?.state === "connected";
  useEffect(() => {
    onConnection?.(status ? connected : null);
  }, [status, connected, onConnection]);

  const applied = (config: ConfigStatus) => dispatch({ type: "configStatus", config });

  /** Each person connects their own: the team's entry is on, and this person's own sign-in or key goes beside it. */
  const makeOwn = async () => {
    await api("/api/team/connection-scopes", { method: "PUT", body: JSON.stringify({ kind: "mcp", id: POSTIZ_SERVER, scope: "person" }) });
    await api(`/api/mcp/servers/${SERVER}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
  };

  const ownSignIn = async (controller: AbortController, open: (url: string) => Promise<boolean>) => {
    const started = await api(`/api/team/my-connections/mcp/${SERVER}/sign-in`, { method: "POST" }) as { auth: McpSignInStatus };
    const url = mcpSignInLink(started.auth.authorizationUrl);
    if (!url) throw new Error(t("mcp.auth.failed"));
    setFlow({ ...started.auth, flowId: null, pasteBack: false });
    if (!await open(url) && mounted.current) setError(t("connectors.popupBlockedContinue"));
    const until = Date.now() + OWN_SIGN_IN_WAIT_MS;
    while (!controller.signal.aborted && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, OWN_SIGN_IN_POLL_MS));
      const mine = await ownConnection();
      if (mine?.connected) return;
    }
    if (!controller.signal.aborted) throw new Error(t("postiz.signInExpired"));
  };

  const connect = async () => {
    if (busy || signIn.current) return;
    // Reserve the tab during the click, before a request uses up the browser's user activation.
    const launch = reserveConnectionPage();
    const controller = new AbortController();
    signIn.current = { controller };
    setBusy("sign-in");
    setError(null);
    setCallbackUrl("");
    const open = async (url: string) => { const opened = await launch.open(url); launch.cancel(); return opened; };
    try {
      await api(`${POSTIZ_API}/sign-in`, { method: "POST" });
      if (onlyMe || person) {
        if (onlyMe && !person) await makeOwn();
        await ownSignIn(controller, open);
        return;
      }
      const result = await runMcpSignIn(POSTIZ_SERVER, {
        api, signal: controller.signal,
        open: async (url) => { if (!await open(url) && mounted.current && !controller.signal.aborted) setError(t("connectors.popupBlockedContinue")); },
        onStarted: (started, complete) => { if (signIn.current?.controller === controller) signIn.current.complete = complete; if (mounted.current) setFlow(started); },
      });
      if (controller.signal.aborted || !mounted.current) return;
      if (result.phase !== "succeeded") {
        if (result.phase !== "cancelled") setError(result.message || t("mcp.auth.failed"));
        return;
      }
      setLoadingTools(true);
      const tested = await api(`/api/mcp/servers/${SERVER}/test`, { method: "POST", signal: controller.signal }) as { ok: boolean; error?: string };
      if (!tested.ok) {
        const reason = (tested.error ?? "").trim();
        setError(t("postiz.error.testFailed", { reason: reason && !/[.!?]$/u.test(reason) ? `${reason}.` : reason }));
        return;
      }
      await api(`/api/mcp/servers/${SERVER}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(postizErrorText(cause, POSTIZ_CLOUD));
    } finally {
      launch.cancel();
      if (signIn.current?.controller === controller) signIn.current = null;
      if (mounted.current) {
        setFlow(null);
        setLoadingTools(false);
        setBusy(null);
        await load();
      }
    }
  };

  const completePasted = async () => {
    const current = signIn.current;
    if (!current || !flow?.flowId || !callbackUrl.trim()) return;
    try {
      current.complete?.(await completeMcpSignIn(POSTIZ_SERVER, flow.flowId, callbackUrl, api));
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const connectWithKey = async () => {
    const value = cleanKey(key);
    const target = person || onlyMe ? "" : address.trim();
    if (busy) return;
    if (!looksLikeKey(value)) return setError(t("keys.notAKey"));
    setBusy("key");
    setError(null);
    try {
      await api(`${POSTIZ_API}/key-check`, { method: "POST", body: JSON.stringify({ key: value, ...(target ? { address: target } : {}) }) });
      if (onlyMe || person) {
        await api(`${POSTIZ_API}/sign-in`, { method: "POST" });
        if (!person) await makeOwn();
        const listed = await api(`/api/mcp/servers`) as { servers?: Array<{ name: string; url?: string }> };
        const url = listed.servers?.find((server) => server.name === POSTIZ_SERVER)?.url;
        await api(`/api/team/my-connections/mcp/${SERVER}/key`, { method: "PUT", body: JSON.stringify({ value, url }) });
      } else {
        const saved = state.config?.postiz?.url ?? "";
        const wanted = target && postizHost(target) !== postizHost(POSTIZ_CLOUD) ? target : "";
        if (wanted !== saved) applied(await api("/api/config", { method: "PUT", body: JSON.stringify({ postiz: { url: wanted } }) }));
        applied(await saveCredential("postiz", value, state.config?.postiz?.configured !== true));
      }
      keySaved("postiz", "apps", "ok");
      if (!mounted.current) return;
      setKey("");
      setKeyMode(false);
    } catch (cause) {
      keySaved("postiz", "apps", keySaveFailure(cause));
      if (mounted.current) setError(postizSaveErrorText(cause, target || POSTIZ_CLOUD));
    } finally {
      if (mounted.current) {
        setBusy(null);
        await load();
      }
    }
  };

  const disconnect = async () => {
    if (busy || !window.confirm(t("postiz.disconnectConfirm"))) return;
    setBusy("disconnect");
    setError(null);
    try {
      if (person) {
        await api(`/api/team/my-connections/mcp/${SERVER}`, { method: "DELETE" });
      } else {
        if (status?.keySaved) applied(await saveCredential("postiz", "", false));
        await api(POSTIZ_API, { method: "DELETE" });
      }
    } catch (cause) {
      if (mounted.current) setError(postizErrorText(cause, status?.address ?? POSTIZ_CLOUD));
    } finally {
      if (mounted.current) {
        setBusy(null);
        await load();
      }
    }
  };

  const cancel = () => signIn.current?.controller.abort();

  if (hidden) return null;
  const waiting = busy === "sign-in";
  const needsSignIn = !person && status?.state === "needs-sign-in";
  const refused = !person && status?.state === "key-refused";
  const blocked = status?.state === "blocked" || status?.state === "taken";
  const description = status?.state === "taken" ? t("postiz.taken")
    : status?.state === "blocked" ? status.message ?? t("postiz.description")
      : connected
        ? person ? t("postiz.connectedOwn")
          : status?.how === "key" ? t("postiz.connectedKey", { host: status.host }) : t("postiz.connectedTo", { host: status?.host ?? "" })
        : needsSignIn ? t("connectors.signedOut")
          : refused ? t("postiz.keyRefused")
            : t("postiz.description");
  const offerConnect = status !== null && !connected && !blocked;

  return (
    <KitBody data-app-tile="postiz" data-postiz-state={status?.state ?? "loading"}>
      {status === null && !waiting
        ? (loadFailed
          ? <KitActions><KitButton variant="secondary" onClick={() => void load()}>{t("connectors.action.retry")}</KitButton></KitActions>
          : <KitStatus>{t("common.checking")}</KitStatus>)
        : <KitText>{description}</KitText>}
      {waiting && (
        <>
          <KitStatus>{t(loadingTools ? "postiz.loadingTools" : "postiz.finishInBrowser")}</KitStatus>
          <KitActions>
            <KitButton variant="secondary" onClick={cancel}>{t("mcp.auth.cancel")}</KitButton>
            {flow?.authorizationUrl && mcpSignInLink(flow.authorizationUrl) && (
              <KitLink onClick={() => void openExternalLink(flow.authorizationUrl!).catch(() => setError(t("mcp.auth.openFailed")))}>{t("mcp.auth.openAgain")}</KitLink>
            )}
          </KitActions>
          {flow?.flowId && flow.pasteBack && (
            <form data-postiz-paste className="ca-kit" style={{ alignSelf: "stretch" }} onSubmit={(event) => { event.preventDefault(); void completePasted(); }}>
              <KitText>{t("mcp.auth.pasteBackHint")}</KitText>
              <KitField label={t("mcp.auth.callbackUrl")} type="text" value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} autoComplete="off" spellCheck={false}
                placeholder="http://127.0.0.1:…/mcp-oauth/callback?…" />
              <KitActions><KitButton type="submit" disabled={!callbackUrl.trim()}>{t("mcp.auth.complete")}</KitButton></KitActions>
            </form>
          )}
        </>
      )}
      {offerConnect && !waiting && status.team && !person && (
        <label data-postiz-only-me className="ca-kit-text flex items-center gap-2">
          <input type="checkbox" checked={onlyMe} onChange={(event) => setOnlyMe(event.target.checked)} /> {t("mcp.team.onlyMe")}
        </label>
      )}
      {person && !connected && !waiting && <KitText>{t("postiz.personScope")}</KitText>}
      {!waiting && status !== null && !keyMode && (connected || offerConnect || needsSignIn || refused) && (
        <KitActions>
          {offerConnect && (
            <KitButton aria-label={t(needsSignIn || refused ? "postiz.reconnect" : "postiz.connect")} disabled={busy !== null}
              onClick={() => refused ? (setKeyMode(true), setError(null)) : void connect()}>
              {t(needsSignIn || refused ? "connectors.action.reconnect" : "connectors.action.connect")}
            </KitButton>
          )}
          {(connected || needsSignIn || refused) && (
            <KitButton variant="secondary" tone="danger" disabled={busy !== null} onClick={() => void disconnect()}>
              {busy === "disconnect" ? t("common.checking") : t("connectors.disconnect")}
            </KitButton>
          )}
        </KitActions>
      )}
      {offerConnect && !waiting && (keyMode ? (
        <form data-postiz-key-form className="ca-kit" style={{ alignSelf: "stretch" }} onSubmit={(event) => { event.preventDefault(); void connectWithKey(); }}>
          <KitText>{t(person || onlyMe ? "postiz.keyHelp" : "postiz.keyAndAddressHelp")}</KitText>
          <KitField label={t("postiz.keyField")} type="password" autoComplete="off" spellCheck={false} placeholder={t("keys.postiz.placeholder")}
            value={key} disabled={busy === "key"} onChange={(event) => { setError(null); setKey(event.target.value); }} />
          {!person && !onlyMe && (
            <KitField label={t("postiz.addressField")} type="url" autoComplete="off" spellCheck={false} placeholder={POSTIZ_CLOUD}
              value={address} disabled={busy === "key"} onChange={(event) => { setError(null); setAddress(event.target.value); }} />
          )}
          <KitActions>
            <KitButton type="submit" disabled={busy !== null || !key.trim()}>{busy === "key" ? t("connectApps.connecting") : t("connectors.action.connect")}</KitButton>
            <KitButton variant="secondary" onClick={() => { setKeyMode(false); setError(null); }}>{t("common.cancel")}</KitButton>
            <a href={POSTIZ_KEY_PAGE} target="_blank" rel="noopener noreferrer" className="ca-kit-link">{t("postiz.keyLink")}</a>
          </KitActions>
        </form>
      ) : (
        <KitLink onClick={() => { setKeyMode(true); setError(null); setAddress(status.selfHosted ? status.address : ""); }}>{t("postiz.useKey")}</KitLink>
      ))}
      {error && <KitStatus tone="danger">{error}</KitStatus>}
    </KitBody>
  );
}
