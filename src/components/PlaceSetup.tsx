// Add a place, without leaving where the person is: dusk cloud (the buying sheet), or a server of their own, linked by one
// line through the relay with its progress shown live, or reached at an address it already has.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Cloud, Loader2, Server } from "../icons";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { closePlaceSetup, installChecklist, installPhase, pairingLink, usePlaceSetupOpen } from "@/lib/place-setup";
import { openAddVps, useVpsLink, type VpsLinkView } from "@/lib/vps-link";
import { useStore } from "@/state/store";
import { BackLink, Checklist, Heading, Tag } from "./cloud-buy/parts";
import { Choice, RailSheet } from "./PlaceAddSheet";
import { vpsProgress } from "./vps-link/progress";
import { message, useNow } from "./vps-link/parts";

type View = "choose" | "server" | "install" | "address";

const ROW = "flex w-full min-w-0 items-start gap-3 rounded-[12px] bg-ink/[0.035] px-4 py-3 text-start transition-colors hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none";
const BODY = "flex flex-col gap-5 px-[30px] pb-[26px] pt-7";

export function PlaceSetupHost() {
  const open = usePlaceSetupOpen();
  return open ? <PlaceSetup onClose={closePlaceSetup} /> : null;
}

/** `start`: the screen it opens on, for a test or a caller that already knows. */
export function PlaceSetup({ onClose, start }: { onClose: () => void; start?: View }) {
  const { dispatch } = useStore();
  const canBuy = Boolean(window.duskDesktop?.cloudAccount) && window.duskDesktop?.remoteClient?.active !== true;
  const [view, setView] = useState<View>(start ?? (canBuy ? "choose" : "server"));
  const cloud = () => { onClose(); dispatch({ type: "openCloudAdd", source: "app_settings" }); };
  return <RailSheet focusKey={view} onClose={onClose}>
    <div data-place-setup={view}>
      {view === "choose" && <div className={BODY}>
        <Heading title={t("placeSetup.title")} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Choice kind="cloud" icon={<Cloud size={19} />} title={t("rail.buy")} sub={t("placeSetup.cloudSub")} tag={t("rail.recommended")} onClick={cloud} />
          <Choice kind="server" icon={<Server size={19} />} title={t("placeSetup.server")} sub={t("placeSetup.serverSub")} onClick={() => setView("server")} />
        </div>
      </div>}
      {view === "server" && <div className={BODY}>
        {canBuy && <BackLink label={t("rail.back")} onClick={() => setView("choose")} />}
        <Heading title={t("placeSetup.how")} />
        <div className="flex flex-col gap-2">
          <button type="button" data-autofocus="" data-setup-method="relay" className={ROW} onClick={() => setView("install")}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[14px] leading-5 text-ink">{t("placeSetup.relay")}<Tag>{t("rail.recommended")}</Tag></span>
              <span className="block text-[13px] leading-[18px] text-ink-secondary">{t("placeSetup.relaySub")}</span>
            </span>
          </button>
          <button type="button" data-setup-method="address" className={ROW} onClick={() => setView("address")}>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] leading-5 text-ink">{t("placeSetup.address")}</span>
              <span className="block text-[13px] leading-[18px] text-ink-secondary">{t("placeSetup.addressSub")}</span>
            </span>
          </button>
        </div>
      </div>}
      {view === "install" && <InstallSetup onBack={() => setView("server")} onClose={onClose} />}
      {view === "address" && <AddressSetup onBack={() => setView("server")} onClose={onClose} />}
    </div>
  </RailSheet>;
}

/** The one line on an inset strip, with its copy button. */
function CopyLine({ text, label }: { text: string; label: string }) {
  const { state, copy } = useCopyFeedback(text);
  return <div className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[12px] bg-inset py-1.5 pe-1.5 ps-3.5">
    <code data-setup-command="" className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-[13px] leading-[18px] text-ink [scrollbar-width:none]">{text}</code>
    <button type="button" onClick={copy} aria-label={state === "copied" ? t("vpsLink.copied") : label}
      className="ui-button ui-button-pill inline-flex h-8 shrink-0 items-center px-3.5 text-[13px]">
      {state === "copied" ? t("vpsLink.copied") : state === "failed" ? t("common.copyFailed") : t("vpsLink.copy")}
    </button>
  </div>;
}

