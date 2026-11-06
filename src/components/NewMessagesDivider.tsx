import type { CSSProperties } from "react";
import { t } from "@/lib/i18n";
import { UNREAD_DIVIDER_FADE_MS } from "@/lib/unread-divider";
import { cn } from "@/lib/cn";

/** grok's "New" line: 1px rules in the accent at 20%, the word in the accent. `tint` is the bot's colour, when the chat
 * wears it. */
export function NewMessagesDivider({ fading, tint }: { fading: boolean; tint?: string }) {
  return (
    <div
      role="separator"
      aria-label={t("chat.newMessagesAria")}
      data-unread-divider
      className={cn(
        "grid ease-out transition-[grid-template-rows,opacity,margin-bottom] motion-reduce:transition-none",
        fading ? "-mb-3 grid-rows-[0fr] opacity-0" : "mt-1 mb-2 grid-rows-[1fr] opacity-100",
      )}
      style={{ transitionDuration: `${UNREAD_DIVIDER_FADE_MS}ms`, ...(tint ? { "--color-accent-text": tint } as CSSProperties : {}) }}
    >
      <div className="min-h-0 overflow-hidden">
        <div aria-hidden="true" className="animate-msg-in flex items-center gap-2 py-0.5">
          <span className="h-px min-w-0 flex-1 basis-0 bg-accent-text/20" />
          <span className="shrink-0 text-[11px] font-medium uppercase leading-4 tracking-[0.01em] text-accent-text">
            {t("chat.newMessages")}
          </span>
          <span className="h-px min-w-0 flex-1 basis-0 bg-accent-text/20" />
        </div>
      </div>
    </div>
  );
}
