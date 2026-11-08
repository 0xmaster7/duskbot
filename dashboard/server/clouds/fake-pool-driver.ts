import type { PoolHost, PoolHostDriver, SlotState } from "./types.ts";
import { RetryableCloudError } from "./http.ts";

export function createFakePoolDriver({ hosts = [] }: { hosts?: PoolHost[] } = {}) {
  const entries = new Map<string, SlotState & { cloudId: string; bootstrap: string }>();
  const calls: Array<{ method: string; hostId?: string; slotId?: string; input?: unknown }> = [];
  let sequence = 0;
  function record(method: string, hostId?: string, slotId?: string, input?: unknown) {
    calls.push({ method, hostId, slotId, input });
    if (driver.failNext === method || driver.failNext === "*") { driver.failNext = null; throw new RetryableCloudError(); }
  }
  function requireSlot(hostId: string, slotId: string) { const slot = entries.get(slotId); if (!slot || slot.hostId !== hostId) throw new Error("Missing pool slot."); return slot; }
  const driver = {
    calls, failNext: null as string | null,
    async hosts() { record("hosts"); return structuredClone(hosts); },
    async slots(hostId: string) { record("slots", hostId); return structuredClone([...entries.values()].filter(s => s.hostId === hostId)); },
    async createSlot(hostId: string, input: { cloudId: string; quota: SlotState["quota"]; bootstrap: string }) {
      record("createSlot", hostId, undefined, input);
      const existing = [...entries.values()].find(s => s.cloudId === input.cloudId);
      if (existing) return structuredClone(existing);
      const slot = { id: `slot-${++sequence}`, hostId, state: "running" as const, ...structuredClone(input) };
      entries.set(slot.id, slot); return structuredClone(slot);
    },
    async slot(hostId: string, slotId: string) { record("slot", hostId, slotId); const slot = entries.get(slotId); return slot?.hostId === hostId ? structuredClone(slot) : null; },
    async findSlot(cloudId: string) { record("findSlot", undefined, undefined, cloudId); const slot = [...entries.values()].find(s => s.cloudId === cloudId); return slot ? structuredClone(slot) : null; },
    async power(hostId: string, slotId: string, action: "on" | "off") { record(`power:${action}`, hostId, slotId); const slot = requireSlot(hostId, slotId); if (slot.state === "suspended") throw new Error("Slot suspended."); slot.state = action === "on" ? "running" : "off"; },
    async setQuota(hostId: string, slotId: string, quota: SlotState["quota"]) { record("setQuota", hostId, slotId, quota); requireSlot(hostId, slotId).quota = structuredClone(quota); },
    async suspend(hostId: string, slotId: string, reason: string) { record("suspend", hostId, slotId, reason); requireSlot(hostId, slotId).state = "suspended"; },
    async resume(hostId: string, slotId: string) { record("resume", hostId, slotId); requireSlot(hostId, slotId).state = "running"; },
    async destroySlot(hostId: string, slotId: string) { record("destroySlot", hostId, slotId); const slot = entries.get(slotId); if (slot?.hostId === hostId) entries.delete(slotId); },
  } satisfies PoolHostDriver & { calls: typeof calls; failNext: string | null };
  return driver;
}
