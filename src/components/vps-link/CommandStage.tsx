// the first two screens: the one line to paste, then the server setting itself up, mirrored here as it reports in
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { VpsLinkView, VpsStepId } from "@/lib/vps-link";
import { centered, CommandPill, ErrorNote, Footer, formatElapsed, Heading, PILL, ProgressBar, SOFT_PILL, useNow } from "./parts";

export const STEP_TITLE: Record<VpsStepId, LocaleKey> = {
  check: "vpsLink.step.check", basics: "vpsLink.step.basics", docker: "vpsLink.step.docker", user: "vpsLink.step.user", node: "vpsLink.step.node",
  app: "vpsLink.step.app", engines: "vpsLink.step.engines", service: "vpsLink.step.service", address: "vpsLink.step.address",
  desktop: "vpsLink.step.desktop", link: "vpsLink.step.link",
};
const CHEER_MS = 4000;

function minutesLeft(expiresAt: number | null, now: number): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

export function CommandScreen({ view, starting, onRetry, onCopied }: { view: VpsLinkView; starting: boolean; onRetry: () => void; onCopied: () => void }) {
  const now = useNow(15_000);
  const left = minutesLeft(view.expiresAt, now);
  const expired = left === 0;
  const [cheering, setCheering] = useState(false);
  useEffect(() => {
    if (!cheering) return;
    const timer = setTimeout(() => setCheering(false), CHEER_MS);
    return () => clearTimeout(timer);
  }, [cheering]);
  const copied = () => { setCheering(true); onCopied(); };
  return (
    <>
      <Heading>{t("vpsLink.command.title")}</Heading>
      <div className={cn(centered, "top-[calc(50%-28px)]")}>
        {view.command && !expired
          ? <CommandPill command={view.command} onCopied={copied} />
          : <div className="flex h-11 w-full items-center rounded-full border border-ink/10 px-4 text-[13px] leading-[18px] text-ink/56">
              {expired ? t("vpsLink.command.expired") : t("vpsLink.command.making")}
            </div>}
      </div>
      <div className={cn(centered, "top-[calc(50%+30px)] flex flex-col items-center gap-1 text-center")}>
        {cheering
          ? <p key="cheer" role="status" className="vps-land m-0 text-[13px] leading-[18px] text-ink">{t("vpsLink.command.copiedCheer")}</p>
          : <p key="how" className="m-0 text-[13px] leading-[18px] text-ink">{t("vpsLink.command.how")}</p>}
        <p className="m-0 max-w-[460px] text-[13px] leading-[18px] text-ink/56 text-pretty">{t("vpsLink.command.hint")}</p>
      </div>
      <Footer>
        {view.error
          ? <><ErrorNote>{view.error}</ErrorNote><button type="button" className={PILL} onClick={onRetry} disabled={starting}>{t("vpsLink.tryAgain")}</button></>
          : expired
            ? <button type="button" className={PILL} onClick={onRetry} disabled={starting}>{t("vpsLink.command.newOne")}</button>
            : view.command && <p role="status" className="m-0 flex items-center justify-center gap-2 text-[13px] leading-[18px] text-ink/68 text-pretty">
                <span aria-hidden="true" className="vps-waiting-dot size-1.5 shrink-0 rounded-full bg-success" />
                {left !== null ? t("vpsLink.command.waiting", { minutes: left }) : t("vpsLink.command.waitingPlain")}
              </p>}
      </Footer>
    </>
  );
}

type TermLine = { key: string; kind: "cmd" | "out" | "ok" | "fail" | "skip" | "log"; text: string };

function terminalLines(view: VpsLinkView): TermLine[] {
  if (view.terminal?.length) {
    const lines: TermLine[] = view.terminal.slice(-200).map((line, index) => ({
      key: `${line.step}:${index}`, kind: line.text.startsWith("$ ") ? "cmd" : "out", text: line.text,
    }));
    for (const step of view.steps) {
      if (step.status === "failed" && step.log) lines.push({ key: `${step.id}:log`, kind: "fail", text: step.log });
    }
    return lines;
  }
  const lines: TermLine[] = [];
  for (const step of view.steps) {
    if (step.status === "waiting") continue;
    if (step.cmd) lines.push({ key: `${step.id}:cmd`, kind: "cmd", text: `$ ${step.cmd}` });
    for (const [index, text] of (step.lines ?? []).entries()) lines.push({ key: `${step.id}:${index}`, kind: "out", text });
    const kind = step.status === "done" ? "ok" : step.status === "failed" ? "fail" : step.status === "skipped" ? "skip" : "out";
    lines.push({ key: `${step.id}:status`, kind, text: `${t(STEP_TITLE[step.id])} · ${t(`vpsLink.status.${step.status}`)}` });
    if (step.log) lines.push({ key: `${step.id}:log`, kind: "log", text: step.log });
  }
  return lines.slice(-200);
}

