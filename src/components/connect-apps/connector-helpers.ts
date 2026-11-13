import type { Bot, InstanceInfo } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { connectorServiceAccess } from "@/lib/connector-grants";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";

export type ConnectorSetup = "ready" | "needs-setup" | "service-unavailable";

export function connectorSetupNotice(state: {
  configured: boolean;
  stale: boolean;
  setup: ConnectorSetup | undefined;
  remoteClient: boolean;
}): { key: LocaleKey; tone: "info" | "warning" } | null {
  if (state.configured || state.stale) return null;
  if (state.setup === "needs-setup") {
    return { key: state.remoteClient ? "connectors.setupNeededRemote" : "connectors.setupNeeded", tone: "info" };
  }
  return { key: "connectors.notConfigured", tone: "warning" };
}

export function botsUsingService(bots: Bot[], instances: InstanceInfo[], slug: string): Bot[] {
  return bots.filter((bot) =>
    !bot.hidden &&
    bot.composio !== false &&
    instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)
      ?.capabilities?.composioMcp === true &&
    connectorServiceAccess(bot.connectorTools, slug).level !== "none");
}

/** What a failed connect says to the person: a short sentence of ours for anything technical (status codes, service
 * names, ids), the server's own words only when they are already plain. */
export function plainConnectError(message: string): string | { key: LocaleKey } {
  if (/maximum of \d+ accounts/i.test(message)) return { key: "connectors.tooManyAccounts" };
  if (/too many|daily_tool_budget|429/i.test(message)) return { key: "connectors.tooManyTries" };
  if (/HTTP \d{3}|unavailable|unreachable|fetch failed|network|timed? ?out|ECONN|abort|service|[{}_]|Composio|\bID\b/i.test(message) || message.length > 140) {
    return { key: "connectors.connectFailed" };
  }
  return friendlyError(message, t("connectors.connectFailed"));
}
