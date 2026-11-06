import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Action } from "@/state/store";

import { loadAppCards } from "./bot-settings/useBotApps";
import { preloadConnectedApps } from "@/lib/connected-apps";
import { ServiceTile, type TileArt, type ToolkitCard } from "./ServiceIcon";
import { appLogo } from "./connect-apps/logos";
import { GrokIcon } from "./GrokIcon";
import { GROK_FOCUS, GROK_HOVER_TINT, SIMPLE_TOP_BUTTON } from "./SidebarSimpleTop";
import { ConnectAppsHost, openConnectApps, preloadConnectApps, useConnectApps } from "./connect-apps";

export type AppFace = Pick<ToolkitCard, "slug" | "label" | "logo" | "domain"> & Pick<TileArt, "image" | "padded" | "background" | "scale">;

/** The three apps grok's footer shows before anything is connected. */
export const POPULAR_APPS: readonly AppFace[] = [
  { slug: "googledrive", label: "Google Drive", logo: "https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png", domain: "drive.google.com" },
  { slug: "googlecalendar", label: "Google Calendar", logo: "https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png", domain: "calendar.google.com" },
  { slug: "granola", label: "Granola", logo: null, domain: "granola.ai" },
];

/** After those, the popular apps that take a connected one's place, in order. */
const MORE_APPS: readonly AppFace[] = [
  { slug: "notion", label: "Notion", logo: null, domain: "notion.so" },
  { slug: "slack", label: "Slack", logo: null, domain: "slack.com" },
  { slug: "github", label: "GitHub", logo: null, domain: "github.com" },
  { slug: "linear", label: "Linear", logo: null, domain: "linear.app" },
  { slug: "figma", label: "Figma", logo: null, domain: "figma.com" },
  { slug: "gmail", label: "Gmail", logo: null, domain: "mail.google.com" },
];

export const APP_FACES = 3;

/** Grok's footer logos: its featured apps that are not connected yet, in its order, three at most, on grok's own art. */
export function appFaces(connected: readonly string[], cards: ReadonlyMap<string, AppFace>): AppFace[] {
  const taken = new Set(connected);
  return [...POPULAR_APPS, ...MORE_APPS].filter((app) => !taken.has(app.slug)).slice(0, APP_FACES).map((app) => {
    const card = cards.get(app.slug);
    const art = appLogo(app.slug, app.label);
    return { ...app, ...(card?.logo ? { logo: card.logo } : {}), ...(art ? { image: art.src, padded: art.padded, background: art.background, scale: art.scale } : {}) };
  });
}

export interface SidebarApps {
  faces: AppFace[];
  connected: boolean;
}

