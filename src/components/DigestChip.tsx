import { useState } from "react";
import { ClipboardList } from "lucide-react";

import { receiptLine } from "@/lib/cost-why";
import { t } from "@/lib/i18n";
import { formatCost, formatDuration } from "@/lib/usage-trace";
import type { Message } from "@/state/store";
import { traceRootId } from "../../shared/usage-trace";
import { TraceDialog } from "./usage/TraceView";

export function DigestChip({ message }: { message: Message }) {
  const [tracing, setTracing] = useState(false);
  const digest = message.digest;
  if (!digest) return null;
  const files = digest.files ? digest.files.changed.length + digest.files.added.length + digest.files.deleted.length + (digest.files.truncated ?? 0) : null;
  const worked = digest.tools.length || digest.toolCalls || digest.toolsDropped || files || digest.memory.length || digest.memoryDropped;
  const tools = digest.toolCalls ?? `${digest.tools.reduce((n, tool) => n + tool.count, 0)}${digest.toolsDropped ? "+" : ""}`;
  const label = [
    digest.durationMs > 0 ? t("trace.workedFor", { duration: formatDuration(digest.durationMs) }) : null,
    worked ? files === null ? t("chat.digestChipNoFiles", { tools }) : t("chat.digestChip", { tools, files }) : null,
    receiptLine(digest, formatCost),
  ].filter(Boolean).join(" · ");
  if (!label) return null;
  return (
    <div className="flex justify-start" data-testid="digest-chip">
      <span
        title={message.text ?? t("chat.digestTitle")}
        className="ui-chip max-w-[min(520px,100%)] border border-hairline/40 bg-panel text-ink-secondary"
      >
        <ClipboardList size={12} />
        <span className="truncate">{label}</span>
        <button type="button" onClick={() => setTracing(true)} className="shrink-0 text-accent hover:underline" data-testid="view-trace">
          {t("trace.view")}
        </button>
      </span>
      {tracing && <TraceDialog id={traceRootId(digest.threadId, digest.turnId)} at={digest.at} onClose={() => setTracing(false)} />}
    </div>
  );
}

/** A reply's cost and why, when tool calls are hidden: "$0.18 · mostly reading 42 emails". Nothing for a turn with no price. */
export function CostReceipt({ message }: { message: Message }) {
  const line = message.digest ? receiptLine(message.digest, formatCost) : null;
  if (!line) return null;
  return <div className="flex justify-start px-1 text-[12px] leading-4 tabular-nums text-ink-tertiary" data-testid="cost-receipt">{line}</div>;
}
