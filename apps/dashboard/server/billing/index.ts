import { hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardState } from "../store.ts";
import { createCloudsService } from "../clouds/service.ts";
import { createFakeCloudProvider } from "../clouds/fake-provider.ts";
import { createFakePoolDriver } from "../clouds/fake-pool-driver.ts";
import { createPoolProvider } from "../clouds/pool.ts";
import { createHetznerProvider } from "../clouds/hetzner.ts";
import { createHomeClient } from "../clouds/home-client.ts";
import { createSealer, parseSealKey } from "../clouds/seal.ts";
import type { CloudProvider, HomeClient } from "../clouds/types.ts";
import { join } from "node:path";
import { boatScope, createBoatProvider, type BoatSize } from "../clouds/boat.ts";
import { createAudit, type AuditEntry } from "../clouds/boat-audit.ts";
import { createBackupStore } from "../clouds/boat-backups.ts";
import { boatSettingsFromEnv } from "../clouds/boat-lifecycle.ts";
import { entitlementOf, type NoticeKind } from "../clouds/boat-retention.ts";
import type { StoredCloud } from "../clouds/types.ts";
import { DESKTOP_KINDS } from "../../../../shared/billing-api.ts";
import type { Catalog } from "../../../../shared/billing-api.ts";
import { createBillingStore } from "./store.ts";
import { BillingError, createBillingService } from "./service.ts";
import { BILLING_CONFIG, dodoProducts } from "./plans.ts";
import { createFakeBillingProvider } from "./fake-provider.ts";
import { createDodoProvider } from "./dodo-provider.ts";
import { BillingProviderError } from "./types.ts";
import type { AccountRef, AccountResolver, BillingProvider } from "./types.ts";
import { createBillingRoutes } from "./routes.ts";
import { createAdminRoutes } from "./admin-routes.ts";

