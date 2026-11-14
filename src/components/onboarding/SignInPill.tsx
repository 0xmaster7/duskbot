import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, LoaderCircle } from "../../icons";
import { openExternalLink } from "@/lib/app-links";
import { cloudAsleep, cloudWaking } from "@/lib/cloud-power";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { engineSignedIn } from "@/lib/product-events";
import { trail } from "@/lib/trail";
import { api, useStore, type InstanceInfo } from "@/state/store";
import { StageSwap } from "./ConnectMotion";
import { ConnectFlow, type ConnectInstance, type ConnectState, type ConnectTarget } from "./connect-flow";

const QUIET = "min-h-8 rounded-full px-3 text-[13px] leading-[18px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none";
const SECONDARY = "inline-flex min-h-8 items-center gap-1.5 rounded-full bg-ink/[0.06] px-3 text-[13px] leading-[18px] text-ink transition-colors hover:bg-ink/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none";

/** The page a sign-in finishes on, by what people call it. */
export function siteName(driverKind: string): string {
  switch (driverKind) {
    case "codex": return "ChatGPT";
    case "claudeAgent": return "Claude";
    case "grokAgent": return "Grok";
    case "copilotAgent": return "GitHub";
    case "cursorAgent": return "Cursor";
    case "kimiAgent": return "Kimi";
    case "antigravityAgent": case "geminiAgent": return "Google";
    default: return "";
  }
}

/** One connect at a time for a whole grid: a new one cancels the running one, and leaving the grid cancels it too. */
export function useConnectFlow() {
  const { dispatch, refreshModels } = useStore();
  const flow = useMemo(() => new ConnectFlow({
    api: (path, init) => api(path, init),
    refresh: async () => {
      const { instances } = await api<{ instances: InstanceInfo[] }>("/api/instances?fresh=1", { timeoutMs: 120_000 });
      if (Array.isArray(instances)) dispatch({ type: "instances", instances });
      return (instances ?? []) as unknown as ConnectInstance[];
    },
    open: (link) => openExternalLink(link).then(() => true, () => false),
    ...(window.duskDesktop?.authRelay ? { relay: window.duskDesktop.authRelay } : {}),
    trail: (ev, fields) => trail(ev, fields),
    waking: () => cloudAsleep() || cloudWaking(),
  }), [dispatch]);
  const [state, setState] = useState<ConnectState>(flow.state);
  const models = useRef(refreshModels);
  models.current = refreshModels;
  useEffect(() => flow.subscribe((next) => {
    setState(next);
    if (next.stage === "connected" && !next.reused) {
      engineSignedIn(flow.target?.tile === "claude" ? "claude" : flow.target?.tile ?? "", "browser");
      void models.current(flow.instance).catch(() => {});
    }
  }), [flow]);
  useEffect(() => () => flow.cancel(), [flow]);
  return {
    state,
    target: flow.target,
    start: (target: ConnectTarget) => flow.start(target),
    cancel: () => flow.cancel(),
    retry: () => flow.retry(),
    openAgain: () => flow.openAgain(),
    submit: (code: string) => flow.submit(code),
  };
}

export type ConnectFlowHandle = ReturnType<typeof useConnectFlow>;

function useSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1_000));
}

export function PasteSlot({ name, onSubmit }: { name: string; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form data-sign-in="paste" className="flex w-[288px] max-w-full flex-col items-center gap-2" onSubmit={(event) => { event.preventDefault(); onSubmit(code); }}>
      <input autoFocus value={code} onChange={(event) => setCode(event.target.value)} aria-label={t("onboarding.meet.paste", { name })}
        placeholder={t("onboarding.meet.paste", { name })}
        className="h-9 w-full rounded-[18px] border-0 bg-ink/[0.06] px-4 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus-visible:bg-ink/[0.08]" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
      <button type="submit" disabled={!code.trim()} className={SECONDARY}>{t("onboarding.meet.pasteSubmit")}</button>
    </form>
  );
}

function Busy({ label, hint, seconds }: { label: string; hint?: string | null; seconds: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-1 text-center">
      <p className="m-0 flex items-center gap-2 text-[14px] leading-5 text-ink">
        <LoaderCircle size={14} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
        {label}
        {seconds >= 5 && <span className="tabular-nums text-ink-tertiary">{t("connect.elapsed", { seconds })}</span>}
      </p>
      {hint && <p className="m-0 max-w-[360px] text-[12px] leading-4 text-ink-secondary">{hint}</p>}
    </div>
  );
}

/** A link by its site and, for a code page, its path ("github.com/login/device"); a sign-in link by its site alone. */
const linkText = (link: string, withPath: boolean) => {
  try {
    const url = new URL(link);
    return withPath ? `${url.host}${url.pathname === "/" ? "" : url.pathname}` : url.host;
  } catch { return link; }
};

/** The one sign-in step every machine shows: where to finish (a blue link), the device code when there is one, one
 * button that copies the code (or the link) and opens the site, and a quiet waiting line. A browser that opened by
 * itself and needs no code shows the same step, so a cloud and this computer only differ by the code. */
