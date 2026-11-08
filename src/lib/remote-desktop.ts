import type { InstanceInfo } from "@/state/store";
import { canWorkOnCloud, type CloudEngine } from "../../shared/cloud-computer";

export function isRemoteScreenshotContention(error: { status: number; message: string }): boolean {
  return error.status === 409 && [
    "this bot's cloud computer is being changed — wait for it to finish",
    "the VPS is being prepared — try again shortly",
    "VPS connection settings are being updated — wait for them to finish",
  ].includes(error.message);
}

export function cloudEngineOf(instance: InstanceInfo | undefined): CloudEngine {
  return { computerMcp: instance?.capabilities?.computerMcp };
}

export function computerCapableEngine(instances: readonly InstanceInfo[], selectedId?: string): InstanceInfo | undefined {
  const selected = selectedId ? instances.find(instance => instance.instanceId === selectedId) : undefined;
  return selected && canWorkOnCloud(cloudEngineOf(selected)) ? selected : undefined;
}
