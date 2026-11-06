import { AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SettingRow, SettingsRows } from "./SettingsPrimitives";
import {
  computerStateLabel,
  vpsComputerInventoryStateKind,
  vpsComputerShortId,
  type VpsComputerInventoryInstance,
} from "./LocalComputerSection";

/** Settings' list of OpenMaus-managed VPS computers, across every server in play. */
export function VpsComputersCard({
  instances,
  configured,
  aliases,
  loading,
  removingName,
  error,
  unavailableReason,
  onRefresh,
  onRemove,
}: {
  instances: VpsComputerInventoryInstance[];
  configured: boolean | null;
  aliases: string[];
  loading: boolean;
  removingName: string | null;
  error: string | null;
  unavailableReason: string | null;
  onRefresh: () => void;
  onRemove: (instance: VpsComputerInventoryInstance) => void;
}) {
  const status = loading && instances.length === 0
    ? t("common.checking")
    : unavailableReason && instances.length === 0
      ? undefined
      : configured === false
        ? t("settings.w6a.vps.notSetUp")
        : configured === true
          ? [aliases.join(", ") || t("vm.vps.configuredFallback"), inventoryCount(instances.length)].join(" · ")
          : undefined;
  if (configured === false && !loading && !unavailableReason) return null;
  return (
    <SettingsRows>
      <SettingRow title={t("settings.w6a.vps.title")} subtitle={status}>
        {(
            <button type="button" onClick={onRefresh} disabled={loading || removingName !== null} aria-label={t("vm.vps.refreshAria")} className="ui-button">
              <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {t("vm.refresh")}
            </button>
          )}
      </SettingRow>

      {error && <div role="alert" className="mx-3.5 my-1 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? t("vm.vps.checking")
          : unavailableReason
            ? t("vm.vps.unavailable", { reason: unavailableReason })
            : configured === false
              ? t("vm.vps.notConfigured")
              : instances.length === 1
                ? t("vm.vps.foundOne")
                : t("vm.vps.foundMany", { count: instances.length })}
      </p>

      {!(configured === false && !loading && !unavailableReason) && <div
        aria-busy={loading || removingName !== null}
        className="flex flex-col empty:hidden"
      >
        {unavailableReason && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 text-[13px] leading-[18px] text-ink-secondary">
            <AlertTriangle size={14} className="shrink-0 text-warning" /> {unavailableReason}
          </div>
        )}
        {instances.map((instance) => {
          const kind = vpsComputerInventoryStateKind(instance);
          const state = computerStateLabel(kind);
          const removing = removingName === instance.name;
          const shortId = vpsComputerShortId(instance.name);
          return (
            <div
              key={`${instance.vpsAlias ?? ""}:${instance.name}`}
              className="flex items-start justify-between gap-3 px-3.5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] leading-[18px] text-ink">
                    {instance.orphaned ? t("vm.vps.orphan", { id: shortId }) : instance.ownerName}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      instance.inUse || kind === "running"
                        ? "bg-success/15 text-success"
                        : kind === "stopped" || kind === "paused"
                          ? "bg-control text-ink-secondary"
                          : "bg-warning/15 text-warning",
                    )}
                  >
                    {state}
                  </span>
                  {aliases.length > 1 && (
                    <span className="rounded-full bg-control px-2 py-0.5 font-mono text-[11px] text-ink-secondary">
                      {instance.vpsAlias}
                    </span>
                  )}
                </div>
                {instance.inUse && (
                  <div className="text-[13px] leading-[18px] text-ink-secondary">{t("vm.vps.stopFirst")}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemove(instance)}
                disabled={loading || instance.inUse || removingName !== null}
                aria-busy={removing || undefined}
                title={t("vm.vps.removeTitle")}
                className="ui-button ui-button-danger disabled:cursor-not-allowed disabled:opacity-40!"
              >
                {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t("vm.vps.remove")}
              </button>
            </div>
          );
        })}
      </div>}
    </SettingsRows>
  );
}

export const inventoryCount = (count: number) => count === 1 ? t("settings.w6a.desktopOne") : count === 0 ? t("settings.w6a.desktopNone") : t("settings.w6a.desktopMany", { count });
