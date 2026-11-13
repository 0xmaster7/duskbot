// Add a place, without leaving where the person is: dusk cloud (the buying sheet), or a server of their own, linked by one
// line through the relay with its progress shown live, or reached at an address it serves after one command there.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Building2, ChevronRight, Loader2, UserRound } from "../icons";
import type { RailAddChoices } from "../../electron/cloud-rail.mjs";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { installChecklist, installPhase, pairingLink } from "@/lib/place-setup";
import { usePlaces } from "@/lib/places";
import { openAddVps, useVpsLink, vpsLinkAvailable, type VpsLinkView } from "@/lib/vps-link";
import { AddCloudFlow } from "./cloud-buy/AddCloudFlow";
import { NewOrganization } from "./cloud-buy/NewOrganization";
import { BackLink, Checklist, Heading, Tag } from "./cloud-buy/parts";
import { Choice, RailSheet } from "./PlaceAddSheet";
import { vpsProgress } from "./vps-link/progress";
import { message, useNow } from "./vps-link/parts";
import { PlaceArt, type PlaceArtName } from "./ui/PlaceArt";
import "../styles/place-setup.css";

// Node for npx on Ubuntu and Debian (docs/deploy-vps.md), so each way's line works on a fresh server
const NODE = "curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs && ";

/** The ways a server of one's own connects besides the relay, in the order they are offered. Each is one line that
 * installs and starts dusk bot on the server, then the address and code it prints. */
export const WAYS = [
  { key: "tailscale", title: "placeSetup.way.tailscale", sub: "placeSetup.way.tailscaleSub", command: `${NODE}npx -y duskbot serve --tailscale`, placeholder: "https://your-server.your-tailnet.ts.net" },
  { key: "tunnel", title: "placeSetup.way.tunnel", sub: "placeSetup.way.tunnelSub", command: `${NODE}npx -y duskbot login && npx -y duskbot serve --tunnel`, placeholder: "https://c-….cloud.dusk.bot" },
  { key: "domain", title: "placeSetup.way.domain", sub: "placeSetup.way.domainSub", command: `${NODE}npx -y duskbot serve --domain bots.example.com`, placeholder: "https://bots.example.com" },
  // the server's dusk bot listens on 8799, and so does this computer's own, so the tunnel lands on 8790 here
  { key: "ssh", title: "placeSetup.way.ssh", sub: "placeSetup.way.sshSub", command: `${NODE}npx -y duskbot serve`, local: "ssh -N -L 8790:127.0.0.1:8799 you@your-server", address: "http://127.0.0.1:8790", placeholder: "http://127.0.0.1:8790" },
  { key: "address", title: "placeSetup.way.address", sub: "placeSetup.way.addressSub", command: `${NODE}npx -y duskbot serve --public-url https://bots.example.com`, placeholder: "https://bots.example.com" },
] as const satisfies ReadonlyArray<{ key: string; title: string; sub: string; command: string; placeholder: string; local?: string; address?: string }>;
export type WayKey = (typeof WAYS)[number]["key"];
type Way = (typeof WAYS)[number];
export const wayOf = (key: string): Way | undefined => WAYS.find((entry) => entry.key === key);

export type PlaceSetupView = "choose" | "server" | "install" | "cloud" | "organization" | `way:${WayKey}`;
type View = PlaceSetupView;

const ROW = "flex w-full min-w-0 items-center gap-3.5 rounded-[12px] bg-ink/[0.035] px-4 py-3 text-start transition-colors hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none";
const QUIET = "-ms-1 inline-flex min-h-8 items-center gap-1.5 self-start rounded-full px-1 text-[13px] leading-[18px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none";
const BODY = "flex flex-col gap-5 px-[30px] pb-[26px] pt-7";
const INLINE = "flex flex-col gap-5";
const depth = (view: View) => (view === "choose" ? 0 : view === "server" || view === "cloud" || view === "organization" ? 1 : 2);

/** The one sheet for adding a place, from the rail's ＋, the places hub, the switcher and Settings (it never reads the
 * app's store, so the window's own rail can draw it too). `choices`: main's offer for the rail (a new organization,
 * another account); `onBuy`: buying a first dusk cloud; `onServer`: the rail hands a server of one's own to the app
 * window's sheet, which has the setup's whole flow; `connect`: a server of theirs signed in to their account but not
 * connected to this app yet; `start`: the screen it opens on. */
