import { cn } from "@/lib/cn";
import { GrokIcon, type GrokIconName } from "../GrokIcon";
import { rowButtonCls } from "./GrokDialog";

export type NoticeTone = "info" | "warning" | "danger" | "success";

/** Grok's banner (sand-banner): a white card on a 1px ink/12 edge at 18px corners, the inline lift, 12px in, 12px gaps. */
export const noticeCardCls = "flex items-start gap-3 rounded-[18px] border border-ink/12 bg-menu p-3 text-[14px] leading-5 text-ink";
/** A notice's action: Grok's 30px ink/6 pill. */
export const noticeActionCls = rowButtonCls;

const GLYPH: Record<NoticeTone, { name: GrokIconName; filled: boolean; cls: string }> = {
  info: { name: "info", filled: true, cls: "text-ink/56" },
  warning: { name: "exclamation-circle", filled: true, cls: "text-warning" },
  danger: { name: "exclamation-circle", filled: true, cls: "text-danger" },
  success: { name: "check-circle", filled: true, cls: "text-success" },
};

/** The one small coloured glyph that carries a notice's tone; the words stay ink. */
export function NoticeGlyph({ tone }: { tone: NoticeTone }) {
  const glyph = GLYPH[tone];
  return (
    <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center", glyph.cls)}>
      <GrokIcon name={glyph.name} variant={glyph.filled ? "filled" : "outline"} size={16} />
    </span>
  );
}