export interface BillingOptions {
  dataDir: string; publicUrl: string; dashboard: { state: DashboardState; changed(): void; close?(): void }; accounts: AccountResolver;
  accountExists?: (accountId: string) => boolean;
  env?: NodeJS.ProcessEnv; now?: () => number; fetch?: typeof fetch;
  /** measured wake times the catalog may show (the slack edge times wakes) */
  wakeStats?: () => NonNullable<Catalog["wake"]>;
  /** a Boat cloud's notice to its owner (retention, recovery, deletion requests); delivery failures are logged, never thrown */
  notify?: (cloud: StoredCloud, kind: NoticeKind, at: number | null, link?: string) => void;
  /** the operator's alert for every Boat deletion */
  alert?: (entry: AuditEntry) => void;
}
/** a loopback service's own Boat backup secret, kept beside its data */
function localSecret(path: string): Buffer {
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
  return parseSealKey(readFileSync(path, "utf8").trim());
}
/** the hosted app's Bearer resolver remains null until shared/account-api.ts supplies the accounts service */
export function createBilling(options: BillingOptions) {
  const env = options.env ?? process.env, now = options.now ?? Date.now, url = new URL(options.publicUrl);
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  function required(key: string) { const value = env[key]; if (!value) throw new Error(`${key} is required.`); return value; }
  function choice(key: string, allowed: string[]) {
    const value = env[key]; if (value !== undefined && !allowed.includes(value)) throw new Error(`Invalid ${key}.`);
    return value ?? (loopback ? "fake" : "off");
  }
  const billingProvider = choice("OMB_BILLING_PROVIDER", ["fake", "dodo"]);
  const cloudProvider = choice("OMB_CLOUD_PROVIDER", ["fake", "hetzner"]), poolDriver = choice("OMB_POOL_DRIVER", ["fake"]);
  const fake = billingProvider === "fake" ? createFakeBillingProvider({ now }) : null;
  const unavailable = () => { throw new BillingProviderError("unavailable"); };
  let provider: BillingProvider;
  if (billingProvider === "dodo") {
    const apiKey = required("OMB_DODO_API_KEY"), webhookSecret = required("OMB_DODO_WEBHOOK_SECRET");
    const mode = env.OMB_DODO_MODE ?? "test";
    if (mode !== "test" && mode !== "live") throw new Error("Invalid OMB_DODO_MODE.");
    required("OMB_DODO_PRODUCTS");
    provider = createDodoProvider({ apiKey, webhookSecret, mode, now, fetch: options.fetch });
  } else provider = fake ?? { name: "dodo", createCheckout: unavailable, portal: unavailable, verifyWebhook: unavailable, cancelAtPeriodEnd: unavailable, changePlan: unavailable, invoiceUrl: unavailable, invoicePdf: unavailable };
  let products: Record<string, string>;
  try { products = dodoProducts(env); } catch { throw new Error("Invalid OMB_DODO_PRODUCTS."); }
  const config = { ...BILLING_CONFIG, products };
  const sealKey = env.OMB_CLOUD_SEAL_KEY ? parseSealKey(env.OMB_CLOUD_SEAL_KEY) : null;
  const image = cloudProvider === "hetzner" ? required("OMB_CLOUD_HOME_IMAGE") : env.OMB_CLOUD_HOME_IMAGE ?? "ghcr.io/openmausbot/openmausbot-cloud-home:latest";
  const disabled: CloudProvider = { name: "fake", find: unavailable, create: unavailable, status: unavailable, power: unavailable, resize: unavailable, destroy: unavailable };
  let dedicated: CloudProvider = disabled;
  if (cloudProvider === "fake") dedicated = createFakeCloudProvider();
  if (cloudProvider === "hetzner") {
    const token = required("OMB_HETZNER_TOKEN"); required("OMB_CLOUD_SEAL_KEY");
    dedicated = createHetznerProvider({ token, fetch: options.fetch });
  }
  /** a real pool host driver does not exist yet; only the isolated fake driver is available */
  const fakePool = poolDriver === "fake" ? createFakePoolDriver({ hosts: [1, 2].map(n => ({ id: `fake-${n}`, region: "fsn1", domain: "pool.openmausbot.test", draining: false, capacity: { vcpu: 64, ramGb: 128, diskGb: 4000, slots: 100 } })) }) : null;
  const pool = fakePool ? createPoolProvider({ driver: fakePool, now }) : { ...disabled, suspend: unavailable, resume: unavailable };
  // Boat (OMB_BOAT=1): the Boat API key stays in this process; homes never receive it
  let boat: Parameters<typeof createCloudsService>[0]["boat"];
  let billingStore: ReturnType<typeof createBillingStore> | null = null;
  if (env.OMB_BOAT !== undefined && env.OMB_BOAT !== "0" && env.OMB_BOAT !== "1") throw new Error("Invalid OMB_BOAT.");
  if (env.OMB_BOAT === "1") {
    const apiKey = required("BOAT_API_KEY");
    if (!loopback) required("OMB_CLOUD_SEAL_KEY");
    const kinds = (env.OMB_BOAT_KINDS ?? "shared_s,shared_m,dedicated").split(",").map(k => k.trim());
    if (!kinds.length || kinds.some(k => k === "none" || !(DESKTOP_KINDS as readonly string[]).includes(k))) throw new Error("Invalid OMB_BOAT_KINDS.");
    const smallest = env.OMB_BOAT_SMALLEST ?? "small";
    if (!["small", "default", "large", "xlarge"].includes(smallest)) throw new Error("Invalid OMB_BOAT_SMALLEST.");
    const scope = env.OMB_BOAT_SCOPE ?? boatScope(url.origin);
    // the backup secret never leaves this service: its own key, or one derived from the seal key, or (loopback only) a local file
    const backupSecret = env.OMB_BOAT_BACKUP_KEY ? parseSealKey(env.OMB_BOAT_BACKUP_KEY)
      : sealKey ? Buffer.from(hkdfSync("sha256", sealKey, Buffer.alloc(0), Buffer.from("omb-boat-backup-secret"), 32))
      : localSecret(join(options.dataDir, "boat-backup-secret"));
    boat = { kinds: kinds as Array<Exclude<(typeof DESKTOP_KINDS)[number], "none">>, settings: boatSettingsFromEnv(env), backupSecret,
      previousBackupSecret: env.OMB_BOAT_BACKUP_KEY_PREVIOUS ? parseSealKey(env.OMB_BOAT_BACKUP_KEY_PREVIOUS) : null,
      provider: createBoatProvider({ apiKey, baseUrl: env.BOAT_BASE_URL, scope, fetch: options.fetch, smallest: smallest as BoatSize }),
      backups: createBackupStore({ dir: env.OMB_BOAT_BACKUP_DIR || join(options.dataDir, "boat-backups"), now }),
      audit: createAudit({ dataDir: options.dataDir, now, alert: options.alert }),
      // the billing system of record, read at the moment of each decision
      entitlement: cloud => entitlementOf(billingStore?.state.subscriptions ?? [], cloud, now()),
      notify: (cloud, kind, at, link) => options.notify?.(cloud, kind, at, link) };
  }
  const realHome = createHomeClient({ fetch: options.fetch, now });
  const fakeHome: HomeClient = { healthy: async () => true, pair: async () => {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ", bytes = randomBytes(12);
    const code = [...bytes].map(b => alphabet[b % alphabet.length]).join("").match(/.{4}/g)!.join("-");
    return { code, expiresAt: now() + 300_000 };
  } };
  const boatHome = (origin: string) => origin.endsWith(".on.boat.dev");
  const home: HomeClient = {
    power: (origin, secret, minutes) => realHome.power!(origin, secret, minutes),
    sleep: (origin, secret, minutes) => realHome.sleep!(origin, secret, minutes),
    plan: (origin, secret, input) => realHome.plan!(origin, secret, input),
    healthy: (origin, secret) => boatHome(origin) ? realHome.healthy(origin, secret) : (loopback && (origin.endsWith(".pool.openmausbot.test") ? poolDriver === "fake" : cloudProvider === "fake") ? fakeHome : realHome).healthy(origin, secret),
    pair: (origin, secret, input) => boatHome(origin) ? realHome.pair(origin, secret, input) : (loopback && (origin.endsWith(".pool.openmausbot.test") ? poolDriver === "fake" : cloudProvider === "fake") ? fakeHome : realHome).pair(origin, secret, input),
  };
  const clouds = createCloudsService({ dataDir: options.dataDir, now, providers: { pool, dedicated }, home, sealer: createSealer(sealKey), ...(boat ? { boat } : {}),
    workspaces: {
      register({ accountId, name, publicKey }) {
        const id = `ws_${randomBytes(16).toString("base64url")}`;
        options.dashboard.state.workspaces.push({ id, publicKey, ownerAccountId: accountId, claimHash: null, claimExpiresAt: 0, name, kind: "vps", version: "", connectedAt: now(), lastReportAt: null, lastSeq: 0, lastSeqAt: 0, report: null, sectionAt: {} });
        options.dashboard.changed(); options.dashboard.close?.(); return id;
      },
      lastReportAt: id => options.dashboard.state.workspaces.find(ws => ws.id === id)?.lastReportAt ?? null,
      remove(id) { options.dashboard.state.workspaces = options.dashboard.state.workspaces.filter(ws => ws.id !== id); options.dashboard.changed(); options.dashboard.close?.(); },
    },
    config: { adminOrigin: url.origin, dashboardUrl: url.origin, image, originTemplate: env.OMB_CLOUD_ORIGIN_TEMPLATE,
      configured: { pool: poolDriver !== "off", dedicated: cloudProvider !== "off" },
      poolQuota(kind, spec, botComputers) { return { ...spec, ...(config.poolQuotas[kind as "shared_s" | "shared_m"] ?? config.poolQuotas.shared_m), botComputers }; } },
  });
  const store = createBillingStore(options.dataDir);
  billingStore = store;
  const service = createBillingService({ store, provider, clouds, config, publicUrl: url.origin, now });
  if (options.accountExists) service.scrubDeleted(options.accountExists);
  const opsToken = env.OMB_OPS_TOKEN || null;
  if (opsToken !== null && opsToken.length < 32) throw new Error("OMB_OPS_TOKEN must be at least 32 characters.");
  const context = { service, clouds, store, config, accounts: options.accounts, now, enabled: billingProvider !== "off", fake: loopback ? fake : null, wakeStats: options.wakeStats ?? (() => ({})), opsToken };
  const routes = createBillingRoutes(context), admin = createAdminRoutes(context);
  return {
    async handle(req: IncomingMessage, res: ServerResponse, target: URL) { return await routes(req, res, target) || await admin.handle(req, res, target); },
    async beforeAccountDelete(owner: AccountRef, body: Record<string, unknown>) {
      const blockers = service.deletionBlockers(owner.id);
      if (body.cancelBilling !== true && blockers.length) { const error = new BillingError(409, "billing_active"); error.blockers = blockers; throw error; }
      await service.closeAccount(owner, { destroyDesktopsNow: body.destroyDesktopsNow === true });
    },
    accountDeleted: service.accountDeleted,
    enabled: context.enabled, sessionFields: admin.sessionFields, licenseCheck: service.licenseCheck, service, clouds, fake, fakePool,
    close() { clouds.close(); service.close(); },
  };
}
export type BillingContext = {
  service: ReturnType<typeof createBillingService>; clouds: ReturnType<typeof createCloudsService>; store: ReturnType<typeof createBillingStore>;
  config: typeof BILLING_CONFIG; accounts: AccountResolver; now(): number; enabled: boolean; fake: ReturnType<typeof createFakeBillingProvider> | null;
  wakeStats(): NonNullable<Catalog["wake"]>;
  /** OMB_OPS_TOKEN: unset hides the operator's funnel read */
  opsToken: string | null;
};
