// the move: what goes, the bots travelling to the server one by one, then a free Mac with its backup kept
import { LoaderCircle } from "../../icons";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { formatBytes, type VpsLinkBridge, type VpsLinkMove, type VpsLinkView, type VpsMovePreview } from "@/lib/vps-link";
import { BotFace } from "./Scene";
import { centered, deviceWord, ErrorNote, Footer, Heading, Lead, message, PILL, ProgressBar, SOFT_PILL } from "./parts";
import { vpsProgress } from "./progress";

const SHOWN_BOTS = 6;

export type MovePhase = "preview" | "moving" | "paused" | "moved";
export function movePhase(view: VpsLinkView): MovePhase {
  if (view.stage === "moved" || view.move?.step === "done") return "moved";
  if (view.move) return view.move.status === "failed" ? "paused" : "moving";
  return "preview";
}

export function moveProgress(move: VpsLinkMove | null, bots: number): { value: number | null; arrived: number } {
  if (!move) return { value: null, arrived: 0 };
  if (move.step === "done") return { value: 1, arrived: bots };
  if (move.step === "backup") return { value: move.bytes?.total ? move.bytes.done / move.bytes.total : null, arrived: 0 };
  if (move.step === "copy") {
    const share = move.chats && move.chats.total > 0 ? Math.max(0, Math.min(1, move.chats.done / move.chats.total)) : null;
    return { value: share, arrived: 0 };
  }
  return { value: null, arrived: 0 };
}

/** "3:42" until the next try. */
export function retryClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The time now, once a second while there is a time (`until`) to count down to. */
function useNow(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return now;
}

const STEP_WORD: Record<"backup" | "copy" | "verify" | "empty", LocaleKey> = {
  backup: "vpsLink.move.step.backup", copy: "vpsLink.move.step.copy", verify: "vpsLink.move.step.verify", empty: "vpsLink.move.step.empty",
};

function Bots({ preview, moving }: { preview: VpsMovePreview; moving?: boolean }) {
  const shown = preview.bots.slice(0, SHOWN_BOTS), more = preview.bots.length - shown.length;
  if (preview.bots.length === 0) return <p className="m-0 text-center text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.noBots")}</p>;
  return (
    <ul aria-label={t("vpsLink.move.botsAria")} className="m-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-3 p-0">
      {shown.map((bot, index) => {
        const status = moving === undefined ? null : moving ? "moving" : "waiting";
        return (
          <li key={bot.id} data-vps-bot={status ?? ""} className="flex w-[64px] flex-col items-center gap-1.5">
            <span className={cn("flex transition-opacity duration-200", status === "waiting" && "opacity-45")}><BotFace bot={bot} index={index} size={36} /></span>
            <span className="w-full truncate text-center text-[12px] leading-4 text-ink">{bot.name}</span>
            {status && <span className="inline-flex items-center gap-1 text-[11px] leading-[14px] text-ink/56">
              {moving && <LoaderCircle size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {t(moving ? "vpsLink.move.botMoving" : "vpsLink.move.botWaiting")}
            </span>}
          </li>
        );
      })}
      {more > 0 && <li className="flex h-9 items-center text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.moreBots", { count: more })}</li>}
    </ul>
  );
}

function Counts({ preview }: { preview: VpsMovePreview }) {
  const count = (value: number) => value.toLocaleString(activeLocale());
  const counts: Array<[LocaleKey, string | null]> = [
    ["vpsLink.move.count.chats", count(preview.chats)],
    ["vpsLink.move.count.skills", count(preview.skills)],
    ["vpsLink.move.count.routines", count(preview.routines)],
    ["vpsLink.move.count.files", preview.bytes === null ? null : formatBytes(preview.bytes)],
  ];
  return (
    <dl aria-label={t("vpsLink.move.statsAria")} className="m-0 flex w-[640px] max-w-[calc(100vw-32px)] shrink-0 flex-wrap justify-center gap-x-6 gap-y-2">
      {counts.filter(([, value]) => value !== null).map(([key, value]) => (
        <div key={key} className="flex flex-col items-center">
          <dd className="m-0 text-[17px] font-medium leading-[22px] tabular-nums text-ink">{value}</dd>
          <dt className="order-last text-[12px] leading-4 text-ink/56">{t(key)}</dt>
        </div>
      ))}
    </dl>
  );
}

