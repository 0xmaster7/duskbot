import { existsSync } from "node:fs";
import { join, sep } from "node:path";

export const LATEST_RELEASE_URL = "https://api.github.com/repos/goatedgrokbotalternative/thebot/releases/latest";

/** "managed" is a hosted or Cloud server that is updated for its owner. */
export type InstallKind = "desktop" | "managed" | "docker" | "podman" | "npm" | "git" | "unknown";

export function installKind(input: {
  desktopManaged: boolean;
  managed: boolean;
  serverRoot: string;
  exists?: (path: string) => boolean;
}): InstallKind {
  const exists = input.exists ?? existsSync;
  if (input.desktopManaged) return "desktop";
  if (input.managed) return "managed";
  if (exists("/.dockerenv")) return "docker";
  if (exists("/run/.containerenv")) return "podman";
  if (input.serverRoot.split(sep).includes("node_modules")) return "npm";
  if (exists(join(input.serverRoot, "..", ".git"))) return "git";
  return "unknown";
}

export interface UpdateCheck {
  current: string;
  install: InstallKind;
  latest?: string;
  available: boolean;
  releaseUrl?: string;
  command?: string;
  restart?: boolean;
}

/** This private fork has no authenticated release feed; updates are installed by its operator. */
export function createUpdateChecker(options: {
  current: string;
  install: InstallKind;
}) {
  return async function check(): Promise<UpdateCheck> {
    return { current: options.current, install: options.install, available: false };
  };
}
