/** The engine fact the rule reads. The server's provider instance and the
 * renderer's InstanceInfo both carry it. */
export interface CloudEngine {
  computerMcp?: boolean;
}

/** An engine with computer tools gets the user's own VPS computer through a
 * scoped computer bridge. The turn stays on the bot's selected engine. */
export function canWorkOnCloud(engine: CloudEngine | undefined): boolean {
  return engine?.computerMcp === true;
}
