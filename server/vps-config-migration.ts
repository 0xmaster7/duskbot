import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config.ts";
import type { VpsConfig } from "./vps-config.ts";

function hasLinkedVpsBots(dataDir: string): boolean {
  try {
    const bots: unknown = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
    return Array.isArray(bots) && bots.some(bot => bot && typeof bot === "object" && bot.cloudBackend === "vps");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("Cannot read existing bot computer preferences; refusing to change VPS routing");
  }
}

export function preserveVpsRouting(config: AppConfig, dataDir: string, linkedLocal: boolean, save: (patch: { vps: VpsConfig }) => void): void {
  if (config.vps?.mode !== undefined) return;
  const mode = config.vps?.sshAlias || (linkedLocal && hasLinkedVpsBots(dataDir)) ? "per-bot" : "shared";
  save({ vps: { mode } });
  config.vps = { ...config.vps, mode };
}
