import type { AppConfig } from "../config.ts";
import { configured, listToolkits } from "../composio.ts";
import type { ConnectorProvider } from "./provider.ts";

/** Composio's whole marketplace, through the user's own project key (COMPOSIO_API_KEY, Settings > API keys) or the
 * managed broker. Connecting stays on /api/connectors/:slug/authorize, Composio's hosted sign-in. */
export function composioProvider(cfg: AppConfig): ConnectorProvider {
  return {
    id: "composio",
    available: () => configured(cfg),
    catalog: async () => {
      const { cards } = await listToolkits(cfg);
      return cards.map((card) => ({
        id: card.slug, source: "composio", label: card.label, description: card.blurb,
        categories: card.categories ?? [], domain: card.domain, logo: card.logo,
      }));
    },
  };
}
