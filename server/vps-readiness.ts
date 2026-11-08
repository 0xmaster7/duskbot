import type { VpsComputerStatus } from "./vps-computer.ts";

const READY_SETTLE_MS = 400;
const READY_RECHECK_MS = 3_000;

/** False once a status shows something only a person can fix, so waiting longer cannot make it ready. */
export function readinessCanImprove(status: VpsComputerStatus): boolean {
  return status.daemonUp && status.image && status.imageMatches && status.managed && status.container === "running" &&
    status.network === "private" && status.mounts === "none" && status.security === "hardened";
}

export function validateVpsDesktopReport(stdout: string): void {
  const report = JSON.parse(stdout) as { schema_version?: string; overall?: string; checks?: unknown[] };
  if (report.schema_version !== "1" || !Array.isArray(report.checks) || (report.overall !== "ok" && report.overall !== "degraded")) {
    throw new Error(`Cua health report is ${report.overall ?? "invalid"}`);
  }
}

export async function pollVpsReadiness(input: {
  deadline: number;
  expired: () => boolean;
  waitAndProbe: (status: VpsComputerStatus, waitMs: number) => Promise<void>;
  inspect: (reuseProbe?: boolean) => Promise<VpsComputerStatus>;
}): Promise<VpsComputerStatus> {
  let status = await input.inspect();
  while (!input.expired() && Date.now() < input.deadline && readinessCanImprove(status) && status.container_id) {
    const before = status;
    let failure: unknown;
    try {
      await input.waitAndProbe(status, Math.min(READY_RECHECK_MS, input.deadline - Date.now()));
    } catch (error) {
      failure = error;
    }
    if (input.expired()) break;
    status = await input.inspect(failure === undefined);
    if (status.ready || !readinessCanImprove(status)) return status;
    if (failure !== undefined && status.container_id === before.container_id && status.container_started_at === before.container_started_at) {
      status.desktop_error = failure instanceof Error ? failure.message.slice(0, 320) : null;
      if (status.desktop_error) status.problem = `The VPS Cua desktop failed to start: ${status.desktop_error}`;
    }
    if (input.expired() || Date.now() >= input.deadline) break;
    await new Promise((resolve) => {
      const sleep = setTimeout(resolve, Math.min(READY_SETTLE_MS, Math.max(0, input.deadline - Date.now())));
      sleep.unref?.();
    });
  }
  return status;
}
