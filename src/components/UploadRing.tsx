import { useEffect, useReducer, useState } from "react";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { showsUploadProgress, uploadFraction, uploadProgressDueIn, useUploadState } from "@/lib/upload-progress";

const LEAVE_MS = 180;

type Phase = "progress" | "failed" | null;

/**
 * A stroke tracing the tile's rounded edge while its upload runs, with the percentage in a corner. It shows from the
 * start for a large file and after a couple of seconds for any other, completes and fades when the upload lands, and
 * stays as a quiet error edge when it fails. A path that cannot count bytes gets a travelling arc instead.
 */
export function UploadRing({ id, name, uploading, failed, radius, percentClassName }: {
  id: string;
  name: string;
  uploading: boolean;
  failed: boolean;
  /** The tile's inner corner radius, in px. */
  radius: number;
  percentClassName: string;
}) {
  const state = useUploadState(id);
  const [, wake] = useReducer((count: number) => count + 1, 0);
  const startedAt = state?.startedAt;
  const size = state?.size;
  useEffect(() => {
    if (startedAt === undefined || size === undefined) return;
    const wait = uploadProgressDueIn({ startedAt, size }, Date.now());
    if (wait === null) return;
    const timer = window.setTimeout(wake, Math.max(0, wait));
    return () => window.clearTimeout(timer);
  }, [startedAt, size]);

  const phase: Phase = failed ? "failed" : uploading && state && showsUploadProgress(state, Date.now()) ? "progress" : null;
  const [shown, setShown] = useState<Phase>(phase);
  const [leaving, setLeaving] = useState(false);
  if (shown !== phase) {
    setShown(phase);
    setLeaving(shown === "progress" && phase === null);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), LEAVE_MS + 40);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  if (!phase && !leaving) return null;

  const fraction = leaving ? 1 : phase === "progress" && state ? uploadFraction(state) : null;
  const indeterminate = phase === "progress" && fraction === null;
  const percent = fraction === null || phase === "failed"
    ? null
    : new Intl.NumberFormat(activeLocale(), { style: "percent", maximumFractionDigits: 0 }).format(fraction);
  const progress = phase === "progress";
  return (
    <span
      className="upload-ring pointer-events-none absolute inset-0"
      data-phase={phase ?? "done"}
      data-leaving={leaving || undefined}
      data-indeterminate={indeterminate || undefined}
      role={progress ? "progressbar" : undefined}
      aria-label={progress ? t("attach.uploadingNamed", { name }) : undefined}
      aria-valuemin={progress && !indeterminate ? 0 : undefined}
      aria-valuemax={progress && !indeterminate ? 100 : undefined}
      aria-valuenow={progress && fraction !== null ? Math.round(fraction * 100) : undefined}
      aria-hidden={progress ? undefined : true}
    >
      <svg className="absolute top-[0.75px] left-[0.75px] h-[calc(100%-1.5px)] w-[calc(100%-1.5px)] overflow-visible" aria-hidden="true">
        <rect
          className="upload-ring-stroke"
          width="100%"
          height="100%"
          rx={Math.max(0, radius - 0.75)}
          pathLength={100}
          style={indeterminate || phase === "failed" ? undefined : { strokeDashoffset: 100 - (fraction ?? 0) * 100 }}
        />
      </svg>
      {percent && <span className={cn("upload-ring-percent absolute tabular-nums", percentClassName)}>{percent}</span>}
    </span>
  );
}