export function useSidebarApps(): SidebarApps {
  const { state } = useStore();
  const window = useConnectApps().open;
  const [apps, setApps] = useState<SidebarApps>(() => ({ faces: appFaces([], new Map()), connected: false }));
  useEffect(() => {
    if (state.pluginsOpen || window) return;
    let alive = true;
    void preloadConnectedApps()
      .then(async (inventory) => {
        const connected = Object.entries(inventory.services).filter(([, status]) => status.connected).map(([slug]) => slug).sort();
        const cards = await loadAppCards().catch(() => new Map<string, AppFace>());
        if (alive) setApps({ faces: appFaces(connected, cards), connected: connected.length > 0 });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [state.pluginsOpen, window]);
  return apps;
}

/** Grok's footer logo: the 16px app tile on an 18px white square, 6px round, so overlapping tiles read apart. */
// under the pointer grok fans its three logos: the outer two tilt 8deg away, the middle one lifts a pixel

function AppFaceIcon({ face, className }: { face: AppFace; className?: string }) {
  return (
    <span data-app-face={face.slug} className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-[6px] bg-white p-px", className)}>
      <ServiceTile card={face} size={16} />
    </span>
  );
}


/** The footer grid's click: the Connect Apps window. `dispatch` stays for callers that pass it. */
export function openSidebarApps(_dispatch?: (action: Action) => void): void {
  openConnectApps();
}

/** `circle` is the collapsed rail's round button. */
export function SidebarConnectApps({ circle = false }: { circle?: boolean }) {
  return <ConnectAppsButton circle={circle} apps={useSidebarApps()} />;
}

/** The button for apps already read by its caller, as the footer does to fold it to a circle once one is connected. */
export function ConnectAppsButton({ circle, apps: { faces, connected }, engaged = false, onEngage }: {
  circle: boolean; apps: SidebarApps;
  /** grok's folded footer button: under the pointer or focus it widens into the Connect apps pill */
  engaged?: boolean; onEngage?: (engaged: boolean) => void;
}) {
  const open = useConnectApps().open;
  const label = connected ? t("sidebar.nav.apps") : t("sidebar.connectApps");
  // only the footer's folded button widens; the rail's stays a glyph
  const logos = circle && onEngage ? faces : [];
  return (
    <>
    <button
      type="button"
      data-tour="nav-apps"
      data-sidebar-nav="apps"
      aria-pressed={circle ? undefined : open}
      aria-label={circle ? t("sidebar.connectApps") : undefined}
      onPointerEnter={() => { preloadConnectApps(); onEngage?.(true); }}
      onFocus={(event) => { preloadConnectApps(); if (event.currentTarget.matches(":focus-visible")) onEngage?.(true); }}
      onBlur={() => onEngage?.(false)}
      onClick={() => openConnectApps()}
      className={circle ? cn(SIMPLE_TOP_BUTTON, "group/apps h-9 min-w-9 w-auto text-[14px] font-medium leading-5 text-ink transition-[flex-grow,padding] duration-300 ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none", engaged ? "grow pl-4 pr-3" : "grow-0 px-2") : cn("group/apps flex h-9 min-w-0 flex-1 items-center justify-center rounded-full border border-ink/[0.08] bg-composer px-4 text-[14px] font-medium leading-5 tracking-[0.01em] text-ink transition-[flex-grow,padding] duration-300 ease-[cubic-bezier(.2,0,0,1)]", GROK_HOVER_TINT, GROK_FOCUS)}
    >
      {circle ? <>
        {/* grok's widened pill trades the grid glyph for the label and the app logos */}
        <span aria-hidden="true" data-connect-apps-icon="" className={cn("flex h-5 shrink-0 items-center justify-center overflow-hidden transition-[max-width,opacity] duration-300 ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none",
          engaged && logos.length ? "max-w-0 opacity-0" : "w-5 max-w-5 opacity-100")}><GrokIcon name="grid-plus" size={16} /></span>
        <span aria-hidden="true" data-connect-apps-label="" className={cn("min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-300 ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none",
          engaged ? cn(!logos.length && "ms-1.5", "max-w-[200px] opacity-100 [transition-duration:300ms,150ms,300ms] [transition-delay:0ms,120ms,0ms]") : "ms-0 max-w-0 opacity-0")}>{t("sidebar.connectApps")}</span>
        {logos.length > 0 && <span aria-hidden="true" data-connect-apps-faces="" className={cn("flex shrink-0 items-center overflow-hidden transition-[max-width,opacity,margin] duration-300 ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none",
          engaged ? "ms-[4.5px] max-w-[60px] opacity-100 [transition-duration:300ms,150ms,300ms] [transition-delay:0ms,120ms,0ms]" : "ms-0 max-w-0 opacity-0")}>
          {logos.map((face, index) => <AppFaceIcon key={face.slug} face={face} className={cn(index > 0 && "-ms-[6px]")} />)}
        </span>}
      </> : <>
        <span className="min-w-0 truncate">{label}</span>
        <span aria-hidden="true" className="ms-[4.5px] flex shrink-0 items-center">
          {faces.map((face, index) => <AppFaceIcon key={face.slug} face={face} className={cn(index > 0 && "-ms-[6px]")} />)}
        </span>
      </>}
    </button>
    <ConnectAppsHost />
    </>
  );
}
