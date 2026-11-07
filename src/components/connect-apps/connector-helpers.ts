import type { Bot, InstanceInfo } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { connectorServiceAccess } from "@/lib/connector-grants";

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
