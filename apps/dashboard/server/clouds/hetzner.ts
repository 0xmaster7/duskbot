import type { CloudProvider } from "./types.ts";
import type { MachineSpec } from "../../../../shared/billing-api.ts";
import type { ProviderServer } from "./types.ts";
import { boundedJson, RetryableCloudError } from "./http.ts";

export { RetryableCloudError } from "./http.ts";
export interface HetznerServerType { name: string; vcpu: number; ramGb: number; diskGb: number }
export const HETZNER_SERVER_TYPES: HetznerServerType[] = [
  { name: "cx23", vcpu: 2, ramGb: 4, diskGb: 40 },
  { name: "cx33", vcpu: 4, ramGb: 8, diskGb: 80 },
  { name: "cx43", vcpu: 8, ramGb: 16, diskGb: 160 },
  { name: "cx53", vcpu: 16, ramGb: 32, diskGb: 320 },
  { name: "ccx33", vcpu: 8, ramGb: 32, diskGb: 240 },
  { name: "ccx43", vcpu: 16, ramGb: 64, diskGb: 360 },
  { name: "ccx53", vcpu: 32, ramGb: 128, diskGb: 600 },
];
interface Server { id: number; status: string; name: string; labels?: Record<string, string>; public_net?: { ipv4?: { ip: string } }; server_type: { name: string; disk: number }; disk_size?: number; datacenter?: { location: { name: string } }; volumes?: number[] }
interface Volume { id: number; size: number; server: number | null; labels?: Record<string, string> }
interface Api { server?: Server; servers?: Server[]; volume?: Volume; volumes?: Volume[]; error?: { code?: string }; meta?: { pagination?: { next_page?: number | null } } }

