import type { DirectoryApp } from "../../shared/connector-directory.ts";
import type { ConnectorProvider } from "./provider.ts";

type Row = [id: string, label: string, url: string, domain: string, category: string, description: string];

// vendors' own hosted MCP servers. "oauth" rows were probed 2026-11-06: a 401 naming an authorization server whose
// metadata has a registration_endpoint, so anyone signs in with their own account and no app is registered per vendor.
// left out on purpose: no dynamic registration (github, hubspot, slack, box, xero, docusign, asana v2, render,
// pagerduty, zendesk). figma and vercel advertise registration but wait for an end-to-end sign-in test.
const OAUTH: readonly Row[] = [
  ["linear", "Linear", "https://mcp.linear.app/mcp", "linear.app", "project management", "Issues, projects and cycles in Linear"],
  ["notion", "Notion", "https://mcp.notion.com/mcp", "notion.so", "documents notes", "Search, read and write pages and databases"],
  ["atlassian", "Atlassian", "https://mcp.atlassian.com/v1/mcp", "atlassian.com", "project management", "Jira issues and Confluence pages"],
  ["sentry", "Sentry", "https://mcp.sentry.dev/mcp", "sentry.io", "developer monitoring", "Errors, issues and releases from Sentry"],
  ["stripe", "Stripe", "https://mcp.stripe.com", "stripe.com", "payments", "Customers, payments, invoices and refunds"],
  ["cloudflare", "Cloudflare", "https://bindings.mcp.cloudflare.com/mcp", "cloudflare.com", "developer cloud", "Workers, KV, R2 and D1 in your account"],
  ["paypal", "PayPal", "https://mcp.paypal.com/mcp", "paypal.com", "payments", "Invoices, orders, refunds and disputes"],
  ["intercom", "Intercom", "https://mcp.intercom.com/mcp", "intercom.com", "customer support", "Conversations, contacts and help articles"],
  ["supabase", "Supabase", "https://mcp.supabase.com/mcp", "supabase.com", "developer database", "Projects, tables, SQL and edge functions"],
  ["neon", "Neon", "https://mcp.neon.tech/mcp", "neon.tech", "developer database", "Serverless Postgres projects, branches and queries"],
  ["canva", "Canva", "https://mcp.canva.com/mcp", "canva.com", "design", "Find, create and export Canva designs"],
  ["webflow", "Webflow", "https://mcp.webflow.com/mcp", "webflow.com", "design", "Sites, pages and CMS collections"],
  ["wix", "Wix", "https://mcp.wix.com/mcp", "wix.com", "design", "Sites, stores and bookings on Wix"],
  ["monday", "monday.com", "https://mcp.monday.com/mcp", "monday.com", "project management", "Boards, items and updates"],
  ["jam", "Jam", "https://mcp.jam.dev/mcp", "jam.dev", "developer", "Bug reports with logs and network requests"],
  ["netlify", "Netlify", "https://netlify-mcp.netlify.app/mcp", "netlify.com", "developer hosting", "Sites, deploys and environment settings"],
  ["prisma", "Prisma", "https://mcp.prisma.io/mcp", "prisma.io", "developer database", "Prisma Postgres databases and migrations"],
  ["airtable", "Airtable", "https://mcp.airtable.com/mcp", "airtable.com", "database", "Bases, tables and records"],
  ["zapier", "Zapier", "https://mcp.zapier.com/api/mcp/mcp", "zapier.com", "automation", "Thousands of apps through your Zapier account"],
  ["clickup", "ClickUp", "https://mcp.clickup.com/mcp", "clickup.com", "project management", "Tasks, lists and docs"],
  ["granola", "Granola", "https://mcp.granola.ai/mcp", "granola.ai", "meeting notes", "Your meeting notes and transcripts"],
  ["close", "Close", "https://mcp.close.com/mcp", "close.com", "crm", "Leads, contacts and deals"],
  ["attio", "Attio", "https://mcp.attio.com/mcp", "attio.com", "crm", "Records, lists and notes in your CRM"],
  ["dropbox", "Dropbox", "https://mcp.dropbox.com/mcp", "dropbox.com", "file storage", "Find, read and share your files"],
  ["miro", "Miro", "https://mcp.miro.com/", "miro.com", "whiteboard design", "Boards, sticky notes and diagrams"],
  ["posthog", "PostHog", "https://mcp.posthog.com/mcp", "posthog.com", "analytics", "Insights, feature flags and events"],
  ["amplitude", "Amplitude", "https://mcp.amplitude.com/mcp", "amplitude.com", "analytics", "Charts, cohorts and experiments"],
  ["cal", "Cal.com", "https://mcp.cal.com/mcp", "cal.com", "scheduling", "Bookings, event types and availability"],
  ["gitlab", "GitLab", "https://gitlab.com/api/v4/mcp", "gitlab.com", "developer code", "Projects, issues and merge requests"],
  ["krisp", "Krisp", "https://mcp.krisp.ai/mcp", "krisp.ai", "meeting notes", "Meeting notes and action items"],
  ["fireflies", "Fireflies", "https://mcp.fireflies.ai/mcp", "fireflies.ai", "meeting notes", "Meeting transcripts and summaries"],
  ["apify", "Apify", "https://mcp.apify.com", "apify.com", "data scraping", "Run scrapers and read their results"],
  ["similarweb", "Similarweb", "https://mcp.similarweb.com/mcp", "similarweb.com", "marketing analytics", "Website traffic and competitor data"],
  ["grafana", "Grafana", "https://mcp.grafana.com/mcp", "grafana.com", "developer monitoring", "Dashboards, metrics and alerts"],
  ["honeycomb", "Honeycomb", "https://mcp.honeycomb.io/mcp", "honeycomb.io", "developer monitoring", "Traces, queries and SLOs"],
  ["buildkite", "Buildkite", "https://mcp.buildkite.com/mcp", "buildkite.com", "developer", "Pipelines, builds and jobs"],
  ["railway", "Railway", "https://mcp.railway.com/mcp", "railway.com", "developer hosting", "Projects, services and deploys"],
  ["mercury", "Mercury", "https://mcp.mercury.com/mcp", "mercury.com", "banking", "Accounts, balances and transactions"],
  ["ramp", "Ramp", "https://mcp.ramp.com/mcp", "ramp.com", "finance", "Cards, spend and reimbursements"],
];

// answer without a sign-in
const OPEN: readonly Row[] = [
  ["huggingface", "Hugging Face", "https://huggingface.co/mcp", "huggingface.co", "research", "Models, datasets, Spaces and papers"],
  ["exa", "Exa", "https://mcp.exa.ai/mcp", "exa.ai", "search", "Web search and page contents for agents"],
  ["context7", "Context7", "https://mcp.context7.com/mcp", "context7.com", "developer", "Current docs for any library"],
  ["deepwiki", "DeepWiki", "https://mcp.deepwiki.com/mcp", "deepwiki.com", "developer research", "Ask about any public GitHub repository"],
];

const app = (auth: "oauth" | "none") => ([id, label, url, domain, category, description]: Row): DirectoryApp => ({
  id, source: "remote-mcp", label, description, categories: [category], domain, logo: null, url, auth,
});

export const REMOTE_MCP_APPS: readonly DirectoryApp[] = [...OAUTH.map(app("oauth")), ...OPEN.map(app("none"))];

/** The vendors' own MCP servers: always available, nothing to set up, each signs in with the person's own account. */
export const remoteMcpProvider: ConnectorProvider = {
  id: "remote-mcp",
  available: () => true,
  catalog: async () => [...REMOTE_MCP_APPS],
};
