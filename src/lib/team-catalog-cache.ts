import { api } from "@/state/store";
import type { TeamCatalog } from "@/lib/team-catalog";

let shown: TeamCatalog | null = null;
let reading: Promise<TeamCatalog> | null = null;

/** The last catalog read, so an open draws the list at once and only refreshes it quietly. */
export function shownTeamCatalog(): TeamCatalog | null {
  return shown;
}

/** Reads the catalog (one read at a time) and keeps it. Templates calls it on open; the places that fetch Templates ahead
 * call it too, so a first open has its list in the first frame instead of popping it in below the ready-made bots. */
export function readTeamCatalog(): Promise<TeamCatalog> {
  reading ??= (async () => {
    try {
      // SAFETY: this endpoint is owned by the app and returns TeamCatalog.
      shown = (await api("/api/team-library/catalog")) as TeamCatalog;
      return shown;
    } finally {
      reading = null;
    }
  })();
  return reading;
}

export function warmTeamCatalog(): void {
  void readTeamCatalog().catch(() => {});
}