export function createHetznerProvider(options: { token: string; fetch?: typeof fetch; baseUrl?: string; image?: string; serverTypes?: HetznerServerType[] }): CloudProvider {
  const fetcher = options.fetch ?? fetch, base = (options.baseUrl ?? "https://api.hetzner.cloud/v1").replace(/\/$/, ""), types = options.serverTypes ?? HETZNER_SERVER_TYPES;
  const cloudIds = new Map<string, string>();
  function choose(spec: MachineSpec, diskGb = 0) { const type = types.find(t => t.vcpu >= spec.vcpu && t.ramGb >= spec.ramGb && t.diskGb >= diskGb); if (!type) throw new Error("Cloud machine size unavailable."); return type; }
  async function request(method: string, path: string, body?: unknown, missingOk = false): Promise<Api | null> {
    try {
      const response = await fetcher(`${base}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status === 404 && missingOk) { await response.body?.cancel(); return null; }
      if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); throw new RetryableCloudError(); }
      if (response.status === 204) return {};
      const data = await boundedJson(response, 1_048_576) as Api;
      if (!response.ok) {
        const code = data?.error?.code;
        const safe = typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code) && !code.includes(options.token) ? code : "failed";
        if (safe === "locked" || safe === "resource_unavailable") throw new RetryableCloudError();
        throw new Error(`Cloud provider error: ${safe}.`);
      }
      return data;
    } catch (error) {
      if (error instanceof RetryableCloudError || (error instanceof Error && /^Cloud provider error: [a-z0-9_]+\.$/.test(error.message))) throw error;
      throw new RetryableCloudError();
    }
  }
  async function volumes(cloudId?: string, serverId?: string): Promise<Volume[]> {
    const selector = cloudId ? `omb_cloud==${cloudId}` : `omb_server==${serverId}`;
    const found: Volume[] = [];
    let page: number | null = 1;
    while (page) {
      const data: Api | null = await request("GET", `/volumes?label_selector=${encodeURIComponent(selector)}&page=${page}&per_page=50`);
      found.push(...data?.volumes ?? []);
      page = data?.meta?.pagination?.next_page ?? null;
    }
    return found;
  }
  function mapped(server: Server): ProviderServer {
    const id = String(server.id), cloudId = server.labels?.omb_cloud ?? server.name;
    if (/^c[0-9a-f]{24}$/.test(cloudId)) cloudIds.set(id, cloudId);
    const states: Record<string, ProviderServer["state"]> = { initializing: "creating", starting: "starting", running: "running", stopping: "stopping", off: "off", deleting: "deleting" };
    return { id, state: states[server.status] ?? "error", ipv4: server.public_net?.ipv4?.ip ?? null, serverType: server.server_type.name, diskGb: server.disk_size ?? server.server_type.disk };
  }
  const provider: CloudProvider = {
    name: "hetzner",
    async find(cloudId) {
      const data = await request("GET", `/servers?label_selector=${encodeURIComponent(`omb_cloud==${cloudId}`)}`);
      return data?.servers?.[0] ? mapped(data.servers[0]) : null;
    },
    async create(input) {
      const existing = await provider.find(input.cloudId); if (existing) return existing;
      const type = choose(input.spec), labels = { omb_cloud: input.cloudId };
      let volume: Volume | undefined = (await volumes(input.cloudId))[0];
      if (!volume) volume = (await request("POST", "/volumes", { size: input.spec.diskGb, name: input.cloudId, location: input.region, labels, format: "ext4" }))?.volume;
      if (!volume) throw new Error("Cloud provider returned no volume.");
      const data = await request("POST", "/servers", { name: input.cloudId, server_type: type.name, image: options.image ?? "ubuntu-24.04", location: input.region, user_data: input.userData, labels, start_after_create: true, public_net: { enable_ipv4: true, enable_ipv6: true }, volumes: [volume.id], automount: false });
      if (!data?.server) throw new Error("Cloud provider returned no server.");
      const server = mapped(data.server);
      cloudIds.set(server.id, input.cloudId);
      await request("PUT", `/volumes/${volume.id}`, { labels: { ...labels, omb_server: server.id } });
      return { ...server, diskGb: volume.size };
    },
    async status(id) { const data = await request("GET", `/servers/${encodeURIComponent(id)}`, undefined, true); return data?.server ? mapped(data.server) : { id, state: "missing", ipv4: null, serverType: "", diskGb: 0 }; },
    async power(id, action) { await request("POST", `/servers/${encodeURIComponent(id)}/actions/${action === "on" ? "poweron" : "shutdown"}`, {}); },
    async suspend(id) { await request("POST", `/servers/${encodeURIComponent(id)}/actions/poweroff`, {}); },
    async resize(id, spec) {
      const data = await request("GET", `/servers/${encodeURIComponent(id)}`, undefined, true);
      if (!data?.server) throw new Error("Cloud server unavailable.");
      const status = mapped(data.server);
      if (status.state !== "off") throw new Error("Cloud server must be off to resize.");
      const type = choose(spec, status.diskGb), cloudId = cloudIds.get(id);
      if (!cloudId) throw new Error("Cloud server unavailable.");
      const disks = await volumes(cloudId);
      if (disks.length !== 1 || disks[0].server !== Number(id)) throw new Error("Cloud data volume unavailable.");
      if (disks[0].size < spec.diskGb) await request("POST", `/volumes/${disks[0].id}/actions/resize`, { size: spec.diskGb });
      await request("POST", `/servers/${encodeURIComponent(id)}/actions/change_type`, { server_type: type.name, upgrade_disk: false });
    },
    async cleanup(cloudId) {
      for (const volume of await volumes(cloudId)) {
        if (volume.server !== null) throw new RetryableCloudError();
        await request("DELETE", `/volumes/${volume.id}`, undefined, true);
      }
    },
    async destroy(id) {
      const data = await request("GET", `/servers/${encodeURIComponent(id)}`, undefined, true);
      if (data?.server) mapped(data.server);
      const cloudId = cloudIds.get(id);
      if (cloudId) {
        for (const volume of await volumes(cloudId)) await request("PUT", `/volumes/${volume.id}`, { labels: { omb_cloud: cloudId, omb_server: id } });
      }
      await request("DELETE", `/servers/${encodeURIComponent(id)}`, undefined, true);
      const ownedVolumes = await volumes(cloudId, id);
      for (const volume of ownedVolumes) {
        if (volume.server !== null) throw new RetryableCloudError();
        await request("DELETE", `/volumes/${volume.id}`, undefined, true);
      }
      cloudIds.delete(id);
    },
  };
  return provider;
}
