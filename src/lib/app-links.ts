export const APP_NAME = "dusk bot";
export const SITE_URL = "https://dusk.bot";
export const DOCS_URL = `${SITE_URL}/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${DOCS_URL}/computer#asking-first`;
export const PASSKEY_HELP_URL = "https://dusk.bot/docs/troubleshooting";
export const FEEDBACK_URL = "https://discord.gg/9Wb8MEpXRs";
export const RELEASES_URL = `${SITE_URL}/changelog`;
export const CLOUD_PLAN_URL = "https://dusk.bot/dashboard/cloud";
export const LICENSE_URL = `${SITE_URL}/license`;
export const THIRD_PARTY_NOTICES_URL = "/third-party-notices.txt";

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

export async function openExternalLink(url: string): Promise<void> {
  if (window.duskDesktop?.openExternal) {
    await window.duskDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
