/** Which Chromium a bot's browser tools drive when its computer is a VPS box. */
export type BoxBrowserRoute = "mounted" | "host" | "own-box" | "shared-box" | "refuse";

export function boxBrowserRoute(input: { mountedForTurn: boolean; inTurn: boolean; ownCloudBox: boolean; teamComputer: boolean }): BoxBrowserRoute {
  if (input.mountedForTurn) return "mounted";
  if (!input.ownCloudBox && !input.teamComputer) return "host";
  // a team computer's screen and browser profile belong to the turn's lease, so a turn without one has none
  if (input.teamComputer) return input.inTurn ? "refuse" : "shared-box";
  // a turn pinned to the built-in browser mounts no screen; its browser is still the bot's own box's Chromium
  return "own-box";
}
