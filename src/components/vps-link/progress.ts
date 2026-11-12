import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { formatBytes, type VpsInstallProgress, type VpsLinkView, type VpsMoveStep, type VpsStepId } from "@/lib/vps-link";

export const STEP_TITLE: Record<VpsStepId, LocaleKey> = {
  check: "vpsLink.step.check", basics: "vpsLink.step.basics", docker: "vpsLink.step.docker", user: "vpsLink.step.user", node: "vpsLink.step.node",
  app: "vpsLink.step.app", engines: "vpsLink.step.engines", service: "vpsLink.step.service", address: "vpsLink.step.address",
  desktop: "vpsLink.step.desktop", link: "vpsLink.step.link",
};
const MOVE_TITLE: Record<VpsMoveStep, LocaleKey> = {
  backup: "vpsLink.move.step.backup", copy: "vpsLink.move.step.copy", verify: "vpsLink.move.step.verify", empty: "vpsLink.move.step.empty", done: "vpsLink.progress.connected",
};

export function reportedProgress(progress: VpsInstallProgress | undefined): { value: number | null; detail: string | null } {
  if (!progress) return { value: null, detail: null };
  if (progress.kind === "download") {
    const received = formatBytes(progress.receivedBytes);
    return progress.totalBytes
      ? { value: progress.receivedBytes / progress.totalBytes, detail: t("vpsLink.progress.download", { received, total: formatBytes(progress.totalBytes) }) }
      : { value: null, detail: t("vpsLink.progress.received", { received }) };
  }
  const counts = t(progress.kind === "layers" ? "vpsLink.progress.layers" : "vpsLink.progress.build", { done: progress.completed, total: progress.total });
  const bytes = progress.receivedBytes !== undefined ? reportedProgress({ kind: "download", receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes }) : null;
  return { value: bytes?.value ?? progress.completed / progress.total, detail: bytes?.detail ? `${counts} · ${bytes.detail}` : counts };
}

export function vpsProgress(view: VpsLinkView): { title: string; detail: string | null; value: number | null; failed: boolean; error: string | null } {
  const failedStep = view.steps.find((step) => step.status === "failed");
  const error = view.move?.error ?? view.error ?? view.activity?.error ?? failedStep?.log ?? null;
  const failed = Boolean(view.move?.status === "failed" || failedStep || view.stage === "error" || (view.stage === "idle" && error));
  if (view.move) {
    const move = view.move;
    const chats = move.step === "copy" ? move.chats : null;
    const bytes = move.step === "backup" && move.bytes ? reportedProgress({ kind: "download", receivedBytes: move.bytes.done, totalBytes: move.bytes.total }) : null;
    return {
      title: t(MOVE_TITLE[move.step], { name: view.server?.name ?? t("vpsLink.yourServer"), device: typeof window !== "undefined" && window.duskDesktop?.platform === "darwin" ? t("vpsLink.device.mac") : t("vpsLink.device.computer") }),
      detail: bytes?.detail ?? (chats ? t("vpsLink.move.chatsProgress", chats) : null),
      value: move.step === "done" ? 1 : bytes?.value ?? (chats && chats.total > 0 ? chats.done / chats.total : null), failed, error,
    };
  }
  if (view.stage === "installing") {
    const current = failedStep ?? view.steps.find((step) => step.status === "running") ?? view.steps.find((step) => step.status === "waiting");
    const reported = reportedProgress(current?.progress);
    return { title: current ? t(STEP_TITLE[current.id]) : t("vpsLink.install.almost"),
      detail: reported.detail ?? t("vpsLink.progress.steps", { done: view.steps.filter((step) => step.status === "done" || step.status === "skipped").length, total: view.steps.length }),
      value: reported.value, failed, error };
  }
  return { title: view.stage === "linked" || view.stage === "moved" ? t("vpsLink.progress.linked") : failed ? t("vpsLink.progress.paused") : t("vpsLink.progress.waiting"),
    detail: view.server?.name ?? null, value: null, failed, error };
}
