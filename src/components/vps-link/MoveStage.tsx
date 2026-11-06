// stage 4: what moves, then backup, copy, check, switch and clear, then the server is home
import { useEffect, useState } from "react";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { formatBytes, type VpsLinkBridge, type VpsLinkView, type VpsMovePreview, type VpsMoveStep } from "@/lib/vps-link";
import { useStore } from "@/state/store";
import { mdPrimaryCls } from "../ui/GrokDialog";
import { deviceWord, ErrorNote, StageHead, StepRow, type RowStatus } from "./parts";

// the switch to the server happens as the check finishes, so it has no row of its own
const MOVE_STEPS: ReadonlyArray<Exclude<VpsMoveStep, "done">> = ["backup", "copy", "verify", "empty"];
const MOVE_TITLE: Record<Exclude<VpsMoveStep, "done">, LocaleKey> = {
  backup: "vpsLink.move.step.backup", copy: "vpsLink.move.step.copy", verify: "vpsLink.move.step.verify", empty: "vpsLink.move.step.empty",
};
const SHOWN_BOTS = 6;
const message = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "");

function stepStatus(step: Exclude<VpsMoveStep, "done">, move: NonNullable<VpsLinkView["move"]>): RowStatus {
  if (move.step === "done") return "done";
  const at = MOVE_STEPS.indexOf(move.step), index = MOVE_STEPS.indexOf(step);
  if (index < at) return "done";
  if (index > at) return "waiting";
  return move.status;
}

function Preview({ preview, name }: { preview: VpsMovePreview; name: string }) {
  const { state } = useStore();
  const shown = preview.bots.slice(0, SHOWN_BOTS), more = preview.bots.length - shown.length;
  const counts: Array<[LocaleKey, string | null]> = [
    ["vpsLink.move.count.chats", preview.messages !== null ? t("vpsLink.move.chatsAndMessages", { chats: preview.chats, messages: preview.messages }) : String(preview.chats)],
    ["vpsLink.move.count.skills", String(preview.skills)],
    ["vpsLink.move.count.memories", preview.memories === null ? null : String(preview.memories)],
    ["vpsLink.move.count.routines", String(preview.routines)],
    ["vpsLink.move.count.apps", preview.apps === null ? null : String(preview.apps)],
    ["vpsLink.move.count.files", preview.bytes === null ? null : formatBytes(preview.bytes)],
  ];
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={t("vpsLink.move.botsAria")} className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 px-2">
        {shown.map((bot) => {
          const known = state.bots.find((entry) => entry.id === bot.id);
          return (
            <li key={bot.id} className="flex items-center gap-2">
              {known ? <BotAvatar bot={known} size={24} /> : <MausAvatar color="green" size={24} animated={false} />}
              <span className="max-w-[140px] truncate text-[13px] leading-[18px] text-ink">{bot.name}</span>
            </li>
          );
        })}
        {more > 0 && <li className="self-center text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.moreBots", { count: more })}</li>}
        {preview.bots.length === 0 && <li className="text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.noBots")}</li>}
      </ul>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 px-2">
        {counts.filter(([, value]) => value !== null).map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-2 border-b border-ink/6 py-1">
            <dt className="text-[13px] leading-[18px] text-ink/68">{t(key)}</dt>
            <dd className="m-0 font-mono text-[12px] leading-[18px] tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 px-2 text-[12px] leading-4 text-ink/56 text-pretty">{t("vpsLink.move.safety", { name, device: deviceWord() })}</p>
    </div>
  );
}

export function MoveStage({ view, bridge, onMove }: { view: VpsLinkView; bridge: VpsLinkBridge; onMove: () => void }) {
  const [preview, setPreview] = useState<VpsMovePreview | null>(null);
  const [error, setError] = useState("");
  const name = view.server?.name ?? t("vpsLink.yourServer");
  const move = view.move;
  const load = () => { setError(""); void bridge.preview().then(setPreview, (cause) => setError(message(cause))); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!move) load(); }, [bridge, Boolean(move)]);

  if (view.stage === "moved" || move?.step === "done") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
        <MausAvatar color="green" state="celebrate" size={64} />
        <h3 className="m-0 text-[15px] font-medium leading-5 text-ink">{t("vpsLink.move.doneTitle", { name })}</h3>
        <p className="m-0 max-w-[340px] text-[13px] leading-[18px] text-ink/68 text-pretty">{t("vpsLink.move.doneHint", { device: deviceWord() })}</p>
        {move?.kept && <p className="m-0 max-w-[340px] text-[12px] leading-4 text-warning text-pretty">{t("vpsLink.move.kept", { device: deviceWord() })}</p>}
        <button type="button" data-autofocus="" className={mdPrimaryCls} onClick={() => void bridge.open()}>{t("vpsLink.move.open", { name })}</button>
      </div>
    );
  }
  if (move) {
    const failed = move.status === "failed";
    return (
      <div className="flex flex-col gap-3">
        <StageHead mascot={failed ? "surprised" : "working"} title={t("vpsLink.move.movingTitle", { name })} hint={failed ? t("vpsLink.move.nothingRemoved", { device: deviceWord() }) : t("vpsLink.move.movingHint")} />
        <ol aria-label={t("vpsLink.move.listAria")} className="m-0 flex list-none flex-col p-0">
          {MOVE_STEPS.map((step) => {
            const status = stepStatus(step, move);
            const detail = step === "copy" && status === "running" && move.chats
              ? t("vpsLink.move.chatsProgress", { done: move.chats.done, total: move.chats.total })
              : status === "running" && move.waitingFor ? t("vpsLink.move.waitingFor", { name: move.waitingFor }) : undefined;
            return <StepRow key={step} status={status} title={t(MOVE_TITLE[step], { name, device: deviceWord() })} detail={detail} />;
          })}
        </ol>
        {failed && <ErrorNote onRetry={onMove}>{move.error ?? view.error ?? t("vpsLink.move.failed")}</ErrorNote>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <StageHead mascot="idle" title={t("vpsLink.move.title", { name })} hint={t("vpsLink.move.hint", { device: deviceWord() })} />
      {error ? <ErrorNote onRetry={load}>{error}</ErrorNote>
        : preview ? <Preview preview={preview} name={name} />
          : <p className="m-0 px-2 text-[13px] leading-[18px] text-ink/56">{t("vpsLink.move.counting")}</p>}
      {view.error && <ErrorNote onRetry={onMove}>{view.error}</ErrorNote>}
      <div className="flex justify-end">
        <button type="button" className={mdPrimaryCls} disabled={!preview} onClick={onMove}>{t("vpsLink.move.action")}</button>
      </div>
    </div>
  );
}
