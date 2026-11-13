import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { setEmailGateDone, track } from "@/lib/analytics";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { chiefFor, chiefStepFits, createChiefPatch, myDefaultBot, stageIntro, useViewerEmail } from "@/lib/default-bot";
import { completionPatch, DEFAULT_ADMIN_ORIGIN, firstRunPatch, markWelcomeFinished, resumeBeat, showWelcome, type BeatId } from "@/lib/onboarding";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import { movable } from "@/lib/bot-move";
import { openPlaceSetup, usePlaceSetupOpen } from "@/lib/place-setup";
import { localSetupImport } from "@/lib/setup-import";
import { api, useStore } from "@/state/store";
import { BringBotsView, useBotMove } from "../BringBots";
import { GrokMoveDialog } from "../lazy-screens";
import { AccountStep } from "./AccountStep";
import { AiStep } from "./AiStep";
import { funnelSteps, nextStep, previousStep, type FunnelStep } from "./funnel";
import { funnelAccount, type FunnelAccountState } from "./funnel-account";
import { FunnelBar, PhoneStep, PlaceStep, WelcomeStep } from "./FunnelSteps";
import { MakingStep } from "./MakingStep";
import { useWelcomeAi } from "./welcome-ai";
import { localDesktopPage } from "./WelcomeGate";
import "../../styles/onboarding.css";
import "../../styles/place-setup.css";

type Config = ReturnType<typeof useStore>["state"]["config"];

/** A genuine first run on this computer's own page names the person after its account, where their profile has none
 * (never on a Cloud, a Team Cloud or a remote page). The name stays theirs to change in Settings. */
