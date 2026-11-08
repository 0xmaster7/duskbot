import { useSyncExternalStore } from "react";

export type ThemePref = "dark" | "light" | "system";
const KEY = "omb-dash-theme";
const listeners = new Set<() => void>();
const light = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: light)") : null;

const read = (): ThemePref => {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "system" ? v : "dark";
};

function apply(pref: ThemePref) {
  const resolved = pref === "system" ? (light?.matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f6f6f4" : "#1d1d1d");
}

light?.addEventListener("change", () => { if (read() === "system") apply("system"); });

export function setTheme(pref: ThemePref) {
  localStorage.setItem(KEY, pref);
  apply(pref);
  listeners.forEach((fn) => fn());
}

export function initTheme() {
  const q = new URLSearchParams(location.search).get("theme");
  if (q === "light" || q === "dark") apply(q);
  else apply(read());
}

export const useTheme = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, read, () => "dark" as ThemePref);
