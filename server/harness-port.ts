/** The port this server's HTTP API listens on. */
export function harnessPort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.DUSK_PORT || env.OGB_PORT || 8799);
}
