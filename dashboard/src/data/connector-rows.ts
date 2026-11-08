import type { DashApp } from "./connectors.ts";

export type ConnectorType = "Connector" | "MCP" | "Skill";
export type ConnectorStatus = "ready" | "needs-auth";
export interface ConnectorRow {
  id: string;
  app: DashApp | null;
  label: string;
  type: ConnectorType;
  category: string;
  status: ConnectorStatus;
  tools: number | null;
  permissions: "Ask first" | "Allowed" | null;
  workspaces: Array<{ id: string; name: string }>;
}
export interface ConnectorExtras {
  [appIdLowercase: string]: { status?: ConnectorStatus; tools?: number; permissions?: "Ask first" | "Allowed" };
}

export const CATEGORY_NAMES = {
  credentials: "Password Managers", productivity: "Productivity", communication: "Communication", design: "Design",
  code: "Code", data: "Data", sales: "Sales", marketing: "Marketing", finance: "Finance", research: "Research",
  support: "Support", ai: "AI", other: "Other",
};

const POPULAR = ["gmail", "googlecalendar", "googledrive", "slack", "github", "notion", "googledocs", "googlesheets", "outlook", "linear", "figma", "zoom", "dropbox", "jira", "hubspot", "asana", "trello", "discord", "bitwarden", "lastpass", "dashlane"];
const idsOf = (app: DashApp) => [app.id, ...(app.aliases ?? []), ...(app.composio ? [app.composio] : []), ...(app.remote ? [app.remote] : [])].map((id) => id.toLowerCase());
const popularity = (row: ConnectorRow) => Math.min(...(row.app ? idsOf(row.app) : [row.id.toLowerCase()]).map((id) => POPULAR.indexOf(id)).filter((index) => index >= 0));

export const FIXTURE_EXTRAS: ConnectorExtras = {
  notion: { tools: 12, permissions: "Allowed" },
  github: { tools: 26, permissions: "Ask first" },
  slack: { tools: 9, permissions: "Allowed" },
  gmail: { tools: 14, permissions: "Ask first" },
  googlecalendar: { tools: 7, permissions: "Allowed" },
  linear: { status: "needs-auth", tools: 0 },
  figma: { status: "needs-auth" },
};

export function connectorRows(apps: DashApp[], connections: Record<string, string[]>, workspaces: Array<{ id: string; name: string }>, extra: ConnectorExtras = {}): ConnectorRow[] {
  const connected = workspaces.map((workspace) => ({ workspace, ids: new Set((connections[workspace.id] ?? []).map((id) => id.toLowerCase())) }));
  const known = new Set(apps.flatMap(idsOf));
  const rows: ConnectorRow[] = [];
  const add = (id: string, app: DashApp | null, ids: string[]) => {
    const linked = connected.filter((entry) => ids.some((alias) => entry.ids.has(alias))).map(({ workspace }) => ({ id: workspace.id, name: workspace.name }));
    if (!linked.length) return;
    const extras = extra[id.toLowerCase()] ?? ids.map((alias) => extra[alias]).find((value) => value !== undefined);
    rows.push({ id, app, label: app?.label ?? id, type: app?.kind === "remote" || app?.kind === "custom" ? "MCP" : "Connector", category: app ? CATEGORY_NAMES[app.categories[0] ?? "other"] : "Other", status: extras?.status ?? "ready", tools: extras?.tools ?? null, permissions: extras?.permissions ?? null, workspaces: linked });
  };
  for (const app of apps) add(app.id, app, idsOf(app));
  const unknown = new Map<string, string>();
  for (const { workspace } of connected) for (const id of connections[workspace.id] ?? []) {
    const lower = id.toLowerCase();
    if (!known.has(lower) && !unknown.has(lower)) unknown.set(lower, id);
  }
  for (const [lower, id] of unknown) add(id, null, [lower]);
  return rows.sort((a, b) => Number(b.status === "needs-auth") - Number(a.status === "needs-auth") || popularity(a) - popularity(b) || a.label.localeCompare(b.label));
}

export const SKILLS: Array<{ id: string; label: string; description: string; category: string }> = [
  { id: "data-dashboards", label: "Data dashboards", description: "Build dashboards and pages to explore, share and track data.", category: "Productivity" },
  { id: "social-posts", label: "Social posts", description: "Preview social posts and carousels for each platform.", category: "Marketing" },
  { id: "phone-harness", label: "Phone harness", description: "Control and test an Android phone over authorized USB debugging.", category: "Code" },
  { id: "create-verification-skill", label: "Verification skills", description: "Create a skill to launch, drive and verify an app or project.", category: "Code" },
];

export function skillRows(workspaces: Array<{ id: string; name: string }>): ConnectorRow[] {
  return SKILLS.map((skill) => ({ id: skill.id, app: null, label: skill.label, type: "Skill", category: skill.category, status: "ready", tools: null, permissions: "Allowed", workspaces: workspaces.map(({ id, name }) => ({ id, name })) }));
}
