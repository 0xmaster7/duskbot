import type { VpsComputerStatus } from "./vps-computer.ts";

const READY_POLL_MS = 200;
const READY_SETTLE_MS = 400;
const READY_RECHECK_MS = 3_000;

/** False once a status shows something only a person can fix, so waiting longer cannot make it ready. */
export function readinessCanImprove(status: VpsComputerStatus): boolean {
  return status.daemonUp && status.image && status.imageMatches && status.managed && status.container === "running" &&
    status.network === "private" && status.mounts === "none" && status.security === "hardened";
}

/**
 * Polls the cheap driver probe right after a start and inspects in full only once the driver answers or every few
 * seconds, so a container that died or changed still ends the wait early. Undefined when no inspection finished.
 */
export async function pollVpsReadiness(input: {
  deadline: number;
  expired: () => boolean;
  driverAnswers: (containerId: string | null) => Promise<boolean>;
  inspect: () => Promise<VpsComputerStatus>;
}): Promise<VpsComputerStatus | undefined> {
  let status: VpsComputerStatus | undefined;
  let inspectedAt = Date.now();
  while (!input.expired() && Date.now() < input.deadline) {
    const answers = await input.driverAnswers(status?.container_id ?? null);
    if (input.expired()) break;
    if (answers || Date.now() - inspectedAt >= READY_RECHECK_MS) {
      status = await input.inspect();
      inspectedAt = Date.now();
      if (status.ready || !readinessCanImprove(status)) return status;
    }
    if (input.expired() || Date.now() >= input.deadline) break;
    await new Promise((resolve) => {
      const sleep = setTimeout(resolve, Math.min(answers ? READY_SETTLE_MS : READY_POLL_MS, Math.max(0, input.deadline - Date.now())));
      sleep.unref?.();
    });
  }
  return status;
}
