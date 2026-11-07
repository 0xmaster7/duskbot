import type { AppConfig } from "./config.ts";
import { vpsLifecyclePolicy } from "./vps-config.ts";
export { vpsLifecyclePolicy } from "./vps-config.ts";

export interface VpsWorkspacePrivacy {
  cloudTeam: boolean;
  hostedWorkspace: boolean;
  sharedMembership: boolean;
}

export function vpsIdleTimeoutMinutes(cfg: AppConfig): 0 | 5 | 10 | 30 {
  return cfg.vps?.idleTimeoutMinutes ?? 10;
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
