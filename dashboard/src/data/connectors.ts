import { useEffect, useState } from "react";
import {
  grokCategories,
  popularity,
  POPULAR_APPS,
  type AppEntry,
  type Category,
} from "@/components/connect-apps/catalog";
import { loadComposioSnapshot, type SnapshotToolkit } from "@/components/connect-apps/composio-snapshot";
import { appLogo } from "@/components/connect-apps/logos";
import { idsOf, mergeEntries } from "@/components/connect-apps/merge";

export { CATEGORIES, presentCategories, inCategory, searchApps, recommended } from "@/components/connect-apps/catalog";
export { idsOf } from "@/components/connect-apps/merge";
export type { Category } from "@/components/connect-apps/catalog";

export interface DashApp extends AppEntry {}

export const POPULAR = POPULAR_APPS;

export const CATEGORY_NAMES: Record<Category, string> = {
  credentials: "Password Managers",
  productivity: "Productivity",
  communication: "Communication",
  design: "Design",
  code: "Code",
  data: "Data",
  sales: "Sales",
  marketing: "Marketing",
  finance: "Finance",
  research: "Research",
  support: "Support",
  ai: "AI",
  other: "Other",
};

type AppsState = { apps: DashApp[] | null; error: string | null };

let cached: AppsState = { apps: null, error: null };
let request: Promise<AppsState> | null = null;

function loadApps(): Promise<AppsState> {
  request ??= loadComposioSnapshot().then((snapshot): AppsState => {
    if (!snapshot) return { apps: null, error: "Could not load the app catalog." };
    const entries = snapshot.toolkits.map((toolkit: SnapshotToolkit & { website?: string; domain?: string }): DashApp => {
      const { slug, name, description, website, domain } = toolkit;
      const bundled = appLogo(slug, name);
      return {
        id: slug,
        kind: "composio",
        label: name,
        description,
        categories: grokCategories([toolkit.category]),
        icon: {
          logo: toolkit.logo ?? `https://logos.composio.dev/api/${slug}`,
          ...(domain ? { domain } : {}),
          ...(bundled ? { image: bundled.src, padded: bundled.padded, background: bundled.background, scale: bundled.scale } : {}),
        },
        ...(website ? { website } : {}),
      };
    });
    const apps = mergeEntries(entries).sort((a, b) => popularity(a) - popularity(b));
    return { apps, error: null };
  }).catch((): AppsState => ({ apps: null, error: "Could not load the app catalog." }))
    .then((state) => (cached = state));
  return request;
}

export function useDashApps(): { apps: DashApp[] | null; error: string | null } {
  const [state, setState] = useState<AppsState>(() => cached);
  useEffect(() => {
    let active = true;
    void loadApps().then((loaded) => {
      if (active) setState(loaded);
    });
    return () => { active = false; };
  }, []);
  return state;
}

export function connectedIn(app: DashApp, connectedIds: readonly string[]): boolean {
  const connected = new Set(connectedIds.map((id) => id.toLowerCase()));
  return idsOf(app).some((id) => connected.has(id.toLowerCase()));
}
