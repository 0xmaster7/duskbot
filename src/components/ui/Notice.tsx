import { cn } from "@/lib/cn";
import { GrokIcon, type GrokIconName } from "../GrokIcon";

export type NoticeTone = "info" | "warning" | "danger" | "success";

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
