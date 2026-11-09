export const APP_NAME = "Dusk Bot";
export const APP_REPOSITORY = "https://github.com/goatedgrokbotalternative/thebot";
export const DOCS_URL = `${APP_REPOSITORY}/tree/custom/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${APP_REPOSITORY}/blob/custom/docs/approval-levels.md`;
export const PASSKEY_HELP_URL = "https://dusk.bot/docs/troubleshooting/google-sign-in-cloud-browser";
export const FEEDBACK_URL = "https://discord.gg/9Wb8MEpXRs";
export const RELEASES_URL = `${APP_REPOSITORY}/releases`;
export const CLOUD_PLAN_URL = "https://app.dusk.bot/cloud";
export const LICENSE_URL = `${APP_REPOSITORY}/blob/custom/LICENSE`;

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
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
