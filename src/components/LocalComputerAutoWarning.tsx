import { t } from "@/lib/i18n";
import { ConfirmDialog } from "./ConfirmDialog";

export function LocalComputerAutoWarning({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={t("permissions.localAuto.title")}
      body={t("permissions.localAuto.body")}
      confirmLabel={t("common.ok")}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