const STEP_WORD = { waiting: "placeSetup.step.waiting", found: "placeSetup.step.found", connecting: "placeSetup.step.connecting", done: "placeSetup.step.done" } as const;

/** One line through the relay: the line, then the server checking in, setting up and linking, then open it. */
export function InstallSetup({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { view, bridge, ready, update } = useVpsLink();
  const now = useNow(5_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const asked = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback((work: () => Promise<VpsLinkView>) => {
    setBusy(true);
    setError("");
    void update(work).catch((cause) => { if (alive.current) setError(message(cause)); }).finally(() => { if (alive.current) setBusy(false); });
  }, [update]);
  // a line is made once on arriving; one already under way is picked up where it is
  useEffect(() => {
    if (!bridge || !ready || asked.current) return;
    asked.current = true;
    if (view.stage === "idle" && !view.error) run(() => bridge.start());
  }, [bridge, ready, view, run]);
  if (!bridge) return null;

  const shown: VpsLinkView = error ? { ...view, error } : view;
  const phase = installPhase(shown, now);
  const name = shown.server?.name ?? t("vpsLink.yourServer");
  const progress = vpsProgress(shown);
  const stopped = phase === "failed" || phase === "expired";
  // a stop leaves its step still, saying so in words rather than a turning mark
  const steps = installChecklist(shown, now).map((step) => ({
    key: step.key, state: stopped && step.state === "now" ? "next" as const : step.state,
    title: t(STEP_WORD[step.key]),
    detail: stopped && step.state === "now" ? t("placeSetup.status.failed")
      : step.state === "now" && step.key === "connecting" && phase === "connecting" ? [progress.title, progress.detail].filter(Boolean).join(" · ") : null,
  }));
  const fresh = () => run(async () => { await bridge.reset(); return bridge.start(); });
  const openIt = () => {
    setBusy(true);
    setError("");
    void bridge.open().then(onClose, () => { if (alive.current) setError(t("placeSetup.openFailed", { name })); }).finally(() => { if (alive.current) setBusy(false); });
  };

  return <div className={BODY} data-install-phase={phase}>
    <BackLink label={t("rail.back")} onClick={onBack} />
    <Heading title={phase === "done" ? t("placeSetup.doneTitle", { name }) : t("placeSetup.install.title")}
      sub={phase === "done" ? t("placeSetup.doneBody") : t("placeSetup.install.what")} />
    {phase !== "done" && (shown.command && phase !== "expired"
      ? <CopyLine text={shown.command} label={t("vpsLink.copyAria")} />
      : phase !== "expired" && <p role="status" className="flex min-h-11 items-center rounded-[12px] bg-inset px-3.5 text-[13px] text-ink-secondary">{t("vpsLink.command.making")}</p>)}
    <div aria-live="polite"><Checklist items={steps} /></div>
    {phase === "failed" && <p role="alert" className="text-[13px] leading-[18px] text-danger [overflow-wrap:anywhere]">{progress.error ?? shown.error ?? t("vpsLink.move.failed")}</p>}
    {phase === "expired" && <p role="alert" className="text-[13px] leading-[18px] text-ink-secondary">{t("placeSetup.expired")}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {phase === "done" && <button type="button" data-autofocus="" className="ui-button ui-button-primary inline-flex items-center gap-2" disabled={busy} onClick={openIt}>
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{t("placeSetup.open", { name })}
      </button>}
      {(phase === "failed" || phase === "expired") && <button type="button" className="ui-button ui-button-primary" disabled={busy} onClick={fresh}>
        {phase === "expired" ? t("placeSetup.newLine") : t("vpsLink.tryAgain")}
      </button>}
      {phase !== "starting" && <button type="button" data-setup-details="" className="ui-button" onClick={() => { onClose(); openAddVps(); }}>{t("placeSetup.details")}</button>}
    </div>
  </div>;
}

const WAYS = [
  { key: "domain", title: "placeSetup.way.domain", hint: "placeSetup.way.domainHint", command: "duskbot serve --domain bots.example.com" },
  { key: "tailscale", title: "placeSetup.way.tailscale", hint: "placeSetup.way.tailscaleHint", command: "duskbot serve --tailscale" },
  { key: "tunnel", title: "placeSetup.way.tunnel", hint: "placeSetup.way.tunnelHint", command: "duskbot login && duskbot serve --tunnel" },
  { key: "ssh", title: "placeSetup.way.ssh", hint: "placeSetup.way.sshHint", command: "ssh -N -L 8790:127.0.0.1:8799 you@your-server" },
] as const;

const FIELD = "w-full rounded-lg border border-transparent bg-inset px-3 py-2 text-[14px] font-normal text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus/60";

/** A server already reachable at an address: its pairing link, or the address and a code; main asks before it connects. */
export function AddressSetup({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: "address" | "code" | null; text: string } | null>(null);
  const [way, setWay] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const made = pairingLink(address, code);
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
  return <form data-place-setup-address="" noValidate onSubmit={(event) => void submit(event)} className={BODY}>
    <BackLink label={t("rail.back")} onClick={onBack} />
    <Heading title={t("placeSetup.addressTitle")} sub={t("placeSetup.addressLede")} />
    <label className="flex flex-col gap-1.5 text-[13px] text-ink">{t("placeSetup.addressLabel")}
      <input data-autofocus="" data-setup-address="" value={address} disabled={busy} onChange={(event) => { setAddress(event.target.value); setError(null); }}
        placeholder="https://" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
        aria-invalid={error?.field === "address" || undefined} aria-describedby={error?.field === "address" ? "setup-error" : undefined} className={FIELD} />
    </label>
    <label className="flex flex-col gap-1.5 text-[13px] text-ink">{t("placeSetup.codeLabel")}
      <input data-setup-code="" value={code} disabled={busy} onChange={(event) => { setCode(event.target.value); setError(null); }}
        placeholder="ABCD-2345-EFGH" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
        aria-invalid={error?.field === "code" || undefined} aria-describedby={error?.field === "code" ? "setup-error setup-code-hint" : "setup-code-hint"} className={cn(FIELD, "font-mono")} />
      <span id="setup-code-hint" className="text-[12px] leading-4 text-ink-secondary">{t("placeSetup.codeHint")}</span>
    </label>
    {error && <p id="setup-error" role="alert" className="text-[13px] leading-[18px] text-danger [overflow-wrap:anywhere]">{error.text}</p>}
    <div><button type="submit" disabled={busy || !address.trim()} className="ui-button ui-button-primary inline-flex items-center gap-2">
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{busy ? t("placeSetup.connecting") : t("placeSetup.connect")}
    </button></div>
    <div className="flex flex-col gap-1">
      <p className="text-[13px] leading-[18px] text-ink-secondary">{t("placeSetup.ways")}</p>
      {WAYS.map((entry) => {
        const shown = way === entry.key;
        return <div key={entry.key} data-setup-way={entry.key} className="flex flex-col gap-2">
          <button type="button" aria-expanded={shown} onClick={() => setWay(shown ? null : entry.key)}
            className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-start text-[14px] leading-5 text-ink transition-colors hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:outline-focus motion-reduce:transition-none">
            {t(entry.title)}<ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform duration-150 ease-out motion-reduce:transition-none", shown && "rotate-90")} />
          </button>
          {shown && <div className="flex flex-col gap-2 pb-2">
            <p className="text-[13px] leading-[18px] text-ink-secondary">{t(entry.hint)}</p>
            <CopyLine text={entry.command} label={t("vpsLink.copyAria")} />
          </div>}
        </div>;
      })}
    </div>
  </form>;
}
