import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleDot, ExternalLink, GitCommitHorizontal, GitPullRequest, Github, Globe, Hash, Play } from "../icons";
import { t } from "@/lib/i18n";
import { githubRefLabel, type GithubRef, type GithubRefKind } from "@/lib/github-refs";
import { cachedLinkPreview, loadLinkPreview, type LoadedPreview } from "@/lib/link-preview";
import { siteIconUrl } from "@/lib/site-icon";

export const HOVER_OPEN_DELAY_MS = 350;
/** How long an open card waits for the page's own preview before it shows the address alone. */
export const PREVIEW_WAIT_MS = 1200;
/** Matches the out transition in styles/overlays.css. */
export const CARD_EXIT_MS = 80;
export const HOVER_CLOSE_GRACE_MS = 150;
export const LONG_PRESS_MS = 500;
const GAP = 8;
const EDGE = 8;

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export function placeCard(anchor: Box, card: { width: number; height: number }, view: { width: number; height: number }) {
  const maxLeft = Math.max(EDGE, view.width - card.width - EDGE);
  const left = Math.min(maxLeft, Math.max(EDGE, anchor.left + anchor.width / 2 - card.width / 2));
  const above = anchor.top - GAP - card.height;
  if (above >= EDGE) return { left, top: above, side: "above" as const };
  const below = anchor.bottom + GAP;
  return { left, top: Math.max(EDGE, Math.min(below, view.height - card.height - EDGE)), side: "below" as const };
}

export const GITHUB_REF_ICONS: Record<GithubRefKind, typeof GitPullRequest> = {
  pull: GitPullRequest,
  issue: CircleDot,
  commit: GitCommitHorizontal,
  ref: Hash,
};

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./i, "");
}

function pathOf(url: URL): string {
  const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  try {
    return decodeURI(rest);
  } catch {
    return rest;
  }
}

function SiteMark({ host, github }: { host: string; github: boolean }) {
  const icon = github ? null : siteIconUrl(host);
  const [failed, setFailed] = useState(false);
  if (github) return <Github size={14} aria-hidden="true" className="shrink-0" />;
  if (!icon || failed) return <Globe size={14} aria-hidden="true" className="shrink-0" />;
  return <img src={icon} alt="" width={14} height={14} draggable={false} className="size-3.5 shrink-0 rounded-[3px]" onError={() => setFailed(true)} />;
}

function AddressLine({ host, path, github }: { host: string; path: string; github: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[13px] leading-5">
      <span className="text-ink-tertiary"><SiteMark host={host} github={github} /></span>
      <span dir="ltr" className="min-w-0 flex-1 truncate [unicode-bidi:isolate]">
        <span className="text-ink-secondary">{host}</span>
        {path && <span className="text-ink-tertiary">{path}</span>}
      </span>
      <ExternalLink size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary rtl:-scale-x-100" />
    </div>
  );
}

/** A picture's box keeps the page's own shape within reason; a video is always 16:9, which also crops letterboxing. */
export function imageRatio(image: { width: number | null; height: number | null }, video: boolean): number {
  if (video) return 16 / 9;
  if (!image.width || !image.height) return 1.91;
  return Math.min(2.4, Math.max(4 / 3, image.width / image.height));
}

const CARD = "w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-2xl bg-composer text-ink shadow-lg ring-1 ring-transparent";

