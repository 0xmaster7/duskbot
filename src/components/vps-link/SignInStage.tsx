// stage 3: sign in to Claude and ChatGPT here, and the sign-in goes to the server privately
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type { VpsEngine, VpsLinkBridge, VpsServer, VpsSignIn } from "@/lib/vps-link";
import { mdPrimaryCls, mdSecondaryCls, rowButtonCls, textFieldCls } from "../ui/GrokDialog";
import { deviceWord, ErrorNote, StageHead, StatusMark } from "./parts";

const POLL_MS = 2000;
const message = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "");

function EngineRow({ engine, bridge, onSignedIn }: { engine: VpsEngine; bridge: VpsLinkBridge; onSignedIn: () => void }) {
  const [flow, setFlow] = useState<VpsSignIn | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // a waiting sign-in is asked about every two seconds until it is not waiting any more
  useEffect(() => {
    if (!flow || flow.phase !== "waiting" || !flow.flowId) return;
    const timer = setTimeout(() => {
      void bridge.signInStatus(engine.instanceId, flow.flowId!).then((next) => {
        if (!alive.current) return;
        // a sign-in that falls back to the server's own page brings its link in a later answer: open it once
        if (next.phase === "waiting" && next.authorizationUrl && next.authorizationUrl !== flow.authorizationUrl) void bridge.openUrl(next.authorizationUrl);
        setFlow(next);
        if (next.phase === "succeeded") onSignedIn();
        else if (next.phase !== "waiting") setError(next.message ?? t("vpsLink.signIn.didNotWork"));
      }, (cause) => { if (alive.current) setError(message(cause)); });
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [flow, bridge, engine.instanceId, onSignedIn]);

  const start = async () => {
    setBusy(true); setError(""); setCode("");
    try {
      const next = await bridge.signIn(engine.instanceId);
      if (!alive.current) return;
      setFlow(next);
      if (next.phase === "succeeded") onSignedIn();
      else if (next.authorizationUrl) await bridge.openUrl(next.authorizationUrl);
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const sendCode = async () => {
    if (!flow?.flowId || !code.trim()) return;
    setBusy(true); setError("");
    try {
      await bridge.signInCode(engine.instanceId, flow.flowId, code.trim());
      if (alive.current) setFlow({ ...flow, needsCode: false });
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const signedIn = engine.signedIn || flow?.phase === "succeeded";
  const waiting = flow?.phase === "waiting";
  const codeId = `vps-code-${engine.instanceId}`;
  return (
    <li data-vps-engine={engine.kind} className="flex flex-col">
      <div className="flex min-h-[38px] items-center gap-2.5 px-2 py-1">
        <StatusMark status={signedIn ? "done" : waiting ? "running" : "waiting"} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-[18px] text-ink">{engine.kind === "claude" ? t("vpsLink.signIn.claude") : t("vpsLink.signIn.chatgpt")}</div>
          <div className="text-[12px] leading-4 text-ink/56">{signedIn ? t("vpsLink.signIn.ready") : waiting ? flow?.message ?? t("vpsLink.signIn.finishInBrowser") : engine.name}</div>
        </div>
        {!signedIn && !waiting && <button type="button" className={rowButtonCls} disabled={busy} onClick={() => void start()}>{t("vpsLink.signIn.action")}</button>}
        {waiting && flow?.authorizationUrl && <button type="button" className={rowButtonCls} onClick={() => void bridge.openUrl(flow.authorizationUrl!)}>{t("vpsLink.signIn.again")}</button>}
      </div>
      {waiting && flow?.userCode && <div className="mb-1 ml-[34px] mr-2 flex items-center gap-2">
        <span className="text-[12px] leading-4 text-ink/68">{t("vpsLink.signIn.enterCode")}</span>
        <code className="select-all rounded-[6px] border border-ink/10 px-1.5 py-0.5 font-mono text-[13px] leading-[18px] tracking-[0.08em] text-ink">{flow.userCode}</code>
      </div>}
      {waiting && flow?.needsCode && <form className="mb-1 ml-[34px] mr-2 flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void sendCode(); }}>
        <label htmlFor={codeId} className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[11px] leading-4 text-ink/68">{t("vpsLink.signIn.pasteCode")}</span>
          <input id={codeId} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} autoComplete="off" spellCheck={false} className={textFieldCls} />
        </label>
        <button type="submit" disabled={busy || !code.trim()} className={mdPrimaryCls}>{t("vpsLink.continue")}</button>
      </form>}
      {error && <div className="mb-1 ml-[34px] mr-2"><ErrorNote onRetry={() => void start()}>{error}</ErrorNote></div>}
    </li>
  );
}

export function SignInStage({ bridge, server, onDone }: { bridge: VpsLinkBridge; server: VpsServer | null; onDone: () => void }) {
  const [engines, setEngines] = useState<VpsEngine[] | null>(null);
  const [error, setError] = useState("");
  const [signed, setSigned] = useState<Set<string>>(new Set());
  const load = () => {
    setError("");
    void bridge.engines().then(setEngines, (cause) => setError(message(cause)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [bridge]);
  const name = server?.name ?? t("vpsLink.yourServer");
  const anyReady = Boolean(engines?.some((engine) => engine.signedIn || signed.has(engine.instanceId)));
  return (
    <div className="flex flex-col gap-3">
      <StageHead mascot="excited" title={t("vpsLink.signIn.title")} hint={t("vpsLink.signIn.hint", { name, device: deviceWord() })} />
      {error
        ? <ErrorNote onRetry={load}>{error}</ErrorNote>
        : <ul aria-label={t("vpsLink.signIn.listAria")} className="m-0 flex list-none flex-col p-0">
            {engines === null
              ? <li className="px-2 py-2 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.signIn.loading")}</li>
              : engines.length === 0
                ? <li className="px-2 py-2 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.signIn.none")}</li>
                : engines.map((engine) => <EngineRow key={engine.instanceId} engine={engine} bridge={bridge}
                    onSignedIn={() => setSigned((current) => new Set(current).add(engine.instanceId))} />)}
          </ul>}
      <div className="mt-1 flex items-center justify-end gap-2">
        <button type="button" className={mdSecondaryCls} onClick={onDone}>{t("vpsLink.signIn.skip")}</button>
        <button type="button" className={mdPrimaryCls} disabled={!anyReady} onClick={onDone}>{t("vpsLink.continue")}</button>
      </div>
    </div>
  );
}
