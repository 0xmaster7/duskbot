import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
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

/** One notice, toast or inline error, as Grok draws them: glyph, one short ink line (a quieter line under it if needed),
 * a small pill action such as Undo, and a close. Danger speaks as an alert, everything else as a status. */
export function Notice({ tone = "info", title, children, action, onDismiss, dismissLabel, className, ...rest }: {
  tone?: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
  "data-notice"?: string;
  "data-notice-toast"?: string;
}) {
  return (
    <div {...rest} role={tone === "danger" ? "alert" : "status"} className={cn("ui-notice", noticeCardCls, className)}>
      <NoticeGlyph tone={tone} />
      <div className="flex min-w-0 flex-1 flex-col break-words">
        <span className="font-medium">{title}</span>
        {children && <span className="text-ink/68">{children}</span>}
      </div>
      {action && <button type="button" onClick={action.onClick} className={cn(noticeActionCls, "-my-[5px]")}>{action.label}</button>}
      {onDismiss && (
        <button type="button" aria-label={dismissLabel ?? t("notice.dismiss")} onClick={onDismiss}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink/68 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus -my-0.5">
          <GrokIcon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