export function PlaceSetup({ onClose, start, choices, onAccount, onBuy, onServer, connect }: {
  onClose: () => void; start?: PlaceSetupView; choices?: RailAddChoices; onAccount?: () => void; onBuy?: () => void; onServer?: () => void; connect?: string;
}) {
  const rail = usePlaces();
  const canBuy = (choices ? choices.cloud : Boolean(window.duskDesktop?.cloudAccount)) && window.duskDesktop?.remoteClient?.active !== true;
  const organization = choices?.organization === true;
  const account = choices?.account === true && Boolean(onAccount);
  const server = choices ? choices.link || choices.address === true : true;
  const first = canBuy || organization || account || !server;
  // a new organization as the only thing to add opens at once
  const only = organization && !canBuy && !account && !server;
  const [view, setViewNow] = useState<View>(start ?? (connect ? "way:address" : only ? "organization" : first ? "choose" : "server"));
  const [wide, setWide] = useState(false);
  // which side the step came from, so it slides in from there
  const [from, setFrom] = useState<"next" | "back">("next");
  const setView = (next: View) => { setFrom(depth(next) < depth(view) ? "back" : "next"); setViewNow(next); };
  const step = (kind: string) => { if (choices) track("rail_add", { step: kind }); };
  const cloud = () => {
    step("cloud");
    // someone with a cloud already buys another one here; a first one is bought on this computer's own sheet
    if (rail.places.some((place) => place.kind === "cloud")) { setView("cloud"); return; }
    onClose();
    onBuy?.();
  };
  const firstCloud = () => { onClose(); void window.duskDesktop?.workspaces?.add?.("cloud").catch(() => {}); };
  const back = (to: View) => () => setView(to);
  const fromServer = connect ? undefined : back("server");
  return <RailSheet above wide={view === "cloud" && wide} focusKey={view} onClose={onClose}>
    <div key={view} data-place-setup={view} data-from={from} className="place-step">
      {view === "choose" && <div className={BODY}>
        <Heading title={t("placeSetup.title")} />
        <div className="flex flex-col gap-3 sm:flex-row">
          {canBuy && <Choice kind="cloud" art icon={<PlaceArt name="cloud" size={44} />} title={t("rail.buy")} sub={t("placeSetup.cloudSub")} tag={t("rail.recommended")} onClick={cloud} />}
          {server && <Choice kind="server" art icon={<PlaceArt name="server" size={44} />} title={t("placeSetup.server")} sub={t("placeSetup.serverSub")} onClick={() => { step("server"); if (onServer) { onClose(); onServer(); } else setView("server"); }} />}
        </div>
        {(organization || account) && <div className="-mt-1 flex flex-wrap gap-x-4">
          {organization && <button type="button" data-place-add-choice="organization" className={QUIET} onClick={() => setView("organization")}>
            <Building2 size={15} strokeWidth={1.5} aria-hidden="true" />{t("rail.org")}
          </button>}
          {account && <button type="button" data-place-add-choice="account" className={QUIET} onClick={() => onAccount!()}>
            <UserRound size={15} strokeWidth={1.5} aria-hidden="true" />{t("accounts.add")}
          </button>}
        </div>}
      </div>}
      {view === "server" && <div className={BODY}>
        {first && <BackLink label={t("rail.back")} onClick={back("choose")} />}
        <Heading title={t("placeSetup.how")} />
        <ServerWays onPick={(key) => setView(key === "relay" ? "install" : `way:${key}`)} />
      </div>}
      {view === "install" && <InstallSetup onBack={back("server")} onClose={onClose} />}
      {view.startsWith("way:") && <WaySetup way={wayOf(view.slice(4))!} title={connect ? t("rail.connectTitle", { name: connect }) : undefined} onBack={fromServer} onClose={onClose} />}
      {view === "cloud" && <AddCloudFlow onClose={onClose} onFirstCloud={firstCloud} onWide={setWide} onBack={back("choose")} />}
      {view === "organization" && <NewOrganization onClose={onClose} onBack={only ? null : back("choose")} />}
    </div>
  </RailSheet>;
}