async function nameFromComputer(config: Config, done: (config: NonNullable<Config>) => void): Promise<void> {
  const bridge = window.duskDesktop;
  if (!config || config.onboarding?.completedAt || config.profile?.name?.trim() || config.cloudHome || config.team) return;
  if (!localDesktopPage() || bridge?.remoteClient?.active) return;
  const name = await bridge?.desktopProfile?.systemName().catch(() => null);
  if (!name) return;
  try {
    done(await api<NonNullable<Config>>("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name } }), signal: AbortSignal.timeout(10_000) }));
  } catch {
  }
}

/** The plan sheet ended in a purchase: the account's own Cloud is paid for (being made, made, or a payment linking). */
export function cloudBought(account: { purchase?: unknown; machine?: { status: string }; clouds?: Array<{ primary: boolean; runsOn: string; status: string }> } | null): boolean {
  if (!account) return false;
  if (account.purchase) return true;
  if (account.clouds?.some((entry) => entry.primary && entry.runsOn === "cloud" && (entry.status === "setting_up" || entry.status === "ready"))) return true;
  return account.machine?.status === "provisioning" || account.machine?.status === "ready";
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab stay inside `root`, the way a modal dialog keeps them. */
export function trapTab(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (event.key !== "Tab" || !root) return;
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** The first run, one calm screen at a time: the welcome, a dusk bot account, where the bots live, an AI, bots from
 * another app (only when there are some), the phone. It ends in Dusk's chat (Dusk made the Chief of Staff where no other
 * bot is one), where Dusk greets and asks for whatever is still missing. On dusk cloud it is the plan sheet, the AI, then
 * the Cloud being made, and it ends in that Cloud's chat. */
export function WelcomeFlow({
  onDone,
  replay = false,
  initialBeat,
  embedded = false,
}: {
  onDone: (botId: string | null) => void;
  replay?: boolean;
  initialBeat?: BeatId;
  embedded?: boolean;
}) {
  const { state, dispatch } = useStore();
  const maus = myDefaultBot(state.bots, useViewerEmail());
  const keepsDraft = !replay && !embedded;
  const root = useRef<HTMLDivElement>(null);
  const finishing = useRef(false);
  const record = useRef(state.config?.onboarding);
  record.current = state.config?.onboarding;

  // the account: asked once where this window can sign in; a step only for someone not signed in yet
  const account = useMemo(() => (embedded ? null : funnelAccount()), [embedded]);
  const [known, setKnown] = useState<FunnelAccountState | null>(null);
  const firstKnown = useRef<FunnelAccountState | null>(null);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    const read = () => void account.state().then((next) => {
      if (!alive) return;
      firstKnown.current ??= next;
      setKnown(next);
    }, () => {});
    read();
    const stop = account.onChange(read);
    return () => { alive = false; stop(); };
  }, [account]);
  const desktop = !embedded && localDesktopPage() && window.duskDesktop?.remoteClient?.active !== true;
  const draft = useMemo(() => (keepsDraft ? readWelcomeDraft() : null), [keepsDraft]);
  const [cloud, setCloud] = useState(draft?.cloud === true);

  // bots another agent app keeps on this computer: their own step, only when there are some
  const offersMove = !replay && desktop && localSetupImport(state.config?.cloudHome === true);
  const move = useBotMove({ look: offersMove });
  const [grokOpen, setGrokOpen] = useState(false);
  const moveFound = Boolean(move.plan && (movable(move.plan) || move.plan.grokWaiting.length));

  const saved = initialBeat ?? draft?.beat;
  // once found, the step stays, so it still counts after its bots came over
  const bringing = useRef(saved === "bring");
  if (moveFound) bringing.current = true;
  const steps = funnelSteps({ account: Boolean(account) && !firstKnown.current?.signedIn, desktop, bring: bringing.current, cloud });

  const [at, setAt] = useState<FunnelStep>(() => resumeBeat(steps, saved));
  // the second click of a double click lands on the step it opened: it must not choose there
  const stepShownAt = useRef(0);
  useEffect(() => { stepShownAt.current = Date.now(); }, [at]);
  const swallowDoubleClick = (event: { detail: number; preventDefault(): void; stopPropagation(): void }) => {
    if (event.detail < 2 || Date.now() - stepShownAt.current > 600) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const [from, setFrom] = useState<"next" | "back">("next");
  const tested = useWelcomeAi(state.instances);

  useEffect(() => {
    track("onboarding_step", { step: at, replay });
    if (keepsDraft && !finishing.current) saveWelcomeDraft({ beat: at, ...(cloud ? { cloud: true as const } : {}) });
  }, [at, replay, keepsDraft, cloud]);

  // A Cloud sheet opened over the welcome never switches the window away from it (CloudAddDialog).
  useEffect(() => (embedded ? undefined : showWelcome()), [embedded]);
  useEffect(() => {
    if (!replay && !embedded) void nameFromComputer(state.config, (config) => dispatch({ type: "configStatus", config }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // each step's title takes focus, so a screen reader hears where it is
  useEffect(() => {
    const title = root.current?.querySelector<HTMLElement>("#welcome-title");
    if (title && !root.current?.querySelector("[autofocus]")) title.focus({ preventScroll: true });
    else if (!title) root.current?.focus({ preventScroll: true });
  }, [at]);

  const finish = useCallback(
    async (reason: "completed" | "skipped", botId: string | null) => {
      if (finishing.current) return;
      finishing.current = true;
      track("onboarding_completed", { reason, at, replay });
      setEmailGateDone("submitted");
      if (!replay && !embedded) markWelcomeFinished();
      if (keepsDraft) clearWelcomeDraft();
      onDone(botId);
      try {
        const patch = replay ? completionPatch() : firstRunPatch(record.current, new Date());
        const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
        dispatch({ type: "configStatus", config });
      } catch {
      }
    },
    [at, dispatch, onDone, replay, embedded, keepsDraft],
  );

  // where it fits, Dusk becomes the Chief of Staff and greets in its chat, with no screen to ask
  const toChat = useCallback(() => {
    if (finishing.current) return;
    const chief = Boolean(maus && chiefStepFits(state.bots, maus));
    if (chief && maus) dispatch({ type: "updateBot", botId: maus.id, patch: createChiefPatch(maus, chiefFor(state.bots, maus)) });
    const botId = chief ? maus!.id : null;
    if (botId && !replay) stageIntro(botId);
    void finish(botId ? "completed" : "skipped", botId);
  }, [maus, state.bots, dispatch, finish, replay]);

  const go = useCallback((step: FunnelStep | null, direction: "next" | "back") => {
    if (!step) { if (direction === "next") toChat(); return; }
    setFrom(direction);
    setAt(step);
  }, [toChat]);
  const next = useCallback(() => go(nextStep(steps, at), "next"), [go, steps, at]);
  const back = previousStep(steps, at);

  // signing in in the browser comes back here by itself
  const signedOutSeen = useRef(false);
  useEffect(() => {
    if (at !== "account" || !known) return;
    if (!known.signedIn) signedOutSeen.current = true;
    else if (signedOutSeen.current) { signedOutSeen.current = false; next(); }
  }, [at, known, next]);

  // dusk cloud's sheet opens over the funnel; once it is paid for, the sheet closes and the AI step follows, then the
  // Cloud being made. Closed without a purchase, the choice stays open.
  const [cloudOpen, setCloudOpen] = useState(false);
  const cloudSeen = useRef(false);
  useEffect(() => {
    if (!cloudOpen) return;
    if (state.cloudAdd) { cloudSeen.current = true; return; }
    if (!cloudSeen.current) return;
    cloudSeen.current = false;
    setCloudOpen(false);
    void window.duskDesktop?.cloudAccount?.state().then((account) => {
      if (!cloudBought(account)) return;
      track("onboarding_cloud", { action: "bought" });
      setCloud(true);
      setFrom("next");
      setAt("ai");
    }, () => {});
  }, [cloudOpen, state.cloudAdd]);
  const placeSheet = usePlaceSetupOpen();
  const chooseCloud = () => {
    track("onboarding_cloud", { action: "open" });
    if (window.duskDesktop?.cloudAccount && window.duskDesktop.remoteClient?.active !== true) {
      dispatch({ type: "openCloudAdd", source: "app_onboarding" });
      setCloudOpen(true);
      return;
    }
    void openExternalLink(`${DEFAULT_ADMIN_ORIGIN}/pricing`).catch(() => {});
    next();
  };
  const chooseMac = () => { setCloud(false); next(); };

  // a run resumed on the bring step whose bots are gone meanwhile goes on
  useEffect(() => {
    if (at === "bring" && move.step.kind === "nothing") { bringing.current = false; go(nextStep(steps, "bring"), "next"); }
  }, [at, move.step.kind, steps, go]);

  const overlayOpen = Boolean(state.cloudAdd) || Boolean(placeSheet) || grokOpen;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (event.defaultPrevented || overlayOpen) return;
      event.preventDefault();
      // Escape is "not now": past an optional step, never past an account the app needs
      if (at === "account" && known?.required) return;
      if (at === "welcome" || at === "account" || at === "place" || at === "making" || move.step.kind === "moving") return;
      next();
      return;
    }
    trapTab(event, root.current);
  };

  let body: ReactNode;
  switch (at) {
    case "welcome":
      body = <WelcomeStep onStart={next} />;
      break;
    case "account":
      body = account ? <AccountStep account={account} known={known} onDone={next} onSkip={known?.required ? null : next} /> : null;
      break;
    case "place":
      body = <PlaceStep onMac={chooseMac} onCloud={chooseCloud} onServer={() => openPlaceSetup("server")} />;
      break;
    case "ai":
      body = <AiStep tested={tested} onNext={next} />;
      break;
    case "bring":
      body = move.plan ? (
        <div className="mx-auto my-auto flex w-full flex-col items-center px-6 pb-12 pt-20">
          <BringBotsView plan={move.plan} step={move.step} bot={maus} variant="screen" onBring={() => void move.bring()}
            onSkip={next} onContinue={next} onGrok={() => setGrokOpen(true)} />
        </div>
      ) : null;
      break;
    case "phone":
      body = <PhoneStep onNext={next} />;
      break;
    case "making":
      body = <MakingStep onOpened={() => void finish("completed", null)} />;
      break;
  }

  const index = steps.indexOf(at);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-labelledby={at === "bring" ? "bot-move-title" : "welcome-title"}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClickCapture={swallowDoubleClick}
      data-welcome={at}
      className={cn("welcome-screen flex overflow-y-auto bg-app outline-none", embedded ? "relative h-full w-full" : "fixed inset-0 z-50")}
    >
      {at !== "welcome" && <FunnelBar at={index} count={steps.length} onBack={back ? () => go(back, "back") : null} />}
      <div key={at} data-from={from} className="place-step relative flex min-h-full w-full flex-col">
        {body}
      </div>
      {grokOpen && <GrokMoveDialog onClose={() => { setGrokOpen(false); void move.look(); }} />}
    </div>
  );
}
