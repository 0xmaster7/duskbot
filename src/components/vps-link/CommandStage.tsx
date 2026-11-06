// the first two screens: the one line to paste, then the server setting itself up, mirrored here as it reports in
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { VpsLinkStep, VpsLinkView, VpsStepId } from "@/lib/vps-link";
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

/** A step as the installer reports it; newer installers also send the command it ran and its output lines. */
type StepOutput = VpsLinkStep & { cmd?: string; lines?: string[] };

/** What install.sh runs for each step, shown while a server does not send its own lines yet. "$ " starts a command. */
const SCRIPT: Record<VpsStepId, readonly string[]> = {
  check: ["$ dpkg --print-architecture", "$ . /etc/os-release", "$ test -d /run/systemd/system", "$ awk '/MemTotal/ { print $2 }' /proc/meminfo", "$ df -Pk /"],
  basics: [
    "$ apt-get -q -o DPkg::Lock::Timeout=300 update", "Reading package lists...",
    "$ apt-get -y -q install --no-install-recommends curl ca-certificates gnupg iproute2 procps tar xz-utils", "Reading package lists...", "Building dependency tree...", "Reading state information...",
    "Unpacking ca-certificates ...", "Unpacking gnupg ...", "Setting up ca-certificates ...", "Setting up gnupg ...", "Setting up xz-utils ...", "Processing triggers for libc-bin ...",
  ],
  docker: [
    "$ command -v docker", "$ apt-get -y -q install --no-install-recommends docker.io", "Reading package lists...", "Building dependency tree...", "Unpacking runc ...", "Unpacking containerd ...",
    "Unpacking docker.io ...", "Setting up runc ...", "Setting up containerd ...", "Setting up docker.io ...", "Created symlink /etc/systemd/system/sockets.target.wants/docker.socket.",
    "$ systemctl enable --now docker", "$ docker info", "$ docker --version",
  ],
  user: [
    "$ id maus", "$ useradd --create-home --home-dir /home/maus --shell /bin/bash maus", "$ usermod -aG docker maus",
    "$ install -d -o maus -g maus -m 0700 /home/maus/.local", "$ install -d -o maus -g maus -m 0700 /home/maus/.config/openmausbot", "$ install -d -o maus -g maus -m 0700 /home/maus/.config/openmausbot-link", "$ id maus",
  ],
  node: [
    "$ node -v", "$ curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource.key", "$ gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg /tmp/nodesource.key",
    "$ echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' > /etc/apt/sources.list.d/nodesource.list",
    "$ apt-get -q update", "Get:1 https://deb.nodesource.com/node_24.x nodistro InRelease", "Get:2 https://deb.nodesource.com/node_24.x nodistro/main Packages", "Reading package lists...",
    "$ apt-get -y -q install nodejs", "Reading package lists...", "Unpacking nodejs ...", "Setting up nodejs ...", "Processing triggers for man-db ...", "$ node -v && npm -v",
  ],
  app: [
    "$ runuser -u maus -- npm install --global --no-fund --no-audit --prefix /home/maus/.local openmausbot@latest", "npm http fetch GET 200 https://registry.npmjs.org/openmausbot",
    "reify: timing reifyNode:node_modules/openmausbot", "$ test -x /home/maus/.local/bin/openmausbot",
  ],
  engines: [
    "$ runuser -u maus -- npm install --global --no-fund --no-audit --prefix /home/maus/.local @anthropic-ai/claude-code @openai/codex",
    "npm http fetch GET 200 https://registry.npmjs.org/@anthropic-ai%2fclaude-code", "npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex",
    "reify: timing reifyNode:node_modules/@anthropic-ai/claude-code", "reify: timing reifyNode:node_modules/@openai/codex", "$ test -x /home/maus/.local/bin/claude", "$ test -x /home/maus/.local/bin/codex",
  ],
  service: [
    "$ install -m 0644 openmausbot.service /etc/systemd/system/openmausbot.service", "$ systemctl daemon-reload", "$ systemctl enable openmausbot.service openmausbot-engines.path",
    "Created symlink /etc/systemd/system/multi-user.target.wants/openmausbot.service.", "$ systemctl start openmausbot-engines.path", "$ systemctl restart openmausbot.service",
    "$ curl -fsS -m 3 http://127.0.0.1:8799/api/health",
  ],
  address: [
    "$ install -d -o root -g root -m 0755 /opt/openmausbot-link", "$ curl -fsSL https://link.apps.siddz.com/agent.mjs -o /opt/openmausbot-link/agent.mjs", "$ node /opt/openmausbot-link/agent.mjs probe",
  ],
  desktop: ["$ test -n \"$BOT_DESKTOP_IMAGE\"", "$ docker info", "$ docker pull \"$BOT_DESKTOP_IMAGE\"", "$ docker image inspect \"$BOT_DESKTOP_IMAGE\""],
  link: [
    "$ node /opt/openmausbot-link/agent.mjs link", "$ systemctl daemon-reload", "$ systemctl enable openmausbot-link.service", "$ systemctl restart openmausbot-link.service",
  ],
};
const MAX_LINES = 200;

