import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { setEmailGateDone, track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { chiefFor, chiefStepFits, createChiefPatch, myDefaultBot, stageIntro, useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { BEAT_ORDER, completionPatch, firstRunPatch, markWelcomeFinished, resumeBeat, showWelcome, type BeatId } from "@/lib/onboarding";
import { randomUuid } from "@/lib/random-uuid";
import { firstJobOutbound, type StarterJobId } from "@/lib/starter-jobs";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import { api, useStore } from "@/state/store";
import { useIslandAvailable } from "./IslandIntro";
import { openIslandIntro } from "./IslandIntroHost";
import { StartScreen } from "./StartScreen";
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

/** The first run: one screen asking what the bot should do first. Picking or writing a job starts it in the bot's chat
 * at once (`onDone` lands there, the job already sent); Skip lands there empty. Dusk does the job, made the Chief of
 * Staff where no other bot is one. The notch tour and the cloud desktop are offered on the screen, never in the way. */
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

  // where it fits, Dusk becomes the Chief of Staff, as grok's default bot does, with no screen to ask
  const land = useCallback((job: string | null): string | null => {
    const chief = Boolean(maus && chiefStepFits(state.bots, maus));
    const target = chief ? maus! : job ? maus ?? state.bots.find((bot) => !bot.hidden) : undefined;
    if (!target) return null;
    const patch = { ...(chief ? createChiefPatch(target, chiefFor(state.bots, target)) : {}), ...(job ? firstJobOutbound(target.outbound) : {}) };
    if (Object.keys(patch).length) dispatch({ type: "updateBot", botId: target.id, patch });
    return target.id;
  }, [maus, state.bots, dispatch]);

  const skip = useCallback(() => {
    if (finishing.current) return;
    const botId = land(null);
    if (botId && !replay) stageIntro(botId);
    void finish(botId ? "completed" : "skipped", botId);
  }, [land, finish, replay]);

  const start = useCallback((text: string, job: StarterJobId | null) => {
    if (finishing.current) return;
    const botId = land(text);
    if (!botId) return void finish("skipped", null);
    track("onboarding_first_job", { job: job ?? "own", replay });
    void finish("completed", botId);
    dispatch({ type: "send", botId, text, sendId: randomUuid() });
  }, [land, finish, dispatch, replay]);

  // Escape skips as Skip does, but never past a job being written
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      const typing = event.target instanceof HTMLTextAreaElement && event.target.value.trim().length > 0;
      if (typing || event.defaultPrevented) return;
      event.preventDefault();
      skip();
      return;
    }
    trapTab(event, root.current);
  };

  const island = useIslandAvailable() === true;
  const cloud = !embedded && !replay && localDesktopPage() && !window.duskDesktop?.remoteClient?.active && Boolean(window.duskDesktop?.cloudAccount)
    && !state.config?.cloudHome;
  const extras = [
    ...(cloud ? [{ id: "cloud", label: t("onboarding.start.cloud"), onClick: () => dispatch({ type: "openCloudAdd", source: "app_onboarding" }) }] : []),
    ...(island ? [{ id: "tour", label: t("onboarding.start.tour"), onClick: () => void openIslandIntro() }] : []),
  ];

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-labelledby="welcome-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-welcome="start"
      className={cn("welcome-screen flex overflow-y-auto bg-app outline-none", embedded ? "relative h-full w-full" : "fixed inset-0 z-50")}
    >
      <StartScreen bot={maus} onStart={start} onSkip={skip} extras={extras} />
    </div>
  );
}
