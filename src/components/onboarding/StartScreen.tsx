import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowUp, Check, Inbox, LoaderCircle, Plane, Search, ShieldCheck, Tag, type GlyphIcon } from "../../icons";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { engineReady } from "@/components/EngineLibrary";
import { usePrefersReducedMotion } from "@/components/mascot-clock";
import { cn } from "@/lib/cn";
import { DEFAULT_BOT_NAME } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { aiChoices } from "@/lib/onboarding";
import { aiLine, canStart, jobDraft, STARTER_JOBS, type StarterJobId } from "@/lib/starter-jobs";
import { useStore, type Bot } from "@/state/store";
import { freeFallback } from "../../../shared/ai-ranking";
import { ConnectAiDialog } from "./ConnectAi";
import { CodeSlot, PasteSlot, pillWay, SignInPill, useSignInPill } from "./SignInPill";
import { useWelcomeAi } from "./welcome-ai";

const ICONS: Record<StarterJobId, GlyphIcon> = { inbox: Inbox, price: Tag, trip: Plane, research: Search };
const LINK = "rounded text-ink-secondary hover:text-ink";

/** The first run's only screen: what the bot should do first, written in a real composer that a job fills in. Under it,
 * the AI it runs on in one line (the person's own sign-in when one is found, else the free backup with one tap to sign
 * in), and what it asks before doing. Nothing on it has to be decided before a job starts. */
