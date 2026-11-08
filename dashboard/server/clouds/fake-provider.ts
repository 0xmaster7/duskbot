import type { CloudProvider, CreateServerInput, ProviderServer } from "./types.ts";
import { RetryableCloudError } from "./http.ts";

export function createFakeCloudProvider({ bootSteps = 2 }: { bootSteps?: number } = {}) {
  const servers = new Map<string, ProviderServer & { cloudId: string; polls: number }>();
  const calls: Array<{ method: string; serverId?: string; input?: unknown }> = [];
  let sequence = 0;
  const provider = {
    name: "fake" as const, calls, failNextCreate: false as boolean, failNextStatus: false as boolean,
    async find(cloudId: string) { calls.push({ method: "find", input: cloudId }); const server = [...servers.values()].find(s => s.cloudId === cloudId && s.state !== "missing"); return server ? { ...server } : null; },
    async create(input: CreateServerInput) {
      calls.push({ method: "create", input });
      if (provider.failNextCreate) { provider.failNextCreate = false; throw new RetryableCloudError(); }
      const existing = [...servers.values()].find(s => s.cloudId === input.cloudId && s.state !== "missing");
      if (existing) return { ...existing };
      const id = String(++sequence);
      const server = { id, cloudId: input.cloudId, state: "creating" as ProviderServer["state"], ipv4: `203.0.113.${1 + (sequence % 253)}`, serverType: "fake", diskGb: input.spec.diskGb, polls: 0 };
      servers.set(id, server);
      return { ...server };
    },
    async status(serverId: string): Promise<ProviderServer> {
      calls.push({ method: "status", serverId });
      if (provider.failNextStatus) { provider.failNextStatus = false; throw new RetryableCloudError(); }
      const server = servers.get(serverId);
      if (!server) return { id: serverId, state: "missing", ipv4: null, serverType: "fake", diskGb: 0 };
      if (server.state === "creating" || server.state === "starting") server.state = ++server.polls >= Math.max(1, bootSteps) ? "running" : "starting";
      return { ...server };
    },
    async power(serverId: string, action: "on" | "off") { calls.push({ method: `power:${action}`, serverId }); const server = servers.get(serverId); if (!server) throw new Error("Missing fake server."); server.state = action === "on" ? "running" : "off"; },
    async resize(serverId: string, spec: CreateServerInput["spec"]) { calls.push({ method: "resize", serverId, input: spec }); const server = servers.get(serverId); if (!server || server.state !== "off") throw new Error("Server must be off."); server.diskGb = Math.max(server.diskGb, spec.diskGb); },
    async destroy(serverId: string) { calls.push({ method: "destroy", serverId }); servers.delete(serverId); },
  } satisfies CloudProvider & { calls: typeof calls; failNextCreate: boolean; failNextStatus: boolean };
  return provider;
}
