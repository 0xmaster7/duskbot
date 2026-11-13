// AI sign-ins the Admin held for this Cloud while it was being made (apps/dashboard/server/clouds/ai-stash.ts), pushed once
// over the signed home channel. Never log what arrives. A login already on this Cloud wins: a held one never replaces it.
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codexHome } from "./drivers/codex-identity.ts";

export const CLOUD_AI_SIGNINS_PATH = "/api/cloud/ai-signins";
const MAX_AUTH_BYTES = 32 * 1024;

export type CloudAiSignIn = { kind: "codex-auth"; auth: string };

export function parseCloudAiSignIns(value: unknown): CloudAiSignIn[] | null {
  if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1) return null;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 4) return null;
  const out: CloudAiSignIn[] = [];
  for (const item of items) {
    const { kind, auth } = (item ?? {}) as { kind?: unknown; auth?: unknown };
    if (kind !== "codex-auth" || typeof auth !== "string" || !auth || Buffer.byteLength(auth) > MAX_AUTH_BYTES) return null;
    try {
      const parsed = JSON.parse(auth) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    } catch { return null; }
    out.push({ kind, auth });
  }
  return out;
}

/** Writes each sign-in where its engine reads it; `applied` names the kinds that landed, `kept` those already signed in here. */
export function applyCloudAiSignIns(items: readonly CloudAiSignIn[], env: Record<string, string | undefined>): { applied: string[]; kept: string[] } {
  const applied: string[] = [], kept: string[] = [];
  for (const item of items) {
    const home = codexHome(env);
    if (!home) continue;
    const file = join(home, "auth.json");
    if (existsSync(file)) { kept.push(item.kind); continue; }
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, item.auth, { mode: 0o600 });
    renameSync(temp, file);
    applied.push(item.kind);
  }
  return { applied, kept };
}
