import { useCallback, useEffect, useMemo, useState } from "react";
import "../../styles/onboarding.css";
import { ArrowUp, Check, Plus } from "lucide-react";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { engineReady } from "@/components/EngineLibrary";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { productName } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { DEFAULT_BOT_NAME, myDefaultBot, useViewerEmail } from "@/lib/default-bot";
import { activeLocale, t } from "@/lib/i18n";
import { aiChoices, aiWorks } from "@/lib/onboarding";
import { useStore } from "@/state/store";
import { ConnectAiDialog } from "./ConnectAi";
import { PILL, SignInPill, useSignInPill } from "./SignInPill";
import { useWelcomeAi } from "./welcome-ai";

const MASCOT_SIZE = 64;
/** After the sentence is typed: a beat, then Send is pressed, and the bot starts thinking as the box drops away. */
const SEND_AFTER_MS = 400;
const THINK_AFTER_MS = 860;
const PLACEHOLDER_MS = 700;
const GRAPHEME_MS = 35;

function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(activeLocale(), { granularity: "grapheme" }).segment(text), (part) => part.segment) : Array.from(text);
}

/** The demo's one sentence, typed once after the placeholder has been read; reduced motion shows it whole. */
function useDemoSentence(reduced: boolean): { text: string; typing: boolean; waiting: boolean } {
  const parts = useMemo(() => graphemes(t("onboarding.meet.demo")), []);
  const [typed, setTyped] = useState(reduced ? parts.length : -1);
  useEffect(() => {
    if (reduced || typed >= parts.length) return;
    const timer = setTimeout(() => setTyped((now) => now + 1), typed < 0 ? PLACEHOLDER_MS : GRAPHEME_MS);
    return () => clearTimeout(timer);
  }, [reduced, typed, parts.length]);
  const shown = reduced ? parts.length : typed;
  return { text: parts.slice(0, Math.max(0, shown)).join(""), typing: shown >= 0 && shown < parts.length, waiting: shown < 0 };
}

function DemoComposer({ reduced, sent, onTyping, onTyped }: { reduced: boolean; sent: boolean; onTyping: (typing: boolean) => void; onTyped: () => void }) {
  const { text, typing, waiting } = useDemoSentence(reduced);
  useEffect(() => onTyping(typing), [typing, onTyping]);
  const typed = !waiting && !typing && text.length > 0;
  useEffect(() => { if (typed) onTyped(); }, [typed, onTyped]);
  return (
    <div aria-hidden="true" data-demo-composer="" data-sent={sent ? "" : undefined}
      className={cn(sent && "onboarding-composer-out", "absolute left-1/2 top-[calc(50%-14px)] flex min-h-[76px] w-[348px] max-w-[calc(100%-32px)] -translate-x-1/2 select-none flex-col gap-2.5 rounded-[22px] border-[0.5px] border-ink/10 bg-composer px-2 pb-2 pt-3 text-left [:root:is([data-skin=daylight],[data-skin=grok])_&]:shadow-[0_2px_8px_-1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.03)]")}>
      <div className="mx-2 whitespace-nowrap text-[14px] leading-5">
        {waiting ? <span className="text-ink-tertiary">{t("onboarding.meet.placeholder", { app: productName() })}</span> : <span className="text-ink">{text}</span>}
        {!reduced && (waiting || typing) && <span className="animate-meet-caret ml-px inline-block h-[15px] w-[1.5px] translate-y-[2px] bg-ink align-[-2px]" />}
      </div>
      <div className="flex items-center justify-between">
        <span className="flex size-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-ink)_4%,var(--color-composer))] text-ink-tertiary"><Plus size={14} /></span>
        <span className="relative flex size-7">
          {sent && <span className="onboarding-send-ring absolute inset-0.5 rounded-full border-2 border-ink" />}
          <span className={cn("flex size-7 items-center justify-center rounded-full bg-ink text-app", sent && "onboarding-send-press")}><ArrowUp size={14} strokeWidth={2} /></span>
        </span>
      </div>
    </div>
  );
}

/** The first run's first screen: the app's name, its mascot and a composer typing one sentence, then one pill. With
 * no AI working yet the pill is the sign-in, and Next comes once the AI has answered its test message. */
