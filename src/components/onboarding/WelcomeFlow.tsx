import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { setEmailGateDone, track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { chiefFor, chiefStepFits, createChiefPatch, myDefaultBot, stageIntro, useViewerEmail } from "@/lib/default-bot";
import { BEAT_ORDER, completionPatch, firstRunPatch, markWelcomeFinished, resumeBeat, showWelcome, type BeatId } from "@/lib/onboarding";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import { movable } from "@/lib/bot-move";
import { localSetupImport } from "@/lib/setup-import";
import { api, useStore } from "@/state/store";
import { BringBotsView, useBotMove } from "../BringBots";
import { engineReady } from "../EngineLibrary";
import { GrokMoveDialog } from "../lazy-screens";
import { freeFallback } from "../../../shared/ai-ranking";
import { SignInStep } from "./SignInStep";
import { aiLine, useWelcomeAi } from "./welcome-ai";
import { localDesktopPage } from "./WelcomeGate";
import "../../styles/onboarding.css";

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

/** How long the first run waits for the bots and the AIs to be listed before it goes to the chat anyway. */
export const AI_WAIT_MS = 4_000;

/** The first run lands in the chat, where Dusk (made the Chief of Staff where no other bot is one) greets the person
 * and asks for what is still missing. Before it, only what can't happen there: bots another app keeps on this computer,
 * and a sign-in when nothing at all can answer the bot yet. */
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
  const [beat] = useState<BeatId>(() => resumeBeat(BEAT_ORDER, initialBeat ?? (keepsDraft ? readWelcomeDraft()?.beat : undefined)));
  const root = useRef<HTMLDivElement>(null);
  const finishing = useRef(false);
  const record = useRef(state.config?.onboarding);
  record.current = state.config?.onboarding;

  useEffect(() => {
    track("onboarding_step", { step: beat, replay });
    if (keepsDraft && !finishing.current) saveWelcomeDraft({ beat });
  }, [beat, replay, keepsDraft]);

  // A Cloud sheet opened over the welcome never switches the window away from it (CloudAddDialog).
  useEffect(() => (embedded ? undefined : showWelcome()), [embedded]);
  useEffect(() => {
    if (!replay && !embedded) void nameFromComputer(state.config, (config) => dispatch({ type: "configStatus", config }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  const finish = useCallback(
    async (reason: "completed" | "skipped", botId: string | null) => {
      if (finishing.current) return;
      finishing.current = true;
      track("onboarding_completed", { reason, at: beat, replay });
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
    [beat, dispatch, onDone, replay, embedded, keepsDraft],
  );

  // where it fits, Dusk becomes the Chief of Staff and greets in its chat, as grok's default bot does, with no screen to ask
  const toChat = useCallback(() => {
    if (finishing.current) return;
    const chief = Boolean(maus && chiefStepFits(state.bots, maus));
    if (chief && maus) dispatch({ type: "updateBot", botId: maus.id, patch: createChiefPatch(maus, chiefFor(state.bots, maus)) });
    const botId = chief ? maus!.id : null;
    if (botId && !replay) stageIntro(botId);
    void finish(botId ? "completed" : "skipped", botId);
  }, [maus, state.bots, dispatch, finish, replay]);

  // Escape goes on: past the bots from another app, then to the chat
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && showMove) {
      event.preventDefault();
      if (move.step.kind !== "moving" && !grokOpen) setMoveSettled(true);
      return;
    }
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      toChat();
      return;
    }
    trapTab(event, root.current);
  };

  // bots another agent app keeps on this computer are offered first, on the desktop app's own first run only
  const offersMove = !replay && !embedded && localDesktopPage() && localSetupImport(state.config?.cloudHome === true);
  const move = useBotMove({ look: offersMove });
  const [moveSettled, setMoveSettled] = useState(!offersMove);
  const [grokOpen, setGrokOpen] = useState(false);
  const moveFound = Boolean(move.plan && (movable(move.plan) || move.plan.grokWaiting.length));
  useEffect(() => {
    if (move.plan && !moveFound) setMoveSettled(true);
  }, [move.plan, moveFound]);
  useEffect(() => {
    if (!moveFound || moveSettled) return;
    track("onboarding_step", { step: "bring_bots", replay });
  }, [moveFound, moveSettled, replay]);
  const showMove = offersMove && !moveSettled;

  // the AI: a sign-in screen only when nothing at all can answer, else (or once one can) straight to the chat
  const tested = useWelcomeAi(state.instances);
  const backup = state.instances.some((instance) => engineReady(instance) && freeFallback(instance));
  const line = aiLine(tested, backup);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), AI_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  // the bots and the AIs are known before anything is decided; a server that never lists them still reaches the chat
  const known = Boolean(state.hydrated) && state.instances.length > 0;
  const askNow = known && line === "connect";
  const ready = !showMove && (known ? !askNow : waited);
  useEffect(() => {
    if (ready) toChat();
  }, [ready, toChat]);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-labelledby={showMove && moveFound ? "bot-move-title" : askNow ? "welcome-title" : undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-welcome={showMove ? "bring-bots" : askNow ? "sign-in" : "chat"}
      className={cn("welcome-screen flex overflow-y-auto bg-app outline-none", embedded ? "relative h-full w-full" : "fixed inset-0 z-50")}
    >
      {!showMove ? askNow ? <SignInStep bot={maus} tested={tested} onLater={toChat} />
        : <div data-welcome-looking="" aria-busy="true" className="min-h-full w-full" />
        : moveFound && move.plan ? (
          <div key={move.step.kind} className="onboarding-step-in relative flex min-h-full w-full flex-col items-center px-4">
            <div className="my-auto flex w-full flex-col items-center pb-10 pt-16">
              <BringBotsView plan={move.plan} step={move.step} bot={maus} variant="screen" onBring={() => void move.bring()}
                onSkip={() => setMoveSettled(true)} onContinue={() => setMoveSettled(true)} onGrok={() => setGrokOpen(true)} />
            </div>
          </div>
        ) : <div data-welcome-looking="" aria-busy="true" className="min-h-full w-full" />}
      {grokOpen && <GrokMoveDialog onClose={() => { setGrokOpen(false); void move.look(); }} />}
    </div>
  );
}
