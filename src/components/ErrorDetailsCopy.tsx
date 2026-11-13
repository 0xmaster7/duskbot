import { useEffect, useState } from "react";
import { copyText } from "@/lib/copy-text";
import { reportShownError } from "@/lib/error-reports";
import { t } from "@/lib/i18n";

const BUTTON = "w-fit cursor-pointer rounded-sm text-ink-secondary underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center";

/** The technical words behind a plain error line: never shown, sent to the error report, and copied for support on a
 * press. */
export function ErrorDetailsCopy({ details }: { details: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => reportShownError(details), [details]);
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <button type="button" data-error-details-copy="" className={BUTTON} onClick={() => void copyText(details).then((result) => setState(result === "copied" ? "copied" : "failed"))}>
      <span aria-live="polite">{state === "copied" ? t("chat.error.detailsCopied") : state === "failed" ? t("common.copyFailed") : t("chat.error.copyDetails")}</span>
    </button>
  );
}
