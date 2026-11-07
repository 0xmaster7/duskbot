import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Hand, Loader2, Minimize2, RefreshCw, Send } from "lucide-react";
import type RFB from "@novnc/novnc";
import { cn } from "@/lib/cn";
import { connectDesktop, typeOnDesktop } from "@/lib/desktop-connection";
import { t } from "@/lib/i18n";
import { useCaptionChrome, useDesktopCapabilities } from "./DesktopCapabilities";

type Connection = "connecting" | "connected" | "disconnected";

/** The computer the person took control of, live and drivable where they were watching it. */
export function LiveDesktop({ target, threadId, name, poster, expanded, onExpandedChange, onHandBack, handingBack, onUnreachable, onReadyChange, onTakeControl, viewOnly = false }: {
  target: string;
  viewOnly?: boolean;
  onReadyChange?: (ready: boolean) => void;
  onTakeControl?: () => void;
  threadId: string;
  name: string;
  /** The last watched frame, shown until the first live one arrives. */
  poster: string | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onHandBack: () => void;
  handingBack: boolean;
  /** The desktop never came up, so the person cannot drive it. */
  onUnreachable: () => void;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [revival, setRevival] = useState(0);
  const identity = `${target}:${threadId}`;
  const [retryState, setRetry] = useState({ identity, attempt: 0 });
  const attempt = retryState.identity === identity ? retryState.attempt : 0;
  const reconnect = () => setRetry({ identity, attempt: attempt + 1 });
  const [text, setText] = useState("");
  const live = useRef<string | null>(null);
  const watching = useRef(viewOnly);
  watching.current = viewOnly;
  const { dragProps, noDragStyle } = useCaptionChrome();
  const macInset = useDesktopCapabilities().capabilities.windowChrome === "mac-inset";
  const readyChanged = useRef(onReadyChange);
  readyChanged.current = onReadyChange;
  const unreachable = useRef(onUnreachable);
  unreachable.current = onUnreachable;

  useEffect(() => {
    const controller = new AbortController();
    let client: RFB | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ended = false;
    let decoded = false;
    const reportReady = readyChanged.current;
    reportReady?.(false);
    const lost = () => {
      if (controller.signal.aborted || ended) return;
      ended = true;
      reportReady?.(false);
      setConnection("disconnected");
      if (live.current !== identity || attempt > 0) unreachable.current();
      else if (attempt === 0) retry = setTimeout(() => setRetry({ identity, attempt: 1 }), 1_000);
    };
    setText("");
    setConnection("connecting");
    void connectDesktop(screen.current!, target, {
      threadId,
      signal: controller.signal,
      viewOnly: watching.current,
      events: {
        connected: () => {
          if (controller.signal.aborted) return;
          decoded = true;
          live.current = identity;
          reportReady?.(true);
          setConnection("connected");
        },
        disconnected: lost,
      },
    }).then((connected) => {
      if (controller.signal.aborted) return connected.disconnect();
      client = connected;
      rfb.current = connected;
      connected.viewOnly = watching.current || !decoded;
      connected.focusOnClick = !connected.viewOnly;
    }, () => { if (!controller.signal.aborted) lost(); });
    const disconnect = () => {
      reportReady?.(false);
      controller.abort();
      clearTimeout(retry);
      client?.disconnect();
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) setRevival(value => value + 1); };
    window.addEventListener("pagehide", disconnect);
    window.addEventListener("pageshow", restore);
    return () => {
      disconnect();
      window.removeEventListener("pagehide", disconnect);
      window.removeEventListener("pageshow", restore);
      if (rfb.current === client) rfb.current = null;
    };
  }, [target, threadId, identity, attempt, revival]);

  useLayoutEffect(() => {
    const client = rfb.current;
    if (!client) return;
    client.viewOnly = viewOnly || connection !== "connected";
    client.focusOnClick = !client.viewOnly;
    if (connection === "connected" && !viewOnly) client.focus({ preventScroll: true });
  }, [expanded, connection, viewOnly]);

  const label = t("computer.viewerTitle", { name });
  const pill = (
    <span className="pointer-events-none flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm">
      <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
      {t(viewOnly ? "computer.watching" : "computer.inControl")}
    </span>
  );
  const iconButton = "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50";

  return (
    <div
      data-live-desktop
      data-state={connection}
      data-view-only={viewOnly ? "true" : undefined}
      data-expanded={expanded ? "true" : undefined}
      className={cn(expanded ? "fixed inset-0 z-[65] flex flex-col bg-app" : "relative h-full w-full")}
      onKeyDown={(event) => {
        if (expanded && event.key === "Escape" && !(event.target instanceof HTMLCanvasElement)) onExpandedChange(false);
      }}
    >
      {expanded && (
        <header {...dragProps} className={cn("flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline/40 bg-panel px-3 py-2", macInset && "pl-[86px]")}>
          <span className="min-w-0 truncate text-[13px] font-medium text-ink">{label}</span>
          {pill}
          {viewOnly && onTakeControl && <button type="button" style={noDragStyle} onClick={onTakeControl} disabled={connection !== "connected"} className={cn(iconButton, "ml-auto bg-control text-ink hover:bg-raised-hover")}>{t("computer.takeControl")}</button>}
          {!viewOnly && <form
            style={noDragStyle}
            className="ml-auto flex min-w-0 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (viewOnly || !rfb.current || connection !== "connected" || !text) return;
              typeOnDesktop(rfb.current, text);
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={4096}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={t("desktopViewer.text")}
              aria-label={t("desktopViewer.text")}
              className="w-44 min-w-0 rounded-lg border border-hairline bg-inset px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-focus max-sm:w-28"
            />
            <button type="submit" disabled={connection !== "connected" || !text} title={t("desktopViewer.send")} aria-label={t("desktopViewer.send")} className={cn(iconButton, "bg-control text-ink hover:bg-raised-hover")}>
              <Send size={14} aria-hidden="true" />
            </button>
          </form>}
          <button type="button" style={noDragStyle} onClick={() => onExpandedChange(false)} className={cn(iconButton, "bg-control text-ink hover:bg-raised-hover")}>
            <Minimize2 size={14} aria-hidden="true" />
            <span className="max-sm:hidden">{t("desktopViewer.exitFullscreen")}</span>
          </button>
          {!viewOnly && <button type="button" style={noDragStyle} onClick={onHandBack} disabled={handingBack} className={cn(iconButton, "bg-accent font-medium text-accent-ink hover:brightness-110")}>
            {handingBack ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Hand size={14} aria-hidden="true" />}
            {t("computer.handBack")}
          </button>}
        </header>
      )}
      <div className={cn("relative overflow-hidden bg-inset", expanded ? "min-h-0 flex-1" : "h-full w-full")}>
        {poster && connection !== "connected" && (
          <img src={poster} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-contain opacity-50" />
        )}
        <div ref={screen} role="application" aria-label={label} className="absolute inset-0" />
        {viewOnly && onTakeControl && (
          <button type="button" aria-label={t("computer.takeControl")} title={t("computer.takeControl")}
            onClick={onTakeControl} disabled={connection !== "connected"}
            className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait" />
        )}
        {connection === "connecting" && (
          <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-ink-secondary">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            {t("desktopViewer.connecting")}
          </div>
        )}
        {connection === "disconnected" && (
          <div role="alert" className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-card/95 p-3 text-center text-[12px] text-ink-secondary">
            <span>{t("desktopViewer.disconnected")}</span>
            <button type="button" onClick={reconnect} className="flex items-center gap-1.5 rounded-md bg-control px-3 py-1.5 text-ink hover:bg-raised-hover">
              <RefreshCw size={13} aria-hidden="true" />
              {t("desktopViewer.reconnect")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
