import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
if (typeof window !== "undefined") window.addEventListener("popstate", notify);

const subscribe = (fn: () => void) => { listeners.add(fn); return () => void listeners.delete(fn); };
const snapshot = () => window.location.pathname + window.location.search;

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot, () => "/");
  const url = new URL(href, "http://x");
  return { path: url.pathname.replace(/\/+$/, "") || "/", query: url.searchParams };
}

export function scrollToHash(hash: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: "start" })));
}

export function navigate(to: string, { replace = false } = {}) {
  const [target, hash] = to.split("#");
  if (target !== snapshot() || hash) {
    if (replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    if (!replace && !hash) window.scrollTo({ top: 0 });
    notify();
  }
  if (hash) scrollToHash(hash);
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={go} {...rest} />;
}
