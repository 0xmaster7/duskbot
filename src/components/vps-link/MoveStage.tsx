// the move: what goes, the bots travelling to the server one by one, then a free Mac with its backup kept
import { Check, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { formatBytes, type VpsLinkBridge, type VpsLinkMove, type VpsLinkView, type VpsMovePreview } from "@/lib/vps-link";
import { BotFace } from "./Scene";
import { centered, deviceWord, ErrorNote, Footer, Heading, Lead, PILL, ProgressBar, SOFT_PILL } from "./parts";

const SHOWN_BOTS = 6;

export type MovePhase = "preview" | "moving" | "paused" | "moved";
export function movePhase(view: VpsLinkView): MovePhase {
  if (view.stage === "moved" || view.move?.step === "done") return "moved";
  if (view.move) return view.move.status === "failed" ? "paused" : "moving";
  return "preview";
}

/** How far the move is, and how many bots are on the server already: the backup first, the chats as they copy (each
 * bot lands as its share of them arrives), then the check and the clear. */
export function moveProgress(move: VpsLinkMove | null, bots: number): { value: number; arrived: number } {
  if (!move) return { value: 0, arrived: 0 };
  if (move.step === "done") return { value: 1, arrived: bots };
  if (move.step === "backup") return { value: move.status === "done" ? 0.1 : 0.05, arrived: 0 };
  if (move.step === "copy") {
    const share = move.chats && move.chats.total > 0 ? move.chats.done / move.chats.total : 0.4;
    return { value: 0.1 + 0.7 * share, arrived: Math.min(bots, Math.floor(share * bots)) };
  }
  return { value: move.step === "verify" ? 0.86 : 0.95, arrived: bots };
}

const STEP_WORD: Record<"backup" | "copy" | "verify" | "empty", LocaleKey> = {
  backup: "vpsLink.move.step.backup", copy: "vpsLink.move.step.copy", verify: "vpsLink.move.step.verify", empty: "vpsLink.move.step.empty",
};

function Bots({ preview, arrived, moving }: { preview: VpsMovePreview; arrived: number | null; moving: boolean }) {
  const shown = preview.bots.slice(0, SHOWN_BOTS), more = preview.bots.length - shown.length;
  if (preview.bots.length === 0) return <p className="m-0 text-center text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.noBots")}</p>;
  return (
    <ul aria-label={t("vpsLink.move.botsAria")} className="m-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-3 p-0">
      {shown.map((bot, index) => {
        const status = arrived === null ? null : index < arrived ? "moved" : moving && index === arrived ? "moving" : "waiting";
        return (
          <li key={bot.id} data-vps-bot={status ?? ""} className="flex w-[64px] flex-col items-center gap-1.5">
            <span className={cn("flex transition-opacity duration-200", status === "waiting" && "opacity-45")}><BotFace bot={bot} index={index} size={36} /></span>
            <span className="w-full truncate text-center text-[12px] leading-4 text-ink">{bot.name}</span>
            {status && <span className={cn("inline-flex items-center gap-1 text-[11px] leading-[14px]", status === "moved" ? "text-success" : "text-ink/56")}>
              {status === "moved" ? <Check size={11} strokeWidth={2.5} aria-hidden="true" /> : status === "moving" ? <LoaderCircle size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {t(status === "moved" ? "vpsLink.move.botMoved" : status === "moving" ? "vpsLink.move.botMoving" : "vpsLink.move.botWaiting")}
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
    ["vpsLink.move.count.messages", preview.messages === null ? null : count(preview.messages)],
    ["vpsLink.move.count.skills", count(preview.skills)],
    ["vpsLink.move.count.memories", preview.memories === null ? null : count(preview.memories)],
    ["vpsLink.move.count.routines", count(preview.routines)],
    ["vpsLink.move.count.apps", preview.apps === null ? null : count(preview.apps)],
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
  const device = deviceWord();
  const phase = movePhase(view);
  const move = view.move;

  if (phase === "moved") {
    return (
      <>
        <Heading>{t("vpsLink.move.allMoved", { device })}</Heading>
        <div role="status" className={cn(centered, "top-[calc(50%-36px)] flex flex-col items-center gap-2 text-center")}>
          <p className="m-0 text-[14px] leading-5 text-ink/68 text-pretty">{t("vpsLink.move.allMovedHint", { name, device })}</p>
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
    const { value, arrived } = moveProgress(move, preview?.bots.length ?? 0);
    const step = move.step === "done" ? "empty" : move.step;
    const detail = move.step === "copy" && move.chats ? t("vpsLink.move.chatsProgress", { done: move.chats.done, total: move.chats.total })
      : move.waitingFor ? t("vpsLink.move.waitingFor", { name: move.waitingFor }) : null;
    return (
      <>
        <Heading>{paused ? t("vpsLink.move.pausedTitle") : t("vpsLink.move.movingTitle", { name })}</Heading>
        <div className={cn(centered, "top-[calc(50%-40px)] flex flex-col gap-2.5")}>
          <div className="flex items-baseline gap-3">
            <p role="status" className={cn("m-0 min-w-0 flex-1 truncate text-[15px] leading-5", paused ? "text-danger" : "text-ink")}>{t(STEP_WORD[step], { name, device })}</p>
            {detail && <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink/56">{detail}</span>}
          </div>
          <ProgressBar value={value} label={t("vpsLink.move.progressAria")} tone={paused ? "danger" : undefined} />
        </div>
        <div className={cn(centered, "top-[calc(50%+24px)]")}>
          {preview && <Bots preview={preview} arrived={arrived} moving={!paused} />}
        </div>
        <Footer>
          {paused
            ? <>
                <ErrorNote>{move.error ?? view.error ?? t("vpsLink.move.failed")}</ErrorNote>
                <p className="m-0 text-[13px] leading-[18px] text-ink/68">{t("vpsLink.move.nothingRemoved", { device })}</p>
                <button type="button" data-primary="" className={PILL} onClick={onMove}>{t("vpsLink.tryAgain")}</button>
              </>
            : <p className="m-0 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.movingHint")}</p>}
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
            ? <><Bots preview={preview} arrived={null} moving={false} /><Counts preview={preview} /></>
            : <p role="status" className="m-0 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.counting")}</p>}
      </div>
      <Footer note={<p className="m-0 max-w-[320px] text-[12px] leading-4 text-ink/56 text-pretty">{t("vpsLink.move.safety", { name, device })}</p>}>
        {view.error && <ErrorNote>{view.error}</ErrorNote>}
        <button type="button" data-primary="" className={PILL} disabled={!preview} onClick={onMove}>{t("vpsLink.move.action")}</button>
        <button type="button" className={SOFT_PILL} onClick={onBack}>{t("onboarding.step.back")}</button>
      </Footer>
    </>
  );
}
