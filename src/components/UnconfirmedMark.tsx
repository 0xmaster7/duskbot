import { CircleDashed } from "lucide-react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { ActionKind } from "../../shared/wire";

const WHY: Record<ActionKind, LocaleKey> = {
  send: "chat.unconfirmed.send",
  book: "chat.unconfirmed.book",
  buy: "chat.unconfirmed.buy",
  file: "chat.unconfirmed.file",
  download: "chat.unconfirmed.download",
};

/** A quiet note under a reply that says it did something its turn left no receipt for. */
export function UnconfirmedMark({ kinds }: { kinds: readonly ActionKind[] }) {
  const why = kinds.map((kind) => t(WHY[kind])).join(" ");
  return (
    <span data-unconfirmed={kinds.join(" ")} title={why} className="mt-0.5 inline-flex items-center gap-1 px-1 text-[12px] leading-4 text-ink-secondary">
      <CircleDashed size={12} aria-hidden="true" />
      {t("chat.unconfirmed.label")}
      <span className="sr-only">: {why}</span>
    </span>
  );
}
