import type { AppConfig } from "./config.ts";
import { vpsLifecyclePolicy } from "./vps-config.ts";
export { vpsLifecyclePolicy } from "./vps-config.ts";

export interface VpsWorkspacePrivacy {
  cloudTeam: boolean;
  hostedWorkspace: boolean;
  sharedMembership: boolean;
}

export function vpsIdleTimeoutMinutes(cfg: AppConfig): 0 | 5 | 10 | 30 {
  return cfg.vps?.idleTimeoutMinutes || 10;
}

export function sharedVpsDefaults(cfg: AppConfig, privacy: VpsWorkspacePrivacy) {
  const mode = cfg.vps?.mode ?? "shared";
  const sharingAllowed = !privacy.cloudTeam && !privacy.hostedWorkspace && !privacy.sharedMembership;
  return {
    mode,
    autoStart: cfg.vps?.autoStart ?? true,
    independentScreens: cfg.vps?.independentScreens ?? true,
    maxScreens: cfg.vps?.maxScreens ?? 20,
    idleTimeoutMinutes: vpsIdleTimeoutMinutes(cfg),
    lifecycle: vpsLifecyclePolicy(cfg.vps),
    sharingAllowed,
    workspaceShared: mode === "shared" && sharingAllowed,
  };
}

/**
 * The mode to persist the first time this version loads a config without one. Before shared mode existed every Auto
 * and cloud bot had its own VPS computer, home volume and browser sign-ins, so a configured VPS with such a bot keeps
 * per-bot; a workspace computer already in use, or no VPS yet, takes the shared default. Undefined once a mode is saved.
 */
export function initialVpsMode(cfg: AppConfig, evidence: { vpsConfigured: boolean; botsOnOwnComputers: boolean; workspaceComputerInUse: boolean }): "shared" | "per-bot" | undefined {
  if (cfg.vps?.mode) return undefined;
  if (evidence.workspaceComputerInUse) return "shared";
  return evidence.vpsConfigured && evidence.botsOnOwnComputers ? "per-bot" : "shared";
}