/** Every way a server of one's own connects, as one list: the relay first, then the ways that need an address. */
export function ServerWays({ onPick }: { onPick: (key: "relay" | WayKey) => void }) {
  const relay = vpsLinkAvailable();
  const address = Boolean(window.duskDesktop?.workspaces?.add);
  const rows = [
    ...(relay ? [{ key: "relay" as const, title: t("placeSetup.relay"), sub: t("placeSetup.relaySub"), tag: true }] : []),
    ...(address ? WAYS.map((entry) => ({ key: entry.key, title: t(entry.title), sub: t(entry.sub), tag: false })) : []),
  ];
  return <div className="flex flex-col gap-1.5">
    {rows.map((row, index) => <button key={row.key} type="button" data-autofocus={index === 0 ? "" : undefined} data-setup-method={row.key} className={ROW} onClick={() => onPick(row.key)}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[14px] leading-5 text-ink">{row.title}{row.tag && <Tag>{t("rail.recommended")}</Tag>}</span>
        <span className="block text-[13px] leading-[18px] text-ink-secondary">{row.sub}</span>
      </span>
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary rtl:-scale-x-100" />
    </button>)}
  </div>;
}

/** A command on an inset strip, all of it shown (wrapped), with its copy button. */
function CopyLine({ text, label }: { text: string; label: string }) {
  const { state, copy } = useCopyFeedback(text);
  return <div className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[12px] bg-inset py-1.5 pe-1.5 ps-3.5">
    <code data-setup-command="" className="min-w-0 flex-1 select-all py-1 font-mono text-[13px] leading-[18px] text-ink [overflow-wrap:anywhere]">{text}</code>
    <button type="button" onClick={copy} aria-label={state === "copied" ? t("vpsLink.copied") : label}
      className="ui-button ui-button-pill inline-flex h-8 shrink-0 items-center px-3.5 text-[13px]">
      {state === "copied" ? t("vpsLink.copied") : state === "failed" ? t("common.copyFailed") : t("vpsLink.copy")}
    </button>
  </div>;
}

const PHASE_ART: Record<ReturnType<typeof installPhase>, PlaceArtName> = {
  starting: "waiting", waiting: "waiting", found: "found", connecting: "setup", done: "connected", failed: "error", expired: "expired",
};

const STEP_WORD = { waiting: "placeSetup.step.waiting", found: "placeSetup.step.found", connecting: "placeSetup.step.connecting", done: "placeSetup.step.done" } as const;

/** One line through the relay: the line, then the server checking in, setting up and linking, then on to signing in its AI
 * and moving the bots. `onBack` absent: drawn inline on a page that has its own title and way back (Settings). */
