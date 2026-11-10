import { t } from "@/lib/i18n";

export interface Primary { label: string; busy?: boolean; busyLabel?: string; disabled?: boolean; quiet?: boolean; signIn?: boolean; onClick?: () => void; onCancel?: () => void; /** a sign-in is out: Open page again, with Cancel beside it */ waiting?: boolean }

export function PrimaryButton({ primary }: { primary: Primary }) {
  const labels = [primary.label, primary.busyLabel ?? t("connectApps.connecting")];
  const shown = primary.busy ? labels[1] : labels[0];
  return (
    <button type="button" className="ca-primary" data-tone={primary.quiet ? "quiet" : undefined} disabled={primary.busy || primary.disabled}
      aria-busy={primary.busy || undefined} data-composio-sign-in={primary.signIn ? "" : undefined} onClick={primary.onClick}>
      {labels.map((label) => <span key={label} aria-hidden={label === shown ? undefined : true}>{label}</span>)}
    </button>
  );
}
