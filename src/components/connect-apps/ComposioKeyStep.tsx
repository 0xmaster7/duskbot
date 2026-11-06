import { useState, type FormEvent } from "react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { reserveConnectionPage } from "@/lib/connector-oauth";
import { GrokIcon } from "../GrokIcon";
import { cleanKey, saveCredential } from "../keys/key-save";
import type { Connectors } from "./use-connectors";

/** Composio's own sign-up / log-in, then the project page that lists its API keys
 * (https://docs.composio.dev/reference/authenticating-to-composio). */
export const COMPOSIO_SIGN_UP_URL = "https://dashboard.composio.dev";
export const COMPOSIO_API_KEYS_URL = "https://dashboard.composio.dev/~/project/settings/api-keys";

/** What went wrong saving a key, in one short line: Composio said no, or it could not be reached. */
export function keyProblem(cause: unknown): LocaleKey {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /rejected|start with ak_|\b40[13]\b|unauthori[sz]ed|invalid/i.test(message) ? "connectApps.key.rejected" : "connectApps.key.offline";
}

/** Connect's own Composio step: one line on why, then Sign in with Composio, which adds Composio Connect, opens
 * Composio's own sign-in (or sign-up) page and comes back connected, so no key is copied anywhere; the app's Connect then
 * goes on by itself. A person who wants their own quota can paste their own project key instead, behind a small link:
 * the server verifies it on save, it is kept the way Settings keeps it, and the Connect goes on the same way. */
export function ComposioKeyStep({ slug, name, connectors }: { slug: string; name: string; connectors: Connectors }) {
  const { dispatch } = useStore();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"sign-in" | "key" | null>(null);
  const [problem, setProblem] = useState<LocaleKey | null>(null);
  const [ownKey, setOwnKey] = useState(false);
  const own = connectors.mode === "managed";

  const signIn = async () => {
    if (busy) return;
    // composio's page opens in the tab reserved on this click
    const launch = reserveConnectionPage();
    setBusy("sign-in");
    setProblem(null);
    let ok = false;
    try {
      ok = await connectors.signInComposio(launch);
    } catch {
      ok = false;
    }
    setBusy(null);
    if (!ok) { setProblem("connectApps.signIn.failed"); return; }
    await connectors.connect(slug);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = cleanKey(draft);
    if (busy || !key) return;
    if (!/^ak_\S+$/.test(key)) { setProblem("connectApps.key.shape"); return; }
    // the sign-in tab is reserved on this click, before saving uses up the browser's user activation
    const launch = reserveConnectionPage();
    setBusy("key");
    setProblem(null);
    try {
      dispatch({ type: "configStatus", config: await saveCredential("composio", key, true) });
    } catch (cause) {
      launch.cancel();
      setBusy(null);
      setProblem(keyProblem(cause));
      return;
    }
    setDraft("");
    await connectors.continueAfterKey(slug, launch);
    setBusy(null);
  };

  return (
    <section data-composio-key="" aria-labelledby="ca-key-title">
      <h3 id="ca-key-title" className="ca-group-label">{t("connectApps.key.title")}</h3>
      <div className="ca-card">
        <p className="ca-card-row ca-key-why">{t(own ? "connectApps.key.whyOwn" : "connectApps.key.why", { name })}</p>
        {!ownKey && (
          <>
            <ol className="ca-key-steps">
              <li className="ca-card-row">
                <span data-step="" aria-hidden="true">1</span>
                <span>{t("connectApps.signIn.step1")}</span>
              </li>
              <li className="ca-card-row">
                <span data-step="" aria-hidden="true">2</span>
                <span>{t("connectApps.signIn.step2", { name })}</span>
              </li>
            </ol>
            <div className="ca-card-row">
              <button type="button" className="ca-primary" data-composio-sign-in="" disabled={busy !== null} aria-busy={busy === "sign-in" || undefined} onClick={() => void signIn()}>
                {[t("connectApps.signIn.button"), t("connectApps.signIn.waiting")].map((label, index) => (
                  <span key={label} aria-hidden={(index === 1) === (busy === "sign-in") ? undefined : true}>{label}</span>
                ))}
              </button>
              <button type="button" className="ca-link" onClick={() => { setOwnKey(true); setProblem(null); }}>{t("connectApps.signIn.ownKey")}</button>
            </div>
          </>
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
              <button type="submit" className="ca-primary" disabled={busy !== null || !draft.trim()} aria-busy={busy === "key" || undefined}>
                {[t("connectors.action.connect"), t("connectApps.connecting")].map((label, index) => (
                  <span key={label} aria-hidden={(index === 1) === (busy === "key") ? undefined : true}>{label}</span>
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
