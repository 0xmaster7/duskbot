// Which phones get a push for an event. A phone with the app open shows the event itself, so the host pushes only to a
// phone that is away. An event that lands while the app is open is held for a while: when the phone leaves (and stays
// gone a moment) before then, it gets the push it would have missed.
export const HELD_EVENT_MS = 5 * 60_000;
/** a phone that leaves and comes back within this was only switching apps or locking the screen for a second */
export const LEAVE_SETTLE_MS = 3_000;
/** an open app says so at least this often; one that stops (killed, suspended, out of signal) counts as away */
export const PRESENCE_LEASE_MS = 60_000;
const MAX_HELD = 32;

export interface PresenceEvent { id: string; threadId: string }

interface Phone<T> {
  away: boolean;
  leaseUntil: number;
  held: Array<{ at: number; event: T }>;
  settle?: ReturnType<typeof setTimeout>;
  lease?: ReturnType<typeof setTimeout>;
}

export function createPhonePresence<T extends PresenceEvent>(deps: {
  /** the phone left and stayed away: push these, oldest first */
  flush(deviceId: string, events: T[]): void;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const phones = new Map<string, Phone<T>>();

  const fresh = (phone: Phone<T>) => phone.held.filter((one) => now() - one.at < HELD_EVENT_MS);

  function settle(deviceId: string) {
    const phone = phones.get(deviceId);
    if (!phone) return;
    phone.settle = undefined;
    if (!phone.away) return;
    const events = fresh(phone).map((one) => one.event);
    phone.held = [];
    if (events.length) deps.flush(deviceId, events);
  }

  function leave(deviceId: string, phone: Phone<T>) {
    phone.away = true;
    clearTimeout(phone.lease);
    phone.lease = undefined;
    if (phone.held.length && !phone.settle) {
      phone.settle = setTimeout(() => settle(deviceId), LEAVE_SETTLE_MS);
      phone.settle.unref?.();
    }
  }

  function current(deviceId: string): Phone<T> | undefined {
    const phone = phones.get(deviceId);
    if (phone && !phone.away && now() >= phone.leaseUntil) leave(deviceId, phone);
    return phone;
  }

  return {
    /** what the phone says about itself: away when the app went to the background, present while it is open */
    report(deviceId: string, away: boolean) {
      const phone = phones.get(deviceId) ?? { away: true, leaseUntil: 0, held: [] };
      phones.set(deviceId, phone);
      if (away) return leave(deviceId, phone);
      phone.away = false;
      phone.leaseUntil = now() + PRESENCE_LEASE_MS;
      clearTimeout(phone.settle);
      phone.settle = undefined;
      clearTimeout(phone.lease);
      phone.lease = setTimeout(() => { const one = phones.get(deviceId); if (one && !one.away) leave(deviceId, one); }, PRESENCE_LEASE_MS);
      phone.lease.unref?.();
    },
    /** "push" now, or "held" because the app is open (or left a moment ago and may yet come back) */
    route(deviceId: string, event: T): "push" | "held" {
      const phone = current(deviceId);
      // a phone that never said anything (an older app, or this server just started) is treated as away
      if (!phone || (phone.away && !phone.settle)) return "push";
      phone.held = fresh(phone).filter((one) => one.event.id !== event.id);
      phone.held.push({ at: now(), event });
      if (phone.held.length > MAX_HELD) phone.held.splice(0, phone.held.length - MAX_HELD);
      return "held";
    },
    away(deviceId: string): boolean {
      const phone = current(deviceId);
      return !phone || phone.away;
    },
    forget(deviceId: string) {
      const phone = phones.get(deviceId);
      if (!phone) return;
      clearTimeout(phone.settle);
      clearTimeout(phone.lease);
      phones.delete(deviceId);
    },
    /** for tests */
    held: (deviceId: string) => phones.get(deviceId)?.held.map((one) => one.event) ?? [],
  };
}
