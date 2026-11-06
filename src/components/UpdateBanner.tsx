import { useEffect, useState } from "react";
import { Loader2, PackageOpen, RefreshCw, Sparkles, X } from "lucide-react";
import { useUpdaterState } from "@/lib/updater";
import { t } from "@/lib/i18n";
import { productName } from "../lib/brand";
import { NoticeToast } from "./NoticeCard";

// grok's banner scale: 28px pills at 13px, the answer in the ink primary
const pill = "flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default pointer-coarse:h-9";
const primaryAction = `${pill} ui-button-primary font-medium disabled:opacity-40`;
const secondaryAction = `${pill} bg-ink/[0.06] text-ink hover:bg-ink/[0.1] disabled:text-ink-secondary disabled:hover:bg-ink/[0.06]`;
const quietAction = `${pill} text-ink-secondary hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent`;

// electron-updater surfaces failures as a whole HTTP dump (status line, every header, stack trace).
function friendlyError(message?: string): string {
  if (!message) return "Something went wrong.";
  if (/cannot find .*\.yml|404/i.test(message))
    return "No update has been published for this platform yet.";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(message))
    return "Couldn't check for updates. Check your internet connection.";
  return message.split("\n")[0].slice(0, 140);
}

type UpdateBannerProps = {
  sidebarIndicator?: boolean;
};

/** Said once, the first time the person looks at the window after the app updated itself while they were away. */
function UpdatedLine({ version, onSeen }: { version: string; onSeen: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const look = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) setShown(true);
    };
    look();
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    return () => {
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
    };
  }, [shown]);
  return shown ? <NoticeToast text={t("update.updatedItself", { app: productName(), version })} onDone={onSeen} /> : null;
}

export function UpdateBanner({ sidebarIndicator = false }: UpdateBannerProps) {
  const s = useUpdaterState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pending, setPending] = useState<"install" | "check" | null>(null);
  const status = s?.status;
  useEffect(() => setPending(null), [status]);

  if (s?.updated && ["idle", "checking", "downloading", "preparing"].includes(s.status)) {
    return <UpdatedLine version={s.updated} onSeen={() => void window.ogb?.updater?.seen?.().catch(() => {})} />;
  }
  if (!s || s.status === "idle" || s.status === "checking" || s.status === "downloading" || s.status === "preparing") return null;
  if (sidebarIndicator && (s.status === "downloaded" || s.status === "installing")) return null;
  const key = `${s.status}:${s.version ?? ""}`;
  if (dismissed === key) return null;
  const updater = window.ogb!.updater!;

  const installing = s.status === "installing";
  // Ubuntu system packages can't be swapped under a running app: the command is copied and a terminal opens.
  const handoff = s.installMode === "handoff";

  const title =
    s.status === "downloaded"
      ? `${productName()} ${s.version} is ready`
      : installing
        ? handoff
          ? "Opening a terminal…"
          : "Restarting to update…"
        : s.status === "handed-off"
          ? "Finish in a terminal"
          : "Update failed";
  const subtitle =
    s.status === "downloaded"
      ? handoff
        ? "Copy the install command and open a terminal."
        : s.installsByItself
          ? t("update.card.idleNote", { app: productName() })
          : "Restart to finish updating."
      : installing
        ? handoff
          ? "Copying the command…"
          : s.message || `${productName()} will reopen in a moment.`
        : s.status === "handed-off"
          ? // when the automatic install could not run, say why before the steps
            `${s.message ? `${s.message} ` : ""}${
              s.terminalOpened
                ? "Command copied — paste it in the terminal that opened."
                : "Command copied — paste it in a terminal to finish."
            }`
          : s.retryable === false
            ? `${friendlyError(s.message?.split(" Quit and reopen ")[0])} Quit and reopen ${productName()} before trying the update again.`
            : friendlyError(s.message);

  return (
    <div data-update-banner="" className="fixed bottom-4 left-[calc(var(--rail-beside,0px)_+_1rem)] z-50 w-[300px] max-w-[calc(100vw_-_var(--rail-beside,0px)_-_32px)] ui-corner-card py-3 pe-2.5 ps-3.5">
      <div className="flex items-start gap-2.5">
        <Sparkles size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-[18px] text-ink">{title}</div>
          <div className="text-[13px] leading-[18px] text-ink-secondary" title={subtitle}>
            {subtitle}
          </div>
        </div>
        {!installing && (
          <button
            onClick={() => setDismissed(key)}
            className="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/[0.06] hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:size-9"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      {s.status === "handed-off" && s.command && (
        <code className="me-1 ms-6 mt-2 block overflow-x-auto rounded-[8px] bg-ink/[0.04] px-2 py-1.5 font-mono text-[12px] leading-[18px] whitespace-pre text-ink-secondary">
          {s.command}
        </code>
      )}

      {installing && (
        <div className="mt-2.5 flex justify-end gap-2 pe-1">
          <button
            disabled
            className={`${secondaryAction} text-ink-secondary`}
          >
            <Loader2 size={13} className="animate-spin" /> {handoff ? "Opening…" : "Restarting…"}
          </button>
        </div>
      )}

      {!installing && (
        <div className="mt-2.5 flex flex-wrap justify-end gap-2 pe-1">
          <button
            onClick={() => setDismissed(key)}
            disabled={pending !== null}
            className={quietAction}
          >
            {s.status === "handed-off" || s.retryable === false ? "Dismiss" : "Later"}
          </button>
          {s.status === "downloaded" && (
            <button
              onClick={() => {
                setPending("install");
                void updater.install();
              }}
              disabled={pending !== null}
              className={primaryAction}
            >
              {pending === "install" ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> {handoff ? "Opening…" : "Restarting…"}
                </>
              ) : handoff ? (
                <>
                  <PackageOpen size={13} /> Install
                </>
              ) : (
                <>
                  <RefreshCw size={13} /> Restart to update
                </>
              )}
            </button>
          )}
          {s.status === "error" && s.retryable !== false && (
            <button
              onClick={() => {
                setPending("check");
                void updater.check();
              }}
              disabled={pending !== null}
              className={secondaryAction}
            >
              {pending === "check" ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Checking…
                </>
              ) : (
                "Try again"
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
