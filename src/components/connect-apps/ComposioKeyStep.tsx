import { useState, type FormEvent } from "react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { reserveConnectionPage } from "@/lib/connector-oauth";
import { Icon } from "../Icon";
import { cleanKey, saveCredential } from "../keys/key-save";
import type { Connectors } from "./use-connectors";
import type { ViaFailure, ViaFlow } from "./via-flow";
import { KitButton } from "./detail-kit";
import { StepGuide, type GuideStep } from "./StepGuide";

/** Composio's own sign-up / log-in, then the project page that lists its API keys
 * (https://docs.composio.dev/reference/authenticating-to-composio). */
export const COMPOSIO_SIGN_UP_URL = "https://dashboard.composio.dev";
export const COMPOSIO_API_KEYS_URL = "https://dashboard.composio.dev/~/project/settings/api-keys";

/** What went wrong saving a key, in one short line: Composio said no, or it could not be reached. */
export function keyProblem(cause: unknown): LocaleKey {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /rejected|start with ak_|\b40[13]\b|unauthori[sz]ed|invalid/i.test(message) ? "connectApps.key.rejected" : "connectApps.key.offline";
}

/** The sentence for where an app's Composio Connect sign-in stands, when there is one to say. */
export function viaLine(flow: ViaFlow | undefined, name: string): { text: string; tone: "status" | "alert" | "done" } | null {
  if (!flow) return null;
  if (flow.step === "done") return { text: t("connectApps.via.connected", { name }), tone: "done" };
  if (flow.step === "waiting") {
    const key: LocaleKey = flow.note === "trouble" ? "connectApps.via.trouble" : flow.note === "notYet" ? "connectApps.via.notYet" : "connectApps.via.waiting";
    return { text: t(key, { name }), tone: "status" };
  }
  if (flow.step !== "failed") return null;
  const key: Record<ViaFailure, LocaleKey> = {
    authorize: "connectApps.via.authorizeFailed", cancelled: "connectApps.via.cancelled", timeout: "connectApps.via.timeout",
    signedOut: "connectApps.via.signedOut", offline: "connectApps.via.offline", refused: "connectApps.via.refused",
  };
  return { text: t(key[flow.why], { name, message: flow.message ?? "" }), tone: "alert" };
}

/** Connecting an app through Composio, in two steps that say what they do: Authorize Composio (once, on Composio's own
 * page, no key copied anywhere), then Connect the app on Composio's page. Each step shows done with a check; the page's
 * main button is the step you are on. Someone who wants their own quota can paste their own project key instead, behind
 * a small link: the server verifies it on save, it is kept the way Settings keeps it, and the Connect goes on the same way. */
export function ComposioKeyStep({ slug, name, connectors }: { slug: string; name: string; connectors: Connectors }) {
  const { dispatch } = useStore();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<LocaleKey | null>(null);
  const [ownKey, setOwnKey] = useState(false);
  const flow = connectors.viaFlow[slug];
  const authorized = connectors.via?.signedIn === true;
  const connected = flow?.step === "done";
  const line = viaLine(flow, name);

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const key = cleanKey(draft);
    if (busy || !key) return;
    if (!/^ak_\S+$/.test(key)) { setProblem("connectApps.key.shape"); return; }
    // the sign-in tab is reserved on this click, before saving uses up the browser's user activation
    const launch = reserveConnectionPage();
    setBusy(true);
    setProblem(null);
    try {
      dispatch({ type: "configStatus", config: await saveCredential("composio", key, true) });
    } catch (cause) {
      launch.cancel();
      setBusy(false);
      setProblem(keyProblem(cause));
      return;
    }
    setDraft("");
    setSaved(true);
    await connectors.continueAfterKey(slug, launch);
    setBusy(false);
  };

  const [openedComposio, setOpenedComposio] = useState(false);
  const [openedKeys, setOpenedKeys] = useState(false);
  const [saved, setSaved] = useState(false);

  const viaSteps: GuideStep[] = [
    { key: "authorize", attrs: { "data-via-step": "authorize" }, pixel: "idcard", done: authorized, text: t("connectApps.guide.signIn"),
      action: <KitButton onClick={() => void connectors.authorizeComposio(slug)}>{t("connectApps.via.authorize")}</KitButton> },
    { key: "connect", attrs: { "data-via-step": "connect" }, pixel: "globe", done: connected, text: t("connectApps.guide.pick", { name }),
      action: authorized ? <KitButton onClick={() => void connectors.connect(slug)}>{t("connectApps.connectApp", { name })}</KitButton> : undefined },
  ];
  const keySteps: GuideStep[] = [
    { key: "open", pixel: "globe", done: openedComposio || openedKeys || Boolean(draft), text: t("connectApps.guide.openComposio"),
      action: <a className="ca-kit-button" data-variant="primary" href={COMPOSIO_SIGN_UP_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpenedComposio(true)}>{t("connectApps.key.signUp")}</a> },
    { key: "google", pixel: "idcard", done: openedKeys || Boolean(draft), text: t("connectApps.guide.google") },
    { key: "copy", pixel: "key", done: Boolean(draft), text: t("connectApps.guide.copyKey"),
      action: <a className="ca-kit-button" data-variant="secondary" href={COMPOSIO_API_KEYS_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpenedKeys(true)}>{t("connectApps.key.openKeys")}</a> },
    { key: "paste", pixel: "note", done: saved, text: t("connectApps.guide.paste"),
      action: (
        <form className="ca-guide-action" onSubmit={(event) => void submit(event)}>
          <input type="password" value={draft} autoFocus autoComplete="off" spellCheck={false} placeholder="ak_…"
            aria-label={t("connectApps.key.label")} aria-invalid={problem ? true : undefined} aria-describedby={problem ? "ca-key-problem" : undefined}
            onChange={(event) => { setDraft(event.target.value); setProblem(null); }} />
          <KitButton type="submit" disabled={busy || !draft.trim()} aria-busy={busy || undefined}>{busy ? t("tokenApps.checking") : t("connectApps.connectApp", { name })}</KitButton>
        </form>
      ) },
    { key: "pick", pixel: "check", done: connected, text: t("connectApps.guide.pick", { name }) },
  ];

  return (
    <section data-composio-key="" aria-labelledby="ca-key-title">
      <h3 id="ca-key-title" className="ca-group-label">{t("connectApps.via.title", { name })}</h3>
      <div className="ca-card">
        <p className="ca-card-row ca-key-why">{t("connectApps.via.why", { name })}</p>
        <div className="ca-card-row">
          <StepGuide label={t("tokenApps.guide", { name })} steps={ownKey ? keySteps : viaSteps} finished={null} />
        </div>
        {line && (
          <p role={line.tone === "alert" ? "alert" : "status"} className="ca-card-row ca-key-line" data-tone={line.tone} data-via-line="">
            <Icon name={line.tone === "alert" ? "exclamation-circle" : line.tone === "done" ? "check" : "clock"} size={13} />
            <span>{line.text}</span>
          </p>
        )}
        {!authorized && !connected && (
          <p className="ca-card-row ca-key-why">
            {!ownKey && <>{t("connectApps.via.shares", { name })}{" "}</>}
            <button type="button" className="ca-link" onClick={() => { setOwnKey(!ownKey); setProblem(null); }}>{t(ownKey ? "connectApps.guide.useSignIn" : "connectApps.signIn.ownKey")}</button>
          </p>
        )}
        {problem && (
          <p id="ca-key-problem" role="alert" className="ca-card-row ca-key-problem">
            <Icon name="exclamation-circle" size={13} />
            <span>{t(problem)}</span>
          </p>
        )}
      </div>
    </section>
  );
}
