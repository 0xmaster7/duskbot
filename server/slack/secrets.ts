import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";
import { decryptBrowserState, encryptBrowserState } from "../browser-sites.ts";
import type { SavedSecretsKey } from "../saved-secrets.ts";

export const SLACK_SECRETS_FILE = "slack-secrets.json.enc";
export interface SlackWorkspaceRecord {
  teamId: string; teamName: string; userId?: string;
  configToken: string; refreshToken: string; expiresAt: number;
  state: "connected" | "needs_reconnect"; error?: string; connectedAt: number; rotatedAt: number;
}
export interface SlackBotRecord {
  botId: string; appId: string; teamId: string;
  clientId: string; clientSecret: string; signingSecret: string; redirectUri: string;
  manifestHash: string;
  oauthState?: { hash: string; expiresAt: number };
  botToken?: string; botUserId?: string; teamName?: string; handle?: string; installedAt?: number;
  appToken?: string; appTokenAt?: number;
  error?: string; createdAt: number;
}

const id = z.string().min(1).max(64);
const name = z.string().max(200);
const secret = z.string().min(1).max(4096);
const hash = z.string().length(64).regex(/^[0-9a-f]{64}$/);
const workspaceSchema = z.strictObject({
  teamId: id, teamName: name, userId: id.optional(), configToken: secret, refreshToken: secret,
  expiresAt: z.number(), state: z.enum(["connected", "needs_reconnect"]), error: z.string().max(400).optional(),
  connectedAt: z.number(), rotatedAt: z.number(),
});
const botSchema = z.strictObject({
  botId: id, appId: id, teamId: id, clientId: id, clientSecret: secret, signingSecret: secret,
  redirectUri: z.string().min(1).max(2048), manifestHash: hash,
  oauthState: z.strictObject({ hash, expiresAt: z.number() }).optional(),
  botToken: secret.optional(), botUserId: id.optional(), teamName: name.optional(), handle: name.optional(),
  installedAt: z.number().optional(), appToken: secret.optional(), appTokenAt: z.number().optional(),
  error: z.string().max(400).optional(), createdAt: z.number(),
});
const fileSchema = z.strictObject({ version: z.literal(1), workspace: workspaceSchema.nullable(), bots: z.array(botSchema).max(200) });
type StoreFile = z.infer<typeof fileSchema>;
const empty = (): StoreFile => ({ version: 1, workspace: null, bots: [] });

export class SlackSecretsUnavailable extends Error {
  constructor() {
    super("Slack secrets are not ready on this computer yet. Try again in a moment.");
    this.name = "SlackSecretsUnavailable";
  }
}

export class SlackSecretStore {
  private readonly file: string;
  private readonly key: SavedSecretsKey;
  private cache: StoreFile | null = null;

  constructor(options: { dataDir: string; key: SavedSecretsKey }) {
    this.file = join(options.dataDir, SLACK_SECRETS_FILE);
    this.key = options.key;
  }

  /** The key can throw (a data folder that holds its own config folder gets none): that is "not ready", never a crash. */
  private keyValue(): string | null {
    try { return this.key.get(); } catch { return null; }
  }

  ready(): boolean {
    return this.keyValue() !== null;
  }

  private read(): StoreFile {
    if (this.cache) return this.cache;
    const key = this.keyValue();
    if (key === null) return empty();
    let data = empty();
    if (existsSync(this.file)) {
      try {
        data = fileSchema.parse(JSON.parse(decryptBrowserState(readFileSync(this.file), key)));
      } catch {
        // A file this key cannot open is kept aside and its contents are never logged.
        try { renameSync(this.file, `${this.file}.unreadable-${Date.now()}`); } catch {}
        console.warn("Slack: the saved secrets file could not be opened; it was set aside and a new one started.");
      }
    }
    this.cache = data;
    return data;
  }

  private requireKey(): string {
    const key = this.keyValue();
    if (key === null) throw new SlackSecretsUnavailable();
    return key;
  }

  private write(data: StoreFile): void {
    const key = this.requireKey();
    const parsed = fileSchema.safeParse(data);
    if (!parsed.success) throw new Error("Invalid Slack secrets record.");
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, encryptBrowserState(JSON.stringify(parsed.data), key), { mode: 0o600 });
    this.cache = parsed.data;
  }

  workspace(): SlackWorkspaceRecord | null {
    return structuredClone(this.read().workspace);
  }

  setWorkspace(record: SlackWorkspaceRecord | null): void {
    this.write({ ...this.read(), workspace: record });
  }

  bot(botId: string): SlackBotRecord | null {
    return structuredClone(this.read().bots.find((record) => record.botId === botId) ?? null);
  }

  bots(): readonly SlackBotRecord[] {
    return structuredClone(this.read().bots);
  }

  putBot(record: SlackBotRecord): void {
    const data = this.read();
    this.write({ ...data, bots: [...data.bots.filter((other) => other.botId !== record.botId), record] });
  }

  patchBot(botId: string, patch: Partial<SlackBotRecord>): SlackBotRecord | null {
    this.requireKey();
    const data = this.read();
    const current = data.bots.find((record) => record.botId === botId);
    if (!current) return null;
    const next = { ...current, ...patch };
    for (const key of Object.keys(next) as (keyof SlackBotRecord)[]) {
      if (next[key] === undefined) delete next[key];
    }
    this.write({ ...data, bots: data.bots.map((record) => record.botId === botId ? next : record) });
    return structuredClone(next);
  }

  removeBot(botId: string): boolean {
    this.requireKey();
    const data = this.read();
    const bots = data.bots.filter((record) => record.botId !== botId);
    if (bots.length === data.bots.length) return false;
    this.write({ ...data, bots });
    return true;
  }

  botByStateHash(hash: string): SlackBotRecord | null {
    return structuredClone(this.read().bots.find((record) => record.oauthState?.hash === hash) ?? null);
  }

  secretValues(): string[] {
    const data = this.read();
    return [data.workspace?.configToken, data.workspace?.refreshToken,
      ...data.bots.flatMap((record) => [record.clientSecret, record.signingSecret, record.botToken, record.appToken])]
      .filter((value): value is string => typeof value === "string");
  }
}
