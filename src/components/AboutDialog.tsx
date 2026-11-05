import { useEffect, useRef } from "react";

import {
  APP_NAME,
  APP_REPOSITORY,
  DOCS_URL,
  LICENSE_URL,
  RELEASES_URL,
  appVersion,
  openExternalLink,
  platformLabel,
} from "@/lib/app-links";
import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { useOtherServerName } from "@/lib/other-server";
import { formSheetCls, mdSecondaryCls, rowHintCls } from "./ui/GrokDialog";
import { cn } from "@/lib/cn";

/** The app's own version first; `server` (useOtherServerName: set only when the app's window shows another server) adds a
 * line naming it with the version its page runs. A browser, or an app too old to say, keeps the page's version on one line. */
export function aboutVersionLines({ app, bundle, platform, server }: {
  app?: { version: string } | null;
  bundle: string;
  platform: string | null;
  server: string | null;
}): string[] {
  const line = (version: string) => `${t("about.version", { version })}${platform ? ` · ${platform}` : ""}`;
  if (!app?.version) return [line(bundle)];
  return server ? [line(app.version), t("about.connectedTo", { name: server, version: bundle })] : [line(app.version)];
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const server = useOtherServerName(open);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const [version, connected] = aboutVersionLines({ app: window.ogb?.app, bundle: appVersion(), platform: platformLabel(window.ogb?.platform), server });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div aria-hidden="true" className="ui-dialog-scrim pointer-events-none absolute inset-0" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        className={cn(formSheetCls, "max-w-[320px] px-4 pb-3 pt-4 text-center")}
      >
        <img src="/app-icon.svg" alt="" width={40} height={40} className="mx-auto size-10" />
        <h2 id="about-dialog-title" className="m-0 mt-2 text-[14px] font-semibold leading-5 tracking-[0.01em] text-ink">
          {productName()}
        </h2>
        <p className="m-0 mt-0.5 text-[12px] leading-4 tracking-[0.01em] text-ink/56">{version}</p>
        {connected && <p className="m-0 mt-0.5 text-[12px] leading-4 tracking-[0.01em] text-ink/56">{connected}</p>}
        <p className={cn(rowHintCls, "m-0 mt-2 text-pretty")}>
          A desktop home for your agents, built on {APP_NAME}: open source, Apache 2.0 licensed.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[13px] leading-[18px]">
          <AboutLink href={APP_REPOSITORY} label="GitHub" />
          <AboutLink href={DOCS_URL} label="Docs" />
          <AboutLink href={RELEASES_URL} label="Releases" />
          <AboutLink href={LICENSE_URL} label="License" />
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={cn(mdSecondaryCls, "mt-4 w-full")}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function AboutLink({ href, label }: { href: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void openExternalLink(href)}
      className="rounded-sm text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {label}
    </button>
  );
}