function parsed(address: string | undefined): URL | null {
  if (!address) return null;
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

/** Where a redirect ended, when that is another site than the link names; null when it stays on the link's own host. */
export function landedHost(href: string, final: string | undefined): string | null {
  const own = parsed(href), landed = parsed(final);
  if (!own || !landed || !/^https?:$/.test(landed.protocol)) return null;
  const host = hostOf(landed);
  return host && host !== hostOf(own) ? host : null;
}

export function LinkPreviewCard({ href, github, preview }: { href: string; github?: GithubRef | null; preview?: LoadedPreview }) {
  // the address is the link's own: the page a redirect lands on (preview.url) is only ever shown as "via", never as
  // where the link goes, or a link could pass itself off as another site
  const url = parsed(href);
  const host = url ? hostOf(url) : href;
  const path = url ? pathOf(url) : "";
  const via = preview ? landedHost(href, preview.url) : null;
  if (preview) {
    const { image, video } = preview;
    return (
      <div className={CARD}>
        {image && (
          <div className="relative bg-ink/5" style={{ aspectRatio: imageRatio(image, video) }}>
            <img src={image.src} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
            {video && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-11 place-items-center rounded-full bg-[rgb(20_20_20/0.6)] text-[rgb(250_250_250)] backdrop-blur-sm">
                  <Play size={18} fill="currentColor" aria-hidden="true" className="translate-x-px" />
                </span>
              </span>
            )}
          </div>
        )}
        <div className="p-4">
          {preview.title && <div dir="auto" className="line-clamp-2 break-words text-[15px] font-semibold leading-snug">{preview.title}</div>}
          {preview.description && (
            <div dir="auto" className={`${preview.title ? "mt-1 " : ""}line-clamp-3 break-words text-[13px] leading-5 text-ink-secondary`}>{preview.description}</div>
          )}
          <div className="mt-3">
            <AddressLine host={host} path={path} github={Boolean(github)} />
            {via && (
              <div data-link-preview-via="" dir="ltr" className="mt-0.5 truncate ps-[22px] text-[12px] leading-4 text-ink-tertiary [unicode-bidi:isolate]">
                {t("links.card.via", { host: via })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (github) {
    const Icon = GITHUB_REF_ICONS[github.kind];
    const title = github.kind === "commit"
      ? t("links.card.commit", { id: githubRefLabel(github, false) })
      : t(github.kind === "pull" ? "links.card.pullRequest" : github.kind === "issue" ? "links.card.issue" : "links.card.reference", { id: githubRefLabel(github, false) });
    return (
      <div className={`${CARD} p-4`}>
        <div className="flex items-baseline gap-2">
          <Icon size={15} aria-hidden="true" className="shrink-0 self-center text-ink-secondary" />
          <div dir="auto" className="min-w-0 line-clamp-2 break-words text-[15px] font-semibold leading-snug">{title}</div>
        </div>
        <div dir="ltr" className="mt-1 line-clamp-3 break-all text-[13px] leading-5 text-ink-secondary [unicode-bidi:isolate]">
          {github.owner}/{github.repo}
        </div>
        <div className="mt-3">
          <AddressLine host={host} path="" github />
        </div>
      </div>
    );
  }
  return (
    <div className={`${CARD} px-3.5 py-3`}>
      <AddressLine host={host} path={path} github={false} />
    </div>
  );
}

export function LinkHoverCard({ href, github, children }: { href: string; github?: GithubRef | null; children: (anchor: AnchorProps) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<LoadedPreview | undefined>(() => cachedLinkPreview(href));
  const [waited, setWaited] = useState(false);
  // the card on screen and what it shows; it keeps that content until it closes, so it never changes size while open
  const [card, setCard] = useState<{ preview: LoadedPreview; closing: boolean } | null>(null);
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef(true);
  const pressed = useRef(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const later = useCallback((value: boolean, ms: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(value), ms);
  }, []);
  const prefetch = useCallback(() => {
    if (cachedLinkPreview(href) !== undefined) return;
    void loadLinkPreview(href).then((value) => { if (live.current) setPreview(value); });
  }, [href]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clear();
      if (exit.current) clearTimeout(exit.current);
    };
  }, []);
  useEffect(() => { setPreview(cachedLinkPreview(href)); }, [href]);

  useEffect(() => {
    if (!open) { setWaited(false); return; }
    prefetch();
    if (preview !== undefined) return;
    const wait = setTimeout(() => setWaited(true), PREVIEW_WAIT_MS);
    return () => clearTimeout(wait);
  }, [open, preview, prefetch]);

  const ready = open && (preview !== undefined || waited);
  useEffect(() => {
    if (ready) {
      if (exit.current) clearTimeout(exit.current);
      exit.current = undefined;
      setCard((now) => (now && !now.closing ? now : { preview: now ? now.preview : preview ?? null, closing: false }));
      return;
    }
    setCard((now) => (now && !now.closing ? { ...now, closing: true } : now));
  }, [ready, preview]);
  useEffect(() => {
    if (!card?.closing || exit.current) return;
    exit.current = setTimeout(() => {
      exit.current = undefined;
      setCard((now) => (now?.closing ? null : now));
    }, CARD_EXIT_MS);
  }, [card]);

  const mounted = card !== null;
  const shown = card !== null && !card.closing;
  useLayoutEffect(() => {
    if (!mounted) return;
    const update = () => {
      const anchor = anchorRef.current, node = cardRef.current;
      if (!anchor || !node) return;
      const rects = anchor.getClientRects();
      const box = rects.length ? rects[0]! : anchor.getBoundingClientRect();
      const spot = placeCard(box, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
      node.style.left = `${spot.left}px`;
      node.style.top = `${spot.top}px`;
      // grows out of the link it describes
      const originX = Math.min(node.offsetWidth, Math.max(0, box.left + box.width / 2 - spot.left));
      node.style.transformOrigin = `${originX}px ${spot.side === "above" ? "100%" : "0"}`;
      node.dataset.side = spot.side;
      node.style.visibility = "visible";
    };
    update();
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !cardRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      clear();
      setOpen(false);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [mounted]);

  const anchor: AnchorProps = {
    ref: (node) => { anchorRef.current = node; },
    "aria-describedby": shown ? id : undefined,
    onPointerEnter: (event) => {
      if (event.pointerType === "touch") return;
      // coming back while the card is still leaving: no second wait
      if (card?.closing) {
        clear();
        setOpen(true);
        return;
      }
      prefetch();
      later(true, HOVER_OPEN_DELAY_MS);
    },
    onPointerLeave: (event) => {
      if (event.pointerType === "touch") return;
      later(false, HOVER_CLOSE_GRACE_MS);
    },
    onFocus: (event) => {
      // :focus-visible only: a click focuses the link too.
      if (event.currentTarget.matches(":focus-visible")) {
        clear();
        setOpen(true);
      }
    },
    onBlur: () => later(false, 0),
    onKeyDown: (event) => {
      if (event.key === "Escape" && (open || shown)) {
        event.stopPropagation();
        clear();
        setOpen(false);
      }
    },
    onPointerDown: (event) => {
      if (event.pointerType !== "touch") return;
      pressed.current = false;
      pressStart.current = { x: event.clientX, y: event.clientY };
      clear();
      prefetch();
      timer.current = setTimeout(() => {
        pressed.current = true;
        setOpen(true);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      const start = pressStart.current;
      if (event.pointerType !== "touch" || !start || pressed.current) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
        pressStart.current = null;
        clear();
      }
    },
    onPointerUp: (event) => {
      if (event.pointerType !== "touch") return;
      pressStart.current = null;
      if (!pressed.current) clear();
    },
    onClick: (event) => {
      if (pressed.current) {
        event.preventDefault();
        pressed.current = false;
      }
    },
    onContextMenu: (event) => {
      if (pressed.current || shown) event.preventDefault();
    },
  };

  return (
    <>
      {children(anchor)}
      {card && createPortal(
        <div
          ref={cardRef}
          id={id}
          role="tooltip"
          data-link-preview=""
          data-state={card.closing ? "closed" : "open"}
          className="link-preview fixed z-50"
          style={{ left: 0, top: 0, visibility: "hidden" }}
          onPointerEnter={(event) => { if (event.pointerType !== "touch") clear(); }}
          onPointerLeave={(event) => { if (event.pointerType !== "touch") later(false, HOVER_CLOSE_GRACE_MS); }}
        >
          <LinkPreviewCard href={href} github={github} preview={card.preview} />
        </div>,
        document.body,
      )}
    </>
  );
}

export type AnchorProps = {
  ref: (node: HTMLElement | null) => void;
  "aria-describedby"?: string;
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur: (event: React.FocusEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
};
