import { useState } from "react";
import { Check, Copy, X } from "../icons";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";

export const addressPreview = (value: string): string => {
  if (value.length <= 3) return "…";
  if (value.length < 10) return `${value.slice(0, 3)}…`;
  if (value.length < 17) return `${value.slice(0, 4)}…${value.slice(-3)}`;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
};

/** A Grok row: the label, the address half hidden until revealed, and its copy button. */
export function ConnectionDetail({ label, value }: { label: string; value: string }) {
  const [revealed, setRevealed] = useState(false);
  const { state: copyState, copy } = useCopyFeedback(value);

  return (
    <div className="flex min-h-12 items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{label}</div>
      <div className="min-w-0 truncate font-mono text-[12px] leading-4 text-ink-secondary">{revealed ? value : addressPreview(value)}</div>
      <button type="button" onClick={() => setRevealed((current) => !current)} className="ui-button shrink-0">
        {revealed ? "Hide" : "Reveal"}
      </button>
      <button
        type="button"
        onClick={copy}
        aria-label={copyState === "failed" ? t("common.copyFailed") : `Copy ${label}`}
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus"
      >
        {copyState === "copied" ? <Check size={13} className="text-success" /> : copyState === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
      </button>
    </div>
  );
}