export function StartScreen({ bot, onStart, onSkip, extras }: {
  bot: Bot | undefined;
  onStart: (text: string, job: StarterJobId | null) => void;
  onSkip: () => void;
  /** Quiet ways onward that never block: the cloud desktop, the notch tour. */
  extras?: { label: string; onClick: () => void; id: string }[];
}) {
  const { state } = useStore();
  const reduced = usePrefersReducedMotion();
  const name = bot?.name || DEFAULT_BOT_NAME;
  const tested = useWelcomeAi(state.instances);
  const backup = state.instances.find((instance) => engineReady(instance) && freeFallback(instance));
  const line = aiLine(tested, Boolean(backup));
  const { recommended } = aiChoices(state.instances.filter((instance) => instance.install && !engineReady(instance)));
  const pill = useSignInPill(recommended);
  const [dialog, setDialog] = useState(false);
  const [text, setText] = useState("");
  const [job, setJob] = useState<StarterJobId | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<[number, number] | null>(null);
  const ready = canStart(line, text);

  useEffect(() => {
    const range = pending.current;
    const field = box.current;
    if (!range || !field) return;
    pending.current = null;
    field.focus({ preventScroll: true });
    field.setSelectionRange(range[0], range[1]);
  }, [text]);

  const pick = (id: StarterJobId) => {
    const draft = jobDraft(STARTER_JOBS.find((candidate) => candidate.id === id)!, t);
    pending.current = draft.select;
    setJob(id);
    setText(draft.text);
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready) onStart(text.trim(), job);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const own = tested?.instance.displayName ?? "";
  const failure = pill.error ?? (tested?.state === "failed" ? tested.error ?? t("onboarding.engines.noAnswer", { name: own }) : null);
  const way = pillWay(recommended);
  const signInInline = () => (way === "install" ? void pill.install() : way === "sign-in" ? void pill.start() : setDialog(true));

  return (
    <div className="onboarding-step-in relative flex min-h-full w-full flex-col items-center px-4">
      <div className="my-auto flex w-full max-w-[560px] flex-col items-center pb-10 pt-16 text-center">
        <span className="flex size-14" aria-hidden="true">
          {bot ? <BotAvatar bot={bot} size={56} state="idle" animated={!reduced} />
            : <MausAvatar color="chrome" size={56} state="idle" animated={!reduced} label={DEFAULT_BOT_NAME} />}
        </span>
        <h1 id="welcome-title" className="mt-6 text-[28px] font-normal leading-[34px] tracking-[-0.02em] text-ink">
          {t("onboarding.start.title", { name })}
        </h1>
        <p className="mt-2 max-w-[440px] text-balance text-[15px] leading-[22px] text-ink-secondary">{t("onboarding.start.sub", { name })}</p>

        <form data-start-composer="" onSubmit={submit}
          className="mt-8 flex w-full flex-col gap-2 rounded-[22px] border-[0.5px] border-transparent bg-composer px-2 pb-2 pt-3 text-left focus-within:border-transparent [:root:is([data-skin=daylight],[data-skin=grok])_&]:shadow-[0_2px_8px_-1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.03)]">
          <textarea
            ref={box}
            value={text}
            rows={3}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label={t("onboarding.start.composer", { name })}
            placeholder={t("onboarding.start.placeholder")}
            className="mx-2 min-h-[66px] resize-none bg-transparent text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-tertiary"
          />
          <div className="flex justify-end">
            <button type="submit" data-primary="" disabled={!ready} aria-label={t("onboarding.start.go")} title={t("onboarding.start.go")}
              className="flex size-8 items-center justify-center rounded-full bg-ink text-app active:scale-[0.96] disabled:opacity-30">
              <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </form>

        <div role="group" aria-label={t("onboarding.start.jobs")} className="mt-4 flex flex-wrap justify-center gap-2">
          {STARTER_JOBS.map((starter) => {
            const Icon = ICONS[starter.id];
            return (
              <button key={starter.id} type="button" data-job={starter.id} aria-pressed={job === starter.id} onClick={() => pick(starter.id)}
                className={cn("inline-flex h-9 items-center gap-2 rounded-full border-[0.5px] px-3.5 text-[14px] text-ink hover:bg-ink/[0.04] active:scale-[0.98]",
                  job === starter.id ? "border-transparent bg-ink/[0.04]" : "border-transparent")}>
                <Icon size={15} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                {t(starter.label)}
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex w-full flex-col items-center gap-2 text-[13px] leading-[18px]">
          {line === "ready" && (
            <p role="status" data-ai-line="ready" className="flex items-center gap-1.5 text-ink-secondary">
              <Check size={14} strokeWidth={2.5} className="text-success" aria-hidden="true" />
              {t("onboarding.start.ai.ready", { name: own })}
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => setDialog(true)} className={LINK}>{t("onboarding.start.ai.change")}</button>
            </p>
          )}
          {line === "checking" && (
            <p role="status" data-ai-line="checking" className="flex items-center gap-1.5 text-ink-secondary">
              <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{t("onboarding.start.ai.checking", { name: own })}
            </p>
          )}
          {line === "free" && (
            <div data-ai-line="free" className="flex flex-col items-center gap-2">
              <p role="status" className="text-ink-secondary">
                {t("onboarding.start.ai.free")}{" "}
                {pill.slot.kind === "start" && (
                  <button type="button" data-sign-in={way} onClick={signInInline} className="rounded text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink">
                    {recommended ? t("onboarding.start.ai.useOwn", { name: recommended.displayName }) : t("onboarding.meet.connectAi")}
                  </button>
                )}
              </p>
              {pill.slot.kind === "paste" && <PasteSlot name={recommended?.displayName ?? ""} onSubmit={(code) => void pill.submit(code)} />}
              {pill.slot.kind === "code" && <CodeSlot code={pill.slot.code} />}
              {(pill.slot.kind === "busy" || pill.slot.kind === "waiting") && (
                <p role="status" className="flex items-center gap-1.5 text-ink-secondary">
                  <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{t("onboarding.meet.waiting", { name: recommended?.displayName ?? "" })}
                </p>
              )}
            </div>
          )}
          {line === "connect" && (
            <div data-ai-line="connect" className="flex flex-col items-center gap-3">
              <p className="text-ink-secondary">{t("onboarding.start.ai.connect", { name })}</p>
              <SignInPill pill={pill} instance={recommended} waiting={false} onDialog={() => setDialog(true)} />
              <button type="button" onClick={() => setDialog(true)} className={LINK}>{t("onboarding.meet.otherWays")}</button>
            </div>
          )}
          {failure && line !== "ready" && <p role="alert" className="max-w-[440px] text-danger">{failure}</p>}
          <p data-safe-line="" className="max-w-[440px] text-balance text-ink-tertiary">
            <ShieldCheck size={14} className="me-1.5 inline-block align-[-2px]" aria-hidden="true" />
            {t("onboarding.start.safe", { name })}
          </p>
        </div>
      </div>

      <nav aria-label={t("onboarding.start.more")} className="flex flex-wrap items-center justify-center gap-x-1 pb-6 text-[13px] leading-[18px]">
        {[...(extras ?? []), { id: "skip", label: t("onboarding.start.skip"), onClick: onSkip }].map((extra, index) => (
          <span key={extra.id} className="flex items-center gap-x-1">
            {index > 0 && <span aria-hidden="true" className="text-ink-tertiary">·</span>}
            <button type="button" data-start-extra={extra.id} onClick={extra.onClick} className={cn(LINK, "px-1 py-1")}>{extra.label}</button>
          </span>
        ))}
      </nav>
      {dialog && <ConnectAiDialog tested={tested} onClose={() => setDialog(false)} />}
    </div>
  );
}