export function MeetScreen({ hosted, onNext }: { hosted: boolean; onNext: () => void }) {
  const { state } = useStore();
  const reduced = usePrefersReducedMotion();
  const maus = myDefaultBot(state.bots, useViewerEmail());
  // An AI counts once it answered a test message (or cannot be sent one); OpenCode's free model never does.
  const tested = useWelcomeAi(state.instances, !hosted);
  const ready = aiWorks(tested);
  const known = state.instances.length > 0;
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!hosted && known && !ready && tested?.state !== "testing") setAsking(true);
  }, [hosted, known, ready, tested?.state]);
  const { recommended } = aiChoices(state.instances.filter((instance) => instance.install && !engineReady(instance)));
  const pill = useSignInPill(recommended);
  const [dialog, setDialog] = useState(false);
  const [typing, setTyping] = useState(false);
  // Grok Bot's first screen ends with its message sent: Send is pressed, the box drops away, the bot thinks.
  const [typed, setTyped] = useState(false);
  const onTyped = useCallback(() => setTyped(true), []);
  const [sent, setSent] = useState(false);
  const [thinking, setThinking] = useState(false);
  useEffect(() => {
    if (!typed) return;
    const send = setTimeout(() => setSent(true), SEND_AFTER_MS);
    const think = setTimeout(() => setThinking(true), SEND_AFTER_MS + THINK_AFTER_MS);
    return () => { clearTimeout(send); clearTimeout(think); };
  }, [typed]);

  const face = typing ? "listening" : "idle";
  const failure = pill.error ?? (tested?.state === "failed" ? tested.error ?? t("onboarding.engines.noAnswer", { name: tested.instance.displayName }) : null);
  const signingIn = asking && !ready;
  return (
    <div className="onboarding-step-in relative h-full min-h-[600px] w-full text-center">
      <h1 id="welcome-title" className="absolute left-1/2 top-[calc(50%-264px)] w-max max-w-[min(560px,calc(100%-32px))] -translate-x-1/2 text-[28px] font-normal leading-[34px] tracking-[-0.02em] text-ink">
        {t("onboarding.meet.title", { app: productName() })}
      </h1>
      <span className="absolute left-1/2 top-[calc(50%-75px)] flex -translate-x-1/2 -translate-y-1/2" style={{ width: MASCOT_SIZE, height: MASCOT_SIZE }}>
        {thinking ? (
          <span data-meet-thinking="" className="onboarding-dots flex size-full items-center justify-center gap-[5px]">
            <span className="size-[9px] rounded-full bg-ink" /><span className="size-[11px] rounded-full bg-ink" /><span className="size-[9px] rounded-full bg-ink" />
          </span>
        ) : maus ? (
          <BotAvatar bot={maus} size={MASCOT_SIZE} state={face} animated={!reduced} />
        ) : (
          <MausAvatar color="chrome" size={MASCOT_SIZE} state={face} animated={!reduced} label={DEFAULT_BOT_NAME} />
        )}
      </span>
      <DemoComposer reduced={reduced} sent={sent} onTyping={setTyping} onTyped={onTyped} />
      {hosted && (
        <p className="absolute left-1/2 top-[calc(50%+86px)] w-[420px] max-w-[calc(100%-32px)] -translate-x-1/2 text-[13px] leading-[18px] text-ink-secondary">
          {t("onboarding.hosted.intro")}
        </p>
      )}
      <div className="absolute left-1/2 top-[calc(50%+200px)] flex w-[320px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center">
        {asking && ready && tested && (
          <p role="status" data-ai-connected="" className="absolute -top-8 flex items-center gap-1.5 whitespace-nowrap text-[13px] leading-[18px] text-success">
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />{t("onboarding.meet.connected", { name: tested.instance.displayName })}
          </p>
        )}
        {signingIn ? (
          <SignInPill pill={pill} instance={recommended} waiting={tested?.state === "testing"} onDialog={() => setDialog(true)} />
        ) : (
          <button type="button" data-primary="" onClick={onNext} className={cn(PILL, asking && "animate-fade-in [animation-duration:150ms]")}>
            {t("onboarding.meet.next")}
          </button>
        )}
        {signingIn && (
          <p className="mt-3 text-[13px] leading-[18px] text-ink-secondary">
            <button type="button" onClick={() => setDialog(true)} className="rounded hover:text-ink">{t("onboarding.meet.otherWays")}</button>
            <span aria-hidden="true"> · </span>
            <button type="button" data-welcome-later="" onClick={onNext} className="rounded hover:text-ink">{t("onboarding.meet.setupLater")}</button>
          </p>
        )}
        {signingIn && failure && <p role="alert" className="mt-2 text-[13px] leading-[18px] text-danger">{failure}</p>}
      </div>
      {dialog && <ConnectAiDialog hosted={hosted} tested={tested} onClose={() => setDialog(false)} />}
    </div>
  );
}