export function MoveScreen({ view, preview, previewError, onReload, bridge, onMove, onBack }: {
  view: VpsLinkView; preview: VpsMovePreview | null; previewError: string; onReload: () => void; bridge: VpsLinkBridge; onMove: () => void; onBack: () => void;
}) {
  const name = view.server?.name ?? t("vpsLink.yourServer");
  // a server name like instance-20261103-1451 wraps whole, never at its hyphens
  const unbroken = name.replace(/-/g, "\u2011");
  const device = deviceWord();
  const phase = movePhase(view);
  const move = view.move;
  const [retryError, setRetryError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const retry = () => {
    if (retrying) return;
    setRetryError(""); setRetrying(true);
    void bridge.retryMove().catch((cause) => { if (alive.current) setRetryError(message(cause)); }).finally(() => { if (alive.current) setRetrying(false); });
  };
  // a failed copy waits for its next try: the error, a countdown and Try now, in place of the hint
  const retryAt = phase === "moving" && move?.error && typeof move.retryAt === "number" ? move.retryAt : null;
  const now = useNow(retryAt);

  if (phase === "moved") {
    return (
      <>
        <Heading>{t("vpsLink.move.allMoved")}</Heading>
        <div role="status" className={cn(centered, "top-[calc(50%-36px)] flex flex-col items-center gap-2 text-center")}>
          <p className="m-0 text-[14px] leading-5 text-ink/68 text-pretty">{t("vpsLink.move.allMovedHint", { name: unbroken, device })}</p>
          {move?.kept && <p className="m-0 text-[13px] leading-[18px] text-warning text-pretty">{t("vpsLink.move.kept", { device })}</p>}
        </div>
        {preview && <div className={cn(centered, "top-[calc(50%+40px)] flex justify-center")}><Counts preview={preview} /></div>}
        <Footer note={<p className="m-0 text-[12px] leading-4 text-ink/56 text-pretty">{t("vpsLink.move.backupNote", { device })}</p>}>
          <button type="button" data-primary="" data-autofocus="" className={PILL} onClick={() => void bridge.open()}>{t("vpsLink.move.open", { name })}</button>
        </Footer>
      </>
    );
  }

  if (move) {
    const paused = phase === "paused";
    const { value } = moveProgress(move, preview?.bots.length ?? 0);
    const step = move.step === "done" ? "empty" : move.step;
    const detail = move.step === "backup" ? vpsProgress(view).detail : move.step === "copy" && move.chats ? t("vpsLink.move.chatsProgress", { done: move.chats.done, total: move.chats.total })
      : move.waitingFor ? t("vpsLink.move.waitingFor", { name: move.waitingFor }) : null;
    return (
      <>
        <Heading>{paused ? t("vpsLink.move.pausedTitle") : t("vpsLink.move.movingTitle", { name })}</Heading>
        <div className={cn(centered, "top-[calc(50%-40px)] flex flex-col gap-2.5")}>
          <div className="flex items-baseline gap-3">
            <p role="status" className={cn("m-0 min-w-0 flex-1 truncate text-[15px] leading-5", paused ? "text-danger" : "text-ink")}>{t(STEP_WORD[step], { name, device })}</p>
            {detail && <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink/56">{detail}</span>}
          </div>
          <ProgressBar value={value} detail={detail} label={t(STEP_WORD[step], { name, device })} tone={paused ? "danger" : undefined} />
        </div>
        <div className={cn(centered, "top-[calc(50%+24px)]")}>
          {preview && <Bots preview={preview} moving={!paused} />}
        </div>
        <Footer>
          {retryError && <ErrorNote>{retryError}</ErrorNote>}
          {paused
            ? <>
                <ErrorNote>{move.error ?? view.error ?? t("vpsLink.move.failed")}</ErrorNote>
                <p className="m-0 text-[13px] leading-[18px] text-ink/68">{t("vpsLink.move.nothingRemoved", { device })}</p>
                <button type="button" data-primary="" className={PILL} onClick={onMove}>{t("vpsLink.tryAgain")}</button>
              </>
            : retryAt !== null
              ? <>
                  <ErrorNote>{move.error}</ErrorNote>
                  <p role="timer" data-vps-retry="" className="m-0 text-[13px] leading-[18px] tabular-nums text-ink/56">
                    {retryAt > now ? t("vpsLink.move.retryIn", { time: retryClock(retryAt - now) }) : t("vpsLink.move.retrying")}
                  </p>
                  <button type="button" className={SOFT_PILL} disabled={retrying} onClick={retry}>{t("vpsLink.move.retryNow")}</button>
                </>
              : <>
                  {(move.error || view.error) && <><ErrorNote>{move.error ?? view.error}</ErrorNote><button type="button" className={SOFT_PILL} disabled={retrying} onClick={retry}>{t("vpsLink.move.retryNow")}</button></>}
                  <p className="m-0 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.movingHint")}</p>
                </>}
        </Footer>
      </>
    );
  }

  return (
    <>
      <Heading>{t("vpsLink.move.title", { name })}</Heading>
      <Lead className="top-[calc(50%-52px)]">{t("vpsLink.move.hint", { device })}</Lead>
      <div className={cn(centered, "top-[calc(50%-12px)] flex flex-col items-center gap-6")}>
        {previewError
          ? <><ErrorNote>{previewError}</ErrorNote><button type="button" className={SOFT_PILL} onClick={onReload}>{t("vpsLink.tryAgain")}</button></>
          : preview
            ? <><Bots preview={preview} /><Counts preview={preview} /></>
            : <p role="status" className="m-0 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.counting")}</p>}
      </div>
      <Footer note={<p className="m-0 max-w-[320px] text-[12px] leading-4 text-ink/56 text-pretty">{t("vpsLink.move.safety", { name: unbroken, device })}</p>}>
        {view.error && <ErrorNote>{view.error}</ErrorNote>}
        <button type="button" data-primary="" className={PILL} disabled={!preview} onClick={onMove}>{t("vpsLink.move.action")}</button>
        <button type="button" className={SOFT_PILL} onClick={onBack}>{t("onboarding.step.back")}</button>
      </Footer>
    </>
  );
}
