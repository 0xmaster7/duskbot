// Apps dusk bot connects for free with the person's own credentials: a token they paste, or a device sign-in to our own
// GitHub App or Google client (no app review). Each one either becomes the vendor's own MCP server with the token in a
// header ("mcp"), or a small API tool dusk bot serves itself ("api"). Shared by the server and the Connect apps window.

export type TokenAppId =
  | "github" | "notion" | "linear" | "airtable" | "todoist" | "trello" | "clickup"
  | "hubspot" | "jira" | "shopify" | "stripe" | "cloudflare" | "googledrive";

/** One thing the person pastes or types. `secret` fields are never shown again. */
export interface TokenField {
  key: "token" | "key" | "email" | "site" | "shop";
  label: string;
  placeholder: string;
  secret: boolean;
}

export interface TokenAppSpec {
  id: TokenAppId;
  label: string;
  domain: string;
  /** Where the person makes the token: opened from the card. */
  settingsUrl: string;
  /** One short sentence: what to make there. */
  howTo: string;
  fields: readonly TokenField[];
  /** "device": signs in with a code on the vendor's own page instead of a pasted token. */
  device?: boolean;
}

const token = (placeholder: string): TokenField => ({ key: "token", label: "Token", placeholder, secret: true });

export const TOKEN_APPS: readonly TokenAppSpec[] = [
  { id: "github", label: "GitHub", domain: "github.com", settingsUrl: "https://github.com/settings/personal-access-tokens/new",
    howTo: "Make a fine-grained token with access to the repositories you want, then paste it here.", fields: [token("github_pat_…")] },
  { id: "notion", label: "Notion", domain: "notion.so", settingsUrl: "https://www.notion.so/profile/integrations",
    howTo: "Make an internal integration, share the pages you want with it, then paste its secret here.", fields: [token("ntn_…")] },
  { id: "linear", label: "Linear", domain: "linear.app", settingsUrl: "https://linear.app/settings/account/security",
    howTo: "Make a personal API key, then paste it here.", fields: [token("lin_api_…")] },
  { id: "airtable", label: "Airtable", domain: "airtable.com", settingsUrl: "https://airtable.com/create/tokens",
    howTo: "Make a personal access token with the bases you want, then paste it here.", fields: [token("pat…")] },
  { id: "todoist", label: "Todoist", domain: "todoist.com", settingsUrl: "https://app.todoist.com/app/settings/integrations/developer",
    howTo: "Copy your API token from the Developer tab, then paste it here.", fields: [token("API token")] },
  { id: "trello", label: "Trello", domain: "trello.com", settingsUrl: "https://trello.com/power-ups/admin",
    howTo: "Make a Power-Up to get an API key, follow its Token link, then paste both here.",
    fields: [{ key: "key", label: "API key", placeholder: "API key", secret: false }, token("Token")] },
  { id: "clickup", label: "ClickUp", domain: "clickup.com", settingsUrl: "https://app.clickup.com/settings/apps",
    howTo: "Generate your personal API token, then paste it here.", fields: [token("pk_…")] },
  { id: "hubspot", label: "HubSpot", domain: "hubspot.com", settingsUrl: "https://app.hubspot.com/l/integrations-settings/",
    howTo: "Make a service key (or use a private app token) with the scopes you want, then paste it here.", fields: [token("pat-…")] },
  { id: "jira", label: "Jira", domain: "atlassian.com", settingsUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    howTo: "Make an API token, then add your site and the email you sign in with.",
    fields: [{ key: "site", label: "Site", placeholder: "yourteam (from yourteam.atlassian.net)", secret: false },
      { key: "email", label: "Email", placeholder: "you@example.com", secret: false }, token("API token")] },
  { id: "shopify", label: "Shopify", domain: "shopify.com", settingsUrl: "https://admin.shopify.com/settings/apps/development",
    howTo: "Use your store's Admin API access token, then add the store name.",
    fields: [{ key: "shop", label: "Store", placeholder: "yourstore (from yourstore.myshopify.com)", secret: false }, token("shpat_…")] },
  { id: "stripe", label: "Stripe", domain: "stripe.com", settingsUrl: "https://dashboard.stripe.com/apikeys",
    howTo: "Make a restricted key with only what the bot needs, then paste it here.", fields: [token("rk_live_…")] },
  { id: "cloudflare", label: "Cloudflare", domain: "cloudflare.com", settingsUrl: "https://dash.cloudflare.com/profile/api-tokens",
    howTo: "Make an API token with the permissions you want, then paste it here.", fields: [token("API token")] },
  { id: "googledrive", label: "Google Drive", domain: "drive.google.com", settingsUrl: "https://www.google.com/device",
    howTo: "Sign in with Google. dusk bot sees only the files it makes or you open with it.", fields: [], device: true },
];

export const tokenApp = (id: string): TokenAppSpec | undefined => TOKEN_APPS.find((app) => app.id === id);

/** One connected account, as the window sees it: never a token. */
export interface TokenAccountView {
  id: string;
  app: TokenAppId;
  /** Who it signed in as: a login, a workspace or a store name. */
  label: string;
  /** The MCP server it is kept under. */
  server: string;
  connectedAt: string;
  via: "token" | "device";
}

export interface TokenAppsStatus {
  accounts: TokenAccountView[];
  /** Device sign-ins this build can offer (its client is set up). */
  device: { github: boolean; googledrive: boolean };
}

/** A device sign-in under way: the code to type on the vendor's page. */
export interface DeviceStart {
  handle: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  /** Seconds to wait between checks. */
  interval: number;
}

export type DevicePoll =
  | { status: "waiting" }
  | { status: "connected"; account: TokenAccountView }
  | { status: "failed"; message: string };