function CodeStep({ code, site, link, onOpen, cancel }: { code: string | null; site: string; link: string | null; onOpen: (() => void) | null; cancel: React.ReactNode }) {
  const { state, copy } = useCopyFeedback(code ?? "");
  const copied = state === "copied";
  const waiting = <div role="status" aria-live="polite" className="flex items-center gap-2 text-[13px] leading-[18px] text-ink-secondary">
    <LoaderCircle size={13} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
    {code ? t("connect.stage.waiting") : t("connect.stage.finishInBrowser", { site })}
  </div>;
  // no code: the browser already opened, so only a way back to it and out
  if (!code) return <>
    {waiting}
    <div className="flex items-center gap-1.5">
      {link && onOpen && <button type="button" onClick={onOpen} className={SECONDARY}><ExternalLink size={13} aria-hidden="true" />{t("connect.openAgain")}</button>}
      {cancel}
    </div>
  </>;
  const [before, after = ""] = t("connect.stage.enterCode", { site: "\u0000" }).split("\u0000");
  return <>
    <button type="button" onClick={copy} data-sign-in="code" aria-label={t("connect.copyCode")}
      className="rounded-xl bg-composer px-4 py-1.5 font-mono text-[20px] font-medium tracking-[0.12em] text-ink transition-colors hover:bg-ink/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">{code}</button>
    <p className="m-0 text-center text-[13px] leading-[18px] text-ink-secondary">
      {before}{link && onOpen
        ? <button type="button" onClick={onOpen} className="text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{linkText(link, true)}</button>
        : site}{after}
    </p>
    <div className="flex items-center gap-1.5">
      <button type="button" data-connect-copy="" onClick={() => { void copy(); onOpen?.(); }} className="ui-button ui-button-pill ui-button-primary min-h-9 gap-1.5 px-4 text-[14px]">
        {copied ? <Check size={14} aria-hidden="true" /> : <ExternalLink size={14} aria-hidden="true" />}
        {copied ? t("connect.codeCopiedPaste", { site }) : onOpen ? t("connect.copyAndOpen", { site }) : t("connect.copyCode")}
      </button>
      {cancel}
    </div>
    {waiting}
  </>;
}

/** The pressed AI's connect, stage by stage: honest progress, a deadline on each step, and a way out of every one. */
export function ConnectPanel({ flow, name, driverKind, onTrouble }: {
  flow: ConnectFlowHandle;
  name: string;
  driverKind: string;
  onTrouble?: () => void;
}) {
  const { state } = flow;
  const since = "since" in state ? state.since : null;
  const seconds = useSeconds(since);
  const site = siteName(driverKind) || name;
  const cancel = <button type="button" onClick={flow.cancel} className={SECONDARY} data-connect-cancel="">{t("common.cancel")}</button>;

  let body: React.ReactNode;
  switch (state.stage) {
    case "idle":
      body = null;
      break;
    case "waking":
      body = <><Busy label={t("connect.stage.waking")} hint={t("connect.stage.wakingHint")} seconds={seconds} />{cancel}</>;
      break;
    case "preparing":
      body = <><Busy label={t("connect.stage.preparing", { name })} seconds={seconds} />{cancel}</>;
      break;
    case "installing": {
      const hint = state.downloadBytes
        ? t("connect.stage.downloadSize", { name, mb: Math.max(1, Math.round(state.downloadBytes / 1024 / 1024)) })
        : t("connect.stage.download", { name });
      body = <><Busy label={t("connect.stage.installing", { name })} hint={hint} seconds={seconds} />{cancel}</>;
      break;
    }
    case "opening":
      body = <><Busy label={t("connect.stage.opening", { name })} seconds={seconds} />{cancel}</>;
      break;
    case "confirming":
      body = <Busy label={t("connect.stage.confirming", { name })} seconds={seconds} />;
      break;
    case "connected":
      body = (
        <p role="status" className="m-0 flex items-center gap-1.5 text-[14px] leading-5 text-success">
          <Check size={14} strokeWidth={2.5} aria-hidden="true" className="connect-check-in" />{t("connect.stage.connected")}
        </p>
      );
      break;
    case "waiting":
      if (state.kind === "paste") {
        body = <>
          <PasteSlot name={name} onSubmit={flow.submit} />
          <div className="flex items-center gap-1">
            {state.link && <button type="button" onClick={() => void flow.openAgain()} className={QUIET}>{t("connect.openAgain")}</button>}
            {cancel}
          </div>
        </>;
      } else {
        body = <CodeStep code={state.code} site={site} link={state.link} onOpen={state.link ? () => void flow.openAgain() : null} cancel={cancel} />;
      }
      break;
    case "failed": {
      const installing = state.at === "installing";
      const plain = state.reason === "timeout" ? t(`connect.timeout.${state.at}`, { name })
        : state.reason === "lost" ? t("connect.lost")
          : installing ? t("connect.installFailed", { name })
            : state.message ?? (state.reason === "unavailable" ? t("connect.unavailable", { name }) : t("connect.failed", { name }));
      body = <>
        <p role="alert" className="m-0 max-w-[400px] text-center text-[13px] leading-[18px] text-danger">{plain}</p>
        <button type="button" onClick={flow.retry} className={SECONDARY}>{t("common.tryAgain")}</button>
        {onTrouble && !installing && <button type="button" onClick={onTrouble} className={QUIET} data-connect-trouble="">{t("connect.trouble")}</button>}
      </>;
      break;
    }
  }
  return (
    <StageSwap stage={state.stage === "waiting" ? `waiting-${state.kind}` : state.stage} className="w-full">
      <div data-connect-stage={state.stage} className="flex w-full flex-col items-center gap-2.5">{body}</div>
    </StageSwap>
  );
}
