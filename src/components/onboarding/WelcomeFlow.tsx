import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { setEmailGateDone, track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { chiefFor, chiefStepFits, createChiefPatch, myDefaultBot, stageIntro, useViewerEmail } from "@/lib/default-bot";
import { BEAT_ORDER, completionPatch, firstRunPatch, markWelcomeFinished, resumeBeat, showWelcome, type BeatId } from "@/lib/onboarding";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import { api, useStore } from "@/state/store";
import { ComputerStep, JobsStep, TalkStep } from "./GrokSteps";
import { IslandIntro, useIslandAvailable } from "./IslandIntro";
import { talkingStyleOf, type TalkingStyle } from "../../../shared/talking-style";
import { MeetScreen } from "./MeetScreen";
import { localDesktopPage } from "./WelcomeGate";
import "../../styles/onboarding.css";

// the leaving step goes when its 100ms fade ends; this only covers a window that runs no animations
const STEP_OUT_MS = 300;

type Config = ReturnType<typeof useStore>["state"]["config"];

/** A genuine first run on this computer's own page names the person after its account, where their profile has none
 * (never on a Cloud, a Team Cloud or a remote page). The name stays theirs to change in Settings. */
async function nameFromComputer(config: Config, done: (config: NonNullable<Config>) => void): Promise<void> {
  const bridge = window.ogb;
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

/** The first run, as Grok Bot's: meeting the app (with an AI to connect when none works), the bot's own computer, a job
 * for each Bot, then how they all talk. Its end is the chat (`onDone`): MausBot's, made the Chief of Staff where no other bot is one. */
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
  const beats = BEAT_ORDER;
  const [beat] = useState<BeatId>(() => resumeBeat(beats, initialBeat ?? (keepsDraft ? readWelcomeDraft()?.beat : undefined)));
  // Grok Bot's three screens are the meet beat's pages: a reload starts them over, the beat itself is what resumes.
  const [page, setPage] = useState(0);
  // Grok's step change: the old step stays where it was and fades out over 100ms while the new one fades in
  const [leavingPage, setLeavingPage] = useState<number | null>(null);
  const leaveTimer = useRef(0);
  const goPage = (next: number) => {
    window.clearTimeout(leaveTimer.current);
    const reduced = document.documentElement.dataset.reducedMotion === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setLeavingPage(reduced || page === next ? null : page);
    setPage(next);
    leaveTimer.current = window.setTimeout(() => setLeavingPage(null), STEP_OUT_MS);
  };
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  // the last screen's pick is saved as it is made, as Settings saves it; warm until then
  const [talk, setTalk] = useState<TalkingStyle>(() => talkingStyleOf(state.config?.talkingStyle));
  const pickTalk = (style: TalkingStyle) => {
    setTalk(style);
    void api<NonNullable<Config>>("/api/config", { method: "PUT", body: JSON.stringify({ talkingStyle: style }), signal: AbortSignal.timeout(10_000) })
      .then((config) => dispatch({ type: "configStatus", config })).catch(() => {});
  };
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

  // where it fits, MausBot becomes the Chief of Staff and greets, as grok's default bot does, with no screen to ask
  const next = useCallback(() => {
    if (finishing.current) return;
    if (!beats.includes("chief") || !maus || !chiefStepFits(state.bots, maus)) return void finish("completed", null);
    if (!replay) stageIntro(maus.id);
    dispatch({ type: "updateBot", botId: maus.id, patch: createChiefPatch(maus, chiefFor(state.bots, maus)) });
    void finish("completed", maus.id);
  }, [beats, maus, state.bots, replay, dispatch, finish]);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [page]);

  // Escape moves on as Later does; Enter on the screen itself presses Next while it can be pressed.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      next();
      return;
    }
    if (event.key === "Enter" && event.target === root.current) {
      event.preventDefault();
      root.current.querySelector<HTMLButtonElement>("[data-primary]:not([disabled])")?.click();
      return;
    }
    trapTab(event, root.current);
  };

  // the notch and dock step, where this app has them (the desktop app on a Mac)
  const island = useIslandAvailable() === true;
  const pages = ["meet", "computer", "jobs", ...(island ? ["island"] : []), "talk"] as const;
  const renderPage = (index: number) => {
    const name = pages[index] ?? "talk";
    const forward = () => goPage(index + 1);
    const back = () => goPage(index - 1);
    if (name === "meet") return <MeetScreen onNext={forward} />;
    if (name === "computer") return <ComputerStep onNext={forward} onBack={back} />;
    if (name === "jobs") return <JobsStep onNext={forward} onBack={back} />;
    if (name === "island") return <IslandIntro onDone={forward} />;
    return <TalkStep value={talk} onChange={pickTalk} onNext={next} onBack={back} />;
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-labelledby="welcome-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-welcome="meet"
      className={cn("welcome-screen flex overflow-y-auto bg-app outline-none", embedded ? "relative h-full w-full" : "fixed inset-0 z-50")}
    >
      {/* keyed by page so the leaving step keeps its own state while it fades */}
      {[page, leavingPage].filter((index): index is number => index !== null).map((index) => index === page ? (
        <div key={index} className="contents">{renderPage(index)}</div>
      ) : (
        <div key={index} aria-hidden="true" inert className="onboarding-step-out pointer-events-none absolute inset-0 flex"
          onAnimationEnd={(event) => { if (event.target === event.currentTarget) setLeavingPage(null); }}>{renderPage(index)}</div>
      ))}
    </div>
  );
}
