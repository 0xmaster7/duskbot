// This computer's page with no bots of its own while the person's live somewhere else: which screen it shows instead of a
// blank first run (electron/bots-elsewhere.mjs answers where), and the dev-only stand-in for a fresh install.
import { useSyncExternalStore } from "react";

export type ElsewhereWhy = "moved" | "cloud" | "team" | "server";
export interface ElsewherePlace { id: string; name: string; why: ElsewhereWhy }
export interface ElsewhereSetup { kind: "server" | "cloud"; name: string }
export interface ElsewhereView { places: ElsewherePlace[]; known: ElsewhereSetup | null }
export interface ElsewhereBridge {
  state(): Promise<ElsewhereView>;
  open(id: string): Promise<boolean>;
  /** "server": the page opens its Add your VPS sheet; "cloud": main connects My Cloud; null: nothing remembered. */
  connect(): Promise<"server" | "cloud" | null>;
}

export type ElsewhereScreen =
  | { kind: "bots-on"; place: ElsewherePlace; others: ElsewherePlace[] }
  | { kind: "set-up-on"; setup: ElsewhereSetup };

const WHY = new Set<ElsewhereWhy>(["moved", "cloud", "team", "server"]);

/** main's answer, checked: anything else is no place. */
export function parseElsewhereView(raw: unknown): ElsewhereView {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const places = (Array.isArray(value.places) ? value.places : []).flatMap((entry): ElsewherePlace[] => {
    const place = entry as Partial<ElsewherePlace> | null;
    return place && typeof place.id === "string" && typeof place.name === "string" && place.name.trim() && WHY.has(place.why as ElsewhereWhy)
      ? [{ id: place.id, name: place.name.trim(), why: place.why as ElsewhereWhy }] : [];
  });
  const known = value.known as Partial<ElsewhereSetup> | null | undefined;
  return {
    places,
    known: known && (known.kind === "server" || known.kind === "cloud") && typeof known.name === "string" && known.name.trim()
      ? { kind: known.kind, name: known.name.trim() } : null,
  };
}

/** No bots of the person's own here: MausBot, the helper every place gets, and bots taken off the sidebar don't count. */
export function emptyHere(bots: readonly { defaultBot?: unknown; hidden?: boolean }[]): boolean {
  return !bots.some((bot) => !bot.defaultBot && !bot.hidden);
}

/** What the page shows instead of a fresh start; null when it starts as it would. `dismissed`: the places the person chose
 * to start fresh here instead of opening. */
export function elsewhereScreen({ view, empty, dismissed }: { view: ElsewhereView | null; empty: boolean; dismissed: readonly string[] }): ElsewhereScreen | null {
  if (!view || !empty) return null;
  const [place, ...others] = view.places;
  if (place) return dismissed.includes(dismissKey({ kind: "bots-on", place, others })) ? null : { kind: "bots-on", place, others };
  if (view.known && !dismissed.includes(dismissKey({ kind: "set-up-on", setup: view.known }))) return { kind: "set-up-on", setup: view.known };
  return null;
}

export function dismissKey(screen: ElsewhereScreen): string {
  return screen.kind === "bots-on" ? `place:${screen.place.id}` : `setup:${screen.setup.kind}:${screen.setup.name}`;
}

const DISMISSED = "omb-elsewhere-dismissed";
export function dismissedPlaces(): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(DISMISSED) ?? "[]");
    return Array.isArray(kept) ? kept.filter((entry): entry is string => typeof entry === "string") : [];
  } catch { return []; }
}
export function dismissPlace(key: string): void {
  try { localStorage.setItem(DISMISSED, JSON.stringify([...dismissedPlaces().filter((entry) => entry !== key), key].slice(-20))); } catch { /* storage full or off */ }
}

/** The dev button's stand-in: a fresh install whose account already set up OpenMausBot on a VPS. */
export const SIMULATED_FRESH_INSTALL: ElsewhereView = { places: [], known: { kind: "server", name: "My VPS" } };

/** Dev builds, or any build with localStorage "omb-dev-tools" set to "1". */
export function devToolsShown(): boolean {
  if (import.meta.env.DEV) return true;
  try { return localStorage.getItem("omb-dev-tools") === "1"; } catch { return false; }
}

let simulating = false;
const watchers = new Set<() => void>();
export function setSimulatedFreshInstall(on: boolean): void {
  simulating = on;
  for (const watch of watchers) watch();
}
export function useSimulatedFreshInstall(): boolean {
  return useSyncExternalStore((watch) => { watchers.add(watch); return () => { watchers.delete(watch); }; }, () => simulating, () => false);
}