export function InstallSetup({ onBack, onClose }: { onBack?: () => void; onClose: () => void }) {
  const { view, bridge, ready, update } = useVpsLink();
  const now = useNow(5_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const asked = useRef(false);
  // until the first line is asked for, a server linked before reads as "starting", never as this setup's "connected"
  const [making, setMaking] = useState(true);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback((work: () => Promise<VpsLinkView>) => {
    setBusy(true);
    setError("");
    return update(work).catch((cause) => { if (alive.current) setError(message(cause)); }).finally(() => { if (alive.current) setBusy(false); });
  }, [update]);
  // arriving always makes a new line, so any number of servers can be added; one already under way is picked up where
  // it is, and a move of bots under way is left to finish
  useEffect(() => {
    if (!bridge || !ready || asked.current) return;
    asked.current = true;
    const underway = view.stage === "command" || view.stage === "installing" || (view.stage === "moving" && view.move?.status === "running");
    if (underway) { setMaking(false); return; }
    void run(() => bridge.start()).finally(() => { if (alive.current) setMaking(false); });
  }, [bridge, ready, view, run]);
  if (!bridge) return null;

  const shown: VpsLinkView = error ? { ...view, error } : view;
  const phase = making && !error ? "starting" : installPhase(shown, now);
  const name = shown.server?.name ?? t("vpsLink.yourServer");
  const progress = vpsProgress(shown);
  const stopped = phase === "failed" || phase === "expired";
  // a failed step's line still works: pasting it again picks up where it stopped
  const line = shown.command && phase !== "expired" && phase !== "done" ? shown.command : null;
  const steps = installChecklist(shown, now).map((step) => ({
    key: step.key, state: stopped && step.state === "now" ? "next" as const : step.state,
    title: t(step.key === "waiting" && step.state === "done" ? "placeSetup.step.waited" : STEP_WORD[step.key]),
    detail: stopped && step.state === "now" ? t(phase === "expired" ? "placeSetup.status.expired" : "placeSetup.status.failed")
      : step.state === "now" && step.key === "connecting" && phase === "connecting" ? [progress.title, progress.detail].filter(Boolean).join(" · ") : null,
  }));
  const fresh = () => { void run(async () => { await bridge.reset(); return bridge.start(); }); };
  const openIt = () => {
    setBusy(true);
    setError("");
    void bridge.open().then(onClose, () => { if (alive.current) setError(t("placeSetup.openFailed", { name })); }).finally(() => { if (alive.current) setBusy(false); });
  };
  const signIn = () => { onClose(); openAddVps(); };
  const failure = progress.error ?? shown.error ?? t("vpsLink.move.failed");
  const [title, sub] = phase === "done" ? [t("placeSetup.doneTitle", { name }), t("placeSetup.doneBody")]
    : phase === "expired" ? [t("placeSetup.expiredTitle"), t("placeSetup.expired")]
      : phase === "failed" ? [t("vpsLink.install.stuck"), line ? t("vpsLink.install.rerun") : null]
        : [t("placeSetup.install.title"), t("placeSetup.install.what")];
  // in Settings the page's own title names the way, so only a change of state gets a heading
  const headed = Boolean(onBack) || stopped || phase === "done";

  return <div className={onBack ? BODY : INLINE} data-install-phase={phase}>
    {onBack && <BackLink label={t("rail.back")} onClick={onBack} />}
    <div className="flex items-start gap-4">
      <span key={PHASE_ART[phase]} data-phase-art={PHASE_ART[phase]} className="place-mark grid size-12 shrink-0 place-items-center rounded-[12px] bg-ink/[0.04]">
        <PlaceArt name={PHASE_ART[phase]} size={33} />
      </span>
      {headed ? <Heading title={title} sub={sub ?? undefined} />
        : <p className="self-center text-[14px] leading-5 text-ink-secondary [text-wrap:pretty]">{sub}</p>}
    </div>
    {line && <CopyLine text={line} label={t("vpsLink.copyAria")} />}
    {phase === "starting" && <p role="status" className="flex min-h-11 items-center rounded-[12px] bg-inset px-3.5 text-[13px] text-ink-secondary motion-safe:animate-pulse">{t("vpsLink.command.making")}</p>}
    {phase === "done" && shown.mode && <p data-setup-via={shown.mode} className="place-reveal -mt-1 flex items-center gap-2 text-[13px] leading-[18px] text-ink-secondary">
      <PlaceArt name={shown.mode === "direct" ? "direct" : "relay"} size={22} />{t(shown.mode === "direct" ? "placeSetup.via.direct" : "placeSetup.via.relay")}
    </p>}
    {phase !== "starting" && <div aria-live="polite"><Checklist items={steps} /></div>}
    {phase === "failed" && <p role="alert" className="place-reveal text-[13px] leading-[18px] text-danger [overflow-wrap:anywhere]">{failure}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {phase === "done" && <>
        <button type="button" data-autofocus="" data-setup-next="" className="ui-button ui-button-primary" disabled={busy} onClick={signIn}>{t("vpsLink.signIn.title")}</button>
        <button type="button" data-setup-open="" className="ui-button inline-flex items-center gap-2" disabled={busy} onClick={openIt}>
          {busy && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{t("placeSetup.open", { name })}
        </button>
      </>}
      {stopped && <button type="button" data-setup-new="" className={cn("ui-button", !line && "ui-button-primary")} disabled={busy} onClick={fresh}>
        {line || phase === "expired" ? t("placeSetup.newLine") : t("vpsLink.tryAgain")}
      </button>}
      {phase !== "starting" && phase !== "done" && <button type="button" data-setup-details="" className="ui-button" onClick={() => { onClose(); openAddVps(); }}>{t("placeSetup.details")}</button>}
    </div>
  </div>;
}

const FIELD = "w-full rounded-lg border border-transparent bg-inset px-3 py-2 text-[14px] font-normal text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus/60";

/** A way that needs an address: one command on the server (and, for an SSH tunnel, one here), then the address and code it
 * prints; main asks before it connects. `onBack` absent: drawn inline on a page that has its own title and way back. */
export function WaySetup({ way, title, onBack, onClose }: { way: Way; title?: string; onBack?: () => void; onClose: () => void }) {
  const fixed = "address" in way ? way.address : "";
  const [address, setAddress] = useState(fixed);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: "address" | "code" | null; text: string } | null>(null);
  // a whole pairing link carries its code
  const linked = /#code=/.test(address);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const made = pairingLink(address, linked ? "" : code);
    if ("error" in made) { setError({ field: made.error, text: t(made.error === "code" ? "placeSetup.badCode" : "placeSetup.badAddress") }); return; }
    setBusy(true);
    setError(null);
    try {
      if (await window.duskDesktop?.workspaces?.add?.("link", made.link) !== false) onClose();
    } catch (cause) {
      setError({ field: null, text: message(cause) });
    } finally {
      setBusy(false);
    }
  };
  const note = "text-[13px] leading-[18px] text-ink-secondary [text-wrap:pretty]";
  return <form data-place-setup-way={way.key} noValidate onSubmit={(event) => void submit(event)} className={onBack ? BODY : INLINE}>
    {onBack && <BackLink label={t("rail.back")} onClick={onBack} />}
    {onBack || title ? <Heading title={title ?? t(way.title)} sub={t(way.sub)} /> : <p className="text-[14px] leading-5 text-ink-secondary [text-wrap:pretty]">{t(way.sub)}</p>}
    <div className="flex flex-col gap-2">
      <p className={note}>{t("placeSetup.run")}</p>
      <CopyLine text={way.command} label={t("vpsLink.copyAria")} />
    </div>
    {"local" in way && <div className="flex flex-col gap-2">
      <p className={note}>{t("placeSetup.runLocal")}</p>
      <CopyLine text={way.local} label={t("vpsLink.copyAria")} />
    </div>}
    {!fixed && <label className="flex flex-col gap-1.5 text-[13px] text-ink">{t("placeSetup.addressLabel")}
      <input data-autofocus="" data-setup-address="" value={address} disabled={busy} onChange={(event) => { setAddress(event.target.value); setError(null); }}
        placeholder={way.placeholder} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
        aria-invalid={error?.field === "address" || undefined} aria-describedby={error?.field === "address" ? "setup-error setup-address-hint" : "setup-address-hint"} className={FIELD} />
      <span id="setup-address-hint" className="text-[12px] leading-4 text-ink-secondary">{t("placeSetup.addressHint")}</span>
    </label>}
    {!linked && <label className="flex flex-col gap-1.5 text-[13px] text-ink">{t("placeSetup.codeLabel")}
      <input data-autofocus={fixed ? "" : undefined} data-setup-code="" value={code} disabled={busy} onChange={(event) => { setCode(event.target.value); setError(null); }}
        placeholder="ABCD-2345-EFGH" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
        aria-invalid={error?.field === "code" || undefined} aria-describedby={error?.field === "code" ? "setup-error setup-code-hint" : "setup-code-hint"} className={cn(FIELD, "font-mono")} />
      <span id="setup-code-hint" className="text-[12px] leading-4 text-ink-secondary">{t("placeSetup.codeHint")}</span>
    </label>}
    {error && <p id="setup-error" role="alert" className="text-[13px] leading-[18px] text-danger [overflow-wrap:anywhere]">{error.text}</p>}
    <div><button type="submit" disabled={busy || !address.trim() || (Boolean(fixed) && !code.trim())} className="ui-button ui-button-primary inline-flex items-center gap-2">
      {busy && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{busy ? t("placeSetup.connecting") : t("placeSetup.connect")}
    </button></div>
  </form>;
}
