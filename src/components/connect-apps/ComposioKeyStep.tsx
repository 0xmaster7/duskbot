import { useState, type FormEvent } from "react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { reserveConnectionPage } from "@/lib/connector-oauth";
import { GrokIcon } from "../GrokIcon";
import { cleanKey, saveCredential } from "../keys/key-save";
import type { Connectors } from "./use-connectors";
import type { ViaFailure, ViaFlow } from "./via-flow";

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    await connectors.continueAfterKey(slug, launch);
    setBusy(false);
  };

  const steps = [
    { key: "authorize", done: authorized, current: !authorized, title: t(authorized ? "connectApps.via.authorized" : "connectApps.via.authorize"), sub: null },
    { key: "connect", done: connected, current: authorized && !connected, title: t("connectApps.connectApp", { name }), sub: t("connectApps.via.connectLine", { name }) },
  ];

  return (
    <section data-composio-key="" aria-labelledby="ca-key-title">
      <h3 id="ca-key-title" className="ca-group-label">{t("connectApps.via.title", { name })}</h3>
      <div className="ca-card">
        <p className="ca-card-row ca-key-why">{t("connectApps.via.why", { name })}</p>
        {!ownKey && (
          <ol className="ca-key-steps">
            {steps.map((step, index) => (
              <li key={step.key} className="ca-card-row" data-via-step={step.key} data-state={step.done ? "done" : step.current ? "current" : "next"}
                aria-current={step.current ? "step" : undefined}>
                <span data-step="" aria-hidden="true">{step.done ? <GrokIcon name="check" size={11} /> : index + 1}</span>
                <span>
                  {step.title}
                  {step.sub && !step.done && <span className="ca-key-sub">{step.sub}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {line && (
          <p role={line.tone === "alert" ? "alert" : "status"} className="ca-card-row ca-key-line" data-tone={line.tone} data-via-line="">
            <GrokIcon name={line.tone === "alert" ? "exclamation-circle" : line.tone === "done" ? "check" : "clock"} size={13} />
            <span>{line.text}</span>
          </p>
        )}
        {!ownKey && !authorized && (
          <p className="ca-card-row ca-key-why">
            {t("connectApps.via.shares", { name })}{" "}
            <button type="button" className="ca-link" onClick={() => { setOwnKey(true); setProblem(null); }}>{t("connectApps.signIn.ownKey")}</button>
          </p>
        )}
        {ownKey && (
          <>
            <ol className="ca-key-steps">
              <li className="ca-card-row">
                <span data-step="" aria-hidden="true">1</span>
                <span>{t("connectApps.key.step1")}</span>
                <a className="ca-pill" data-size="sm" href={COMPOSIO_SIGN_UP_URL} target="_blank" rel="noopener noreferrer">
                  <span>{t("connectApps.key.signUp")}</span>
                </a>
              </li>
              <li className="ca-card-row">
                <span data-step="" aria-hidden="true">2</span>
                <span>{t("connectApps.key.step2")}</span>
                <a className="ca-pill" data-size="sm" href={COMPOSIO_API_KEYS_URL} target="_blank" rel="noopener noreferrer">
                  <span>{t("connectApps.key.openKeys")}</span>
                </a>
              </li>
              <li className="ca-card-row">
                <span data-step="" aria-hidden="true">3</span>
                <span>{t("connectApps.key.step3", { name })}</span>
              </li>
            </ol>
            <form className="ca-alias" onSubmit={(event) => void submit(event)}>
              <input type="password" value={draft} autoFocus autoComplete="off" spellCheck={false} placeholder="ak_…"
                aria-label={t("connectApps.key.label")} aria-invalid={problem ? true : undefined} aria-describedby={problem ? "ca-key-problem" : undefined}
                onChange={(event) => { setDraft(event.target.value); setProblem(null); }} />
              <button type="submit" className="ca-primary" disabled={busy || !draft.trim()} aria-busy={busy || undefined}>
                {[t("connectApps.connectApp", { name }), t("connectApps.connecting")].map((label, index) => (
                  <span key={label} aria-hidden={(index === 1) === busy ? undefined : true}>{label}</span>
                ))}
              </button>
            </form>
          </>
        )}
        {problem && (
          <p id="ca-key-problem" role="alert" className="ca-card-row ca-key-problem">
            <GrokIcon name="exclamation-circle" size={13} />
            <span>{t(problem)}</span>
          </p>
        )}
      </div>
    </section>
  );
}
