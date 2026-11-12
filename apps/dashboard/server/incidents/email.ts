import { render } from "../email/layout.ts";
import type { Block, EmailConfig, Rendered } from "../email/layout.ts";
import type { Incident } from "./store.ts";

export type IncidentMailKind = "new" | "digest" | "daily";
const SHOWN = 8;

export const when = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} utc`;
const SOURCE_LABEL: Record<string, string> = {
  server: "account service", process: "account service crashed", log: "service log", database: "database", upstream: "site upstream", test: "test",
  web: "dashboard page", admin: "admin page", desktop: "desktop app page", "desktop-main": "desktop app",
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function incidentBlocks(incident: Incident, sinceMail: number | null): Block[] {
  const rows: Array<[string, string]> = [
    ["where", `${SOURCE_LABEL[incident.source] ?? incident.source}${incident.route ? ` · ${incident.route}` : ""}${incident.status ? ` · ${incident.status}` : ""}`],
    ["count", sinceMail !== null && sinceMail !== incident.count ? `${sinceMail} since the last email, ${incident.count} in all` : String(incident.count)],
    ["first seen", when(incident.firstSeen)],
    ["last seen", when(incident.lastSeen)],
  ];
  if (incident.requestId) rows.push(["request id", incident.requestId]);
  if (incident.path) rows.push(["page", incident.path]);
  if (incident.version || incident.os) rows.push(["app", [incident.version, incident.os].filter(Boolean).join(" · ")]);
  rows.push(["id", incident.id]);
  return [
    { t: "h2", text: `${incident.name}: ${incident.message || "(no message)"}`.slice(0, 200) },
    { t: "facts", rows },
    ...(incident.stack.length ? [{ t: "list" as const, items: incident.stack.slice(0, 6) }] : []),
  ];
}

/** the owner's "something's wrong" email: new problems, a digest of repeats, or yesterday's summary */
export function incidentEmail(cfg: EmailConfig, input: { kind: IncidentMailKind; env: string; incidents: Array<{ incident: Incident; sinceMail: number | null }>; panelUrl: string; test?: boolean }): Rendered {
  const { kind, incidents } = input;
  const prefix = input.env === "production" ? "" : `[${input.env}] `;
  const first = incidents[0]!.incident;
  const total = incidents.reduce((sum, item) => sum + (item.sinceMail ?? item.incident.count), 0);
  const subject = input.test ? `${prefix}test alert: this is what a problem looks like`
    : kind === "new" ? `${prefix}something's wrong: ${first.name}${first.route ? ` on ${first.route}` : ` (${SOURCE_LABEL[first.source] ?? first.source})`}${incidents.length > 1 ? ` and ${incidents.length - 1} more` : ""}`
    : kind === "digest" ? `${prefix}still happening: ${plural(incidents.length, "problem")}, ${plural(total, "time")}`
    : `${prefix}yesterday: ${plural(incidents.length, "problem")} on dusk bot`;
  const heading = input.test ? "test alert" : kind === "new" ? "something's wrong" : kind === "digest" ? "still happening" : "yesterday's problems";
  const intro = input.test ? `this is a test from the ${input.env} account service. a real one looks just like this.`
    : kind === "new" ? `${incidents.length === 1 ? "a new problem showed up" : `${incidents.length} new problems showed up`} on ${input.env}. repeats are batched into one email every 15 minutes at most.`
    : kind === "digest" ? `these kept happening on ${input.env} since the last email.`
    : `${plural(incidents.length, "problem")} happened on ${input.env} yesterday.`;
  const shown = incidents.slice(0, SHOWN);
  return render(cfg, {
    subject, preheader: `${first.name}: ${first.message}`.slice(0, 120), tag: input.env === "production" ? "alert" : `alert · ${input.env}`, hero: null,
    blocks: [
      { t: "h1", text: heading },
      { t: "p", text: intro },
      ...shown.flatMap(item => incidentBlocks(item.incident, kind === "digest" ? item.sinceMail : null)),
      ...(incidents.length > SHOWN ? [{ t: "p" as const, small: true, text: `and ${incidents.length - SHOWN} more on the health page.` }] : []),
      { t: "button", label: "open admin health", href: input.panelUrl },
      { t: "p", small: true, text: "to mute one problem, post {\"hours\": 24} to /v1/admin/incidents/<id>/mute while signed in as an admin. DUSK_ALERTS=off stops these emails." },
    ],
    reason: "you got this because your address is in DUSK_ALERT_EMAILS (or DUSK_ADMIN_EMAILS) for this dusk bot service.",
  });
}
