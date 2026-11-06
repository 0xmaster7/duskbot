import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCaptionChrome, useDesktopCapabilities } from "./DesktopCapabilities";
import { GrokIcon } from "./GrokIcon";
import { useDialogKeys } from "./ui/GrokDialog";
import "./computer-fullscreen.css";

/** The pill under the screen: watching with Take control, or in control with I'm done. A screen that can only be
 * watched (this Mac) shows the status alone. */
export type ScreenControl =
  | { held: false; onTake?: () => void; busy?: boolean }
  | { held: true; onDone: () => void; busy?: boolean };

// grok's control row under the frame
const BAR = 52;

/** Grok's full computer view: the bot's screen on a dark cover, Exit fullscreen in the top right, and the control pill
 * under the frame. Without a frame it shows `note` (waking up, connecting, or what is in the way). */
export function ComputerFullscreen({ label, onExit, frame, note, control, alert }: {
  label: string;
  onExit: () => void;
  frame: ReactNode;
  note: ReactNode;
  control: ScreenControl | null;
  alert?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useDialogKeys(box, onExit);
  const { dragProps, noDragStyle } = useCaptionChrome();
  const macInset = useDesktopCapabilities().capabilities.windowChrome === "mac-inset";
  const exit = t("desktopViewer.exitFullscreen");

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-computer-fullscreen=""
      className="fixed inset-0 z-[65] flex flex-col bg-[rgb(20,20,20)] outline-none"
    >
      <div {...dragProps} className={cn("flex h-11 shrink-0 items-center justify-end pr-2", macInset ? "pl-[88px]" : "pl-2")}>
        <button
          type="button"
          style={noDragStyle}
          onClick={() => close.current()}
          aria-label={exit}
          title={exit}
          data-computer-exit=""
          className="flex size-6 cursor-pointer items-center justify-center rounded-[6px] text-white/85 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70"
        >
          <GrokIcon name="arrows-contract-simple" size={14} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2">
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center [container-type:size]">
          {frame ? (
            <div
              data-computer-frame=""
              className="relative overflow-hidden rounded-[6px] bg-white/4"
              style={{ width: `min(100cqw, calc((100cqh - ${control ? BAR : 0}px) * 16 / 10))`, aspectRatio: "16 / 10" }}
            >
              {frame}
            </div>
          ) : (
            <div data-computer-note="" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">{note}</div>
          )}
          {control && (
            <div className="flex shrink-0 items-center justify-center" style={{ height: BAR }}>
              <ControlPill control={control} />
            </div>
          )}
          {alert && <p role="alert" className="absolute inset-x-0 top-2 mx-auto w-fit max-w-[80%] rounded-full bg-menu px-3 py-1 text-center text-[12px] leading-4 text-danger">{alert}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ControlPill({ control }: { control: ScreenControl }) {
  const action = control.held ? control.onDone : control.onTake;
  return (
    <div data-computer-control={control.held ? "held" : "watching"} className={cn("flex h-9 items-center gap-2.5 rounded-full bg-menu pl-3", action ? "pr-1" : "pr-3")}>
      <span aria-live="polite" className={cn("flex items-center gap-1.5 text-[13px] font-medium leading-[18px]", control.held ? "text-ink" : "text-ink/68")}>
        <GrokIcon name={control.held ? "window-pointer-arrow" : "eye"} size={16} />
        {control.held ? t("computer.inControl") : t("computer.watching")}
      </span>
      {action && (
        <button
          type="button"
          onClick={action}
          disabled={control.busy}
          aria-busy={control.busy || undefined}
          className="inline-flex h-[26px] cursor-pointer items-center rounded-full bg-ink px-2 text-[13px] leading-[18px] text-app transition-[background-color] duration-[120ms] ease-[ease] enabled:hover:bg-[color-mix(in_srgb,var(--color-ink)_88.5%,var(--color-menu))] enabled:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60 motion-reduce:enabled:active:scale-100"
        >
          {control.held ? t("computer.done") : t("computer.takeControl")}
        </button>
      )}
    </div>
  );
}

/** What the cover says while there is no screen: the bot's mark over one quiet line, shimmering while it waits. */
export function ComputerFullscreenNote({ mark, text, busy, children }: { mark: ReactNode; text: ReactNode; busy: boolean; children?: ReactNode }) {
  return (
    <>
      <span className="flex flex-col items-center gap-2" role={busy ? "status" : undefined}>
        {mark}
        <span className={cn("max-w-[420px] text-[12px] leading-4 text-white/68 text-pretty", busy && "computer-waking-text")}>{text}</span>
      </span>
      {children}
    </>
  );
}

export const fullscreenActionCls = "inline-flex h-[26px] cursor-pointer items-center rounded-full bg-white/12 px-2.5 text-[13px] leading-[18px] text-white transition-[background-color] duration-[120ms] ease-[ease] hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70 disabled:opacity-50";