type TermLine = { key: string; at: number; kind: "cmd" | "out" | "ok" | "fail" | "skip" | "log"; text: string };

function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true || document.documentElement.dataset.reducedMotion === "true";
}

/** How long a line takes to land after the one before it: a command thinks, output pours. Fixed per line, so a rerender
 * never reshuffles it. */
function delayBefore(text: string, index: number): number {
  const jitter = ((index * 2654435761) >>> 0) % 97;
  return text.startsWith("$ ") ? 360 + jitter * 6 : 40 + jitter;
}

/** The server's terminal as lines: the command each step ran, what it printed, then [ok], [skip] or [fail]. A step that
 * is still running pours its lines out one by one; under reduced motion they all land at once. */
function useTerminal(steps: StepOutput[], command: string | null, start: number): TermLine[] {
  const stamps = useRef(new Map<string, number>());
  const shown = useRef(new Map<VpsStepId, number>());
  const [, setTick] = useState(0);
  const stamp = (key: string) => {
    let at = stamps.current.get(key);
    if (at === undefined) { at = Date.now(); stamps.current.set(key, at); }
    return at;
  };
  const running = steps.find((step) => step.status === "running");
  const script = (step: StepOutput) => step.cmd || step.lines?.length ? [...(step.cmd ? [`$ ${step.cmd}`] : []), ...(step.lines ?? [])] : SCRIPT[step.id];
  const pouring = running && !running.cmd && !running.lines?.length ? running : null;
  const pourAt = pouring ? shown.current.get(pouring.id) ?? 0 : 0;
  const pourTotal = pouring ? SCRIPT[pouring.id].length : 0;
  const pourId = pouring?.id;
  useEffect(() => {
    if (!pourId || pourAt >= pourTotal) return;
    const step = pourId;
    const next = () => { shown.current.set(step, (shown.current.get(step) ?? 0) + 1); setTick((n) => n + 1); };
    if (reducedMotion()) { shown.current.set(step, pourTotal); setTick((n) => n + 1); return; }
    const timer = setTimeout(next, delayBefore(SCRIPT[step][pourAt]!, pourAt));
    return () => clearTimeout(timer);
  }, [pourId, pourAt, pourTotal]);

  const lines: TermLine[] = [];
  if (command) lines.push({ key: "command", at: start, kind: "cmd", text: command });
  for (const step of steps) {
    if (step.status === "waiting") continue;
    const all = script(step);
    const own = Boolean(step.cmd || step.lines?.length);
    // a step that stopped early only shows the made-up commands it got to, never ones it did not run
    const count = own || step.status === "done" ? all.length : Math.min(shown.current.get(step.id) ?? 0, all.length);
    const began = stamp(`${step.id}:begin`);
    for (let i = 0; i < count; i++) {
      const text = all[i]!;
      const cmd = text.startsWith("$ ");
      lines.push({ key: `${step.id}:${i}`, at: stamp(`${step.id}:${i}`), kind: cmd ? "cmd" : "out", text: cmd ? text.slice(2) : text });
    }
    if (step.status === "running") continue;
    const ended = stamp(`${step.id}:${step.status}`);
    // only a step seen starting has a duration; one first heard as finished shows none
    const took = ended - began > 50 ? `  ${((ended - began) / 1000).toFixed(1)}s` : "";
    const kind = step.status === "done" ? "ok" : step.status === "failed" ? "fail" : "skip";
    lines.push({ key: `${step.id}:${step.status}`, at: ended, kind, text: step.status === "failed" ? `${step.id}  exit 1${took}` : `${step.id}${took}` });
    if (step.log && step.status !== "done") lines.push({ key: `${step.id}:log`, at: ended, kind: "log", text: step.log.replace(/\n+$/, "") });
  }
  return lines.slice(-MAX_LINES);
}


/** A window onto the server's terminal: near-black, mono, newest line at the bottom, a block cursor after the last. */
function Mirror({ view, start, className }: { view: VpsLinkView; start: number; className?: string }) {
  const lines = useTerminal(view.steps as StepOutput[], view.command, start);
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
            {line.kind === "log" ? line.text.split("\n").filter(Boolean).slice(-1)[0] : line.text}
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
            <Mirror view={view} start={start} className={cn(centered, "top-[calc(50%+96px)] h-[92px]")} />
          </>
        : <Mirror view={view} start={start} className={cn(centered, "top-[calc(50%+4px)] h-[112px]")} />}
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
