// a wake asked for before the computer panel's code arrived: the panel takes it when it mounts, unless it went stale
const STALE_MS = 15_000;
const queued = new Map<string, number>();

export function queueComputerWake(botId: string, now = Date.now()): void {
  queued.set(botId, now);
}

export function takeQueuedComputerWake(botId: string, now = Date.now()): boolean {
  const at = queued.get(botId);
  queued.delete(botId);
  return at !== undefined && now - at < STALE_MS;
}
