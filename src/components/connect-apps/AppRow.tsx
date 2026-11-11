import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import { Icon, type IconName } from "../Icon";
import { ServiceTile } from "../ServiceIcon";
import type { AppEntry } from "./catalog";

export function AppTile({ entry, size = 40 }: { entry: Pick<AppEntry, "label" | "icon">; size?: number }) {
  const { glyph, glyphPaint, ...art } = entry.icon;
  if (glyph) return <GlyphTile name={glyph} size={size} paint={glyphPaint} />;
  return <ServiceTile card={{ label: entry.label, ...art }} size={size} />;
}

/** A glyph in a tile: white on the app's paint, as Grok draws its own apps, or quiet ink on the plain tile. */
export function GlyphTile({ name, size, paint }: { name: IconName; size: number; paint?: string }) {
  return (
    <span aria-hidden="true" className="ca-glyph-tile" data-painted={paint ? "" : undefined}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: paint }}>
      <Icon name={name} size={Math.round(size * (paint ? 0.55 : 0.45))} />
    </span>
  );
}

/** What sits at a row's end: a Connect pill that keeps its width through Connecting…, or the quiet Connected mark. */
export type RowAction =
  | { kind: "button"; label: string; busy?: boolean; pending?: boolean; disabled?: boolean; title?: string; onClick: () => void; onCancel?: () => void }
  | { kind: "connected" }
  | { kind: "status"; label: string; tone: "connected" | "attention" | "quiet" }
  | { kind: "none" };

export function ConnectedMark() {
  return (
    <span className="ca-added">
      <Icon name="check" size={12} />
      {t("apps.connected")}
    </span>
  );
}

/** Stops an app's connect where it is: anything that says Connecting… can always be left. */
export function CancelLink({ onCancel }: { onCancel: () => void }) {
  return <button type="button" className="ca-link ca-cancel" data-cancel="" onClick={onCancel}>{t("common.cancel")}</button>;
}

export function RowPill({ action, name }: { action: Extract<RowAction, { kind: "button" }>; name: string }) {
  const labels = [action.label, t("connectApps.connecting")];
  const shown = action.busy || action.pending ? labels[1] : labels[0];
  return (
    <>
      {action.onCancel && (action.busy || action.pending) && <CancelLink onCancel={action.onCancel} />}
      <button
        type="button"
        data-size="sm"
        className="ca-pill"
        disabled={action.busy || action.disabled}
        data-pending={action.pending ? "" : undefined}
        aria-busy={action.busy || action.pending || undefined}
        aria-label={shown !== labels[0] ? undefined : action.label === t("connectors.action.connect") ? t("connectApps.connectAria", { name })
          : action.label === t("connectApps.authorize") ? t("connectApps.authorizeAria", { name }) : undefined}
        title={action.title}
        onClick={action.onClick}
      >
        {labels.map((label) => <span key={label} aria-hidden={label === shown ? undefined : true}>{label}</span>)}
      </button>
    </>
  );
}

export function AppRow({ entry, subtitle, action, onOpen, children }: {
  entry: AppEntry;
  subtitle?: string;
  action: RowAction;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="ca-row" data-app-row={entry.id}>
      <button type="button" className="ca-row-open" aria-label={t("connectApps.open", { name: entry.label })} onClick={onOpen}>
        <AppTile entry={entry} />
        <span className="ca-row-main">
          <span className="ca-row-name">{entry.label}</span>
          {subtitle && <span className="ca-row-subtitle">{subtitle}</span>}
        </span>
      </button>
      <span className="ca-row-trail">
        {action.kind === "button" && <RowPill action={action} name={entry.label} />}
        {action.kind === "connected" && <ConnectedMark />}
        {action.kind === "status" && <span className="ca-status" role="status" data-status={action.tone}>{action.label}</span>}
        {children}
      </span>
    </div>
  );
}