/** A window onto the server's terminal: near-black, mono, newest line at the bottom, a block cursor after the last. */
function Mirror({ view, className }: { view: VpsLinkView; className?: string }) {
  const lines = terminalLines(view);
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = lines[lines.length - 1]?.key;
  useLayoutEffect(() => {
    const node = body.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [lines.length, last]);
  return (
    <section aria-label={t("vpsLink.install.live")} className={cn("vps-term flex flex-col overflow-hidden", className)}>
      <div ref={body} role="log" aria-live="off" tabIndex={0} data-vps-term=""
        onScroll={(event) => { const node = event.currentTarget; pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24; }}
        className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3.5 py-3">
        {lines.slice(-6).map((line) => (
          <div key={line.key} data-vps-line={line.kind}
            className={cn("vps-term-line truncate whitespace-pre", line.kind === "fail" && "vps-term-fail")}>
            {line.text.split("\n").filter(Boolean).slice(-1)[0]}
          </div>
        ))}
      </div>
    </section>
  );
}

function CopyLog({ text }: { text: string }) {
  const { state, copy } = useCopyFeedback(text);
  return (
    <button type="button" className={SOFT_PILL} onClick={copy}>
      {state === "copied" ? t("vpsLink.install.logCopied") : state === "failed" ? t("common.copyFailed") : t("vpsLink.install.copyLog")}
    </button>
  );
}

export function InstallScreen({ view, onRetry }: { view: VpsLinkView; onRetry: () => void }) {
  const [start] = useState(() => Date.now());
  const now = useNow(1000);
  const failed = view.steps.find((step) => step.status === "failed");
  const running = view.steps.find((step) => step.status === "running");
  const next = view.steps.find((step) => step.status === "waiting");
  const finished = view.steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  const progress = Math.max(0.03, (finished + (running ? 0.5 : 0)) / view.steps.length);
  const current = failed ?? running ?? next;
  const label = failed
    ? t("vpsLink.install.stepFailed", { step: t(STEP_TITLE[failed.id]) })
    : current ? t(STEP_TITLE[current.id]) : t("vpsLink.install.almost");
  return (
    <>
      <Heading>{failed ? t("vpsLink.install.stuck") : t("vpsLink.install.title")}</Heading>
      <div className={cn(centered, "top-[calc(50%-40px)] flex flex-col gap-2.5")}>
        <div className="flex items-baseline gap-3">
          <p role="status" className={cn("m-0 min-w-0 flex-1 truncate text-[15px] leading-5", failed ? "text-danger" : "text-ink")}>{label}</p>
          <span aria-label={t("vpsLink.install.elapsedAria")} className="shrink-0 font-mono text-[12px] leading-4 tabular-nums text-ink/56">{formatElapsed(now - start)}</span>
        </div>
        <ProgressBar value={progress} label={t("vpsLink.install.progressAria")} tone={failed ? "danger" : undefined} />
      </div>
      {failed
        ? <>
            <div className={cn(centered, "top-[calc(50%+10px)] flex flex-col gap-2")}>
              <p className="m-0 text-center text-[13px] leading-[18px] text-ink/68 text-pretty">{t("vpsLink.install.rerun")}</p>
              {view.command && <CommandPill command={view.command} />}
            </div>
            <Mirror view={view} className={cn(centered, "top-[calc(50%+96px)] h-[92px]")} />
          </>
        : <Mirror view={view} className={cn(centered, "top-[calc(50%+4px)] h-[112px]")} />}
      <Footer>
        {view.error && <ErrorNote>{view.error}</ErrorNote>}
        {failed || view.error
          ? <>
              <button type="button" data-primary="" className={PILL} onClick={onRetry}>{t("vpsLink.tryAgain")}</button>
              {failed?.log && <CopyLog text={failed.log} />}
            </>
          : <p className="m-0 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.install.closeOk")}</p>}
      </Footer>
    </>
  );
}
