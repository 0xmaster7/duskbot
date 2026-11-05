import { AlertTriangle } from "lucide-react";
import type { ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export type LicenseNotice = { tone: "warning" | "danger"; text: string };

export function licenseNotice(config: ConfigStatus | null | undefined): LicenseNotice | null {
  const license = config?.edition?.license;
  if (!license || typeof license.expiresAt !== "string" || !Number.isFinite(license.expiresInDays)) return null;
  if (license.graceEndsAt) {
    return { tone: "danger", text: t("settings.license.grace", { date: license.expiresAt, graceEnd: license.graceEndsAt }) };
  }
  return { tone: "warning", text: t("settings.license.expiring", { date: license.expiresAt, days: String(Math.max(0, license.expiresInDays)) }) };
}

export function LicenseExpiryBanner({ config }: { config: ConfigStatus | null | undefined }) {
  const notice = licenseNotice(config);
  if (!notice) return null;
  return (
    <div
      role="status"
      data-license-banner={notice.tone}
      className="flex items-start gap-2.5 rounded-[14px] bg-menu px-3.5 py-2.5 outline-[0.5px] outline-offset-[-0.5px] outline-edge [outline-style:solid]"
    >
      <AlertTriangle size={14} aria-hidden="true" className={cn("mt-0.5 shrink-0", notice.tone === "danger" ? "text-danger" : "text-warning")} />
      <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">{notice.text}</span>
    </div>
  );
}
