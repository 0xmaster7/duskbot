import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

/** A small pill on a quiet line in the chat. */
export const NOTE_ACTION = "inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";
const SUMMARY = "w-fit cursor-pointer list-none rounded-sm underline-offset-2 [&::-webkit-details-marker]:hidden hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** grok's quiet line in the chat: a sentence in the tertiary ink with its pills beside it, never a box. A warning
 * carries one small glyph so its tone is never colour alone. */
export function TranscriptNote({ text, warning = false, details, actions, ...rest }: {
  text: ReactNode;
  warning?: boolean;
  /** the words behind a plain line, one click away */
  details?: string | null;
  actions?: ReactNode;
} & { [data: `data-${string}`]: string | undefined }) {
  return (
    <div role="status" data-transcript-note="" {...rest} className="flex w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] leading-[18px] text-ink-tertiary">
      <span className="flex min-w-0 items-start gap-1.5">
        {warning && <Icon name="exclamation-circle" variant="filled" size={14} className="mt-0.5 shrink-0 text-warning" />}
        <span dir="auto" className="min-w-0 break-words">{text}</span>
      </span>
      {actions}
      {details && (
        <details className={warning ? "basis-full ps-5" : "basis-full"}>
          <summary className={SUMMARY}>{t("chat.error.details")}</summary>
          <p dir="auto" className="mt-0.5 break-words">{details}</p>
        </details>
      )}
    </div>
  );
}
