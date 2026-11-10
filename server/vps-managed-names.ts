import { DOCKER_NAMES } from "../electron/legacy-names.mjs";
export const VPS_MANAGED_LABEL = DOCKER_NAMES.label("vps");
export const VPS_CONTAINER_LABEL = DOCKER_NAMES.label("container");
export const MANAGED_VPS_CONTAINER_NAME = new RegExp(`^${DOCKER_NAMES.vpsPrefix}-[a-z0-9]{1,12}-[a-f0-9]{12}$`);

/** A renamed copy of a managed computer (a manual backup) keeps its labels but is never listed or acted on. */
export function isRenamedManagedCopy(name: string, labels: unknown): boolean {
  if (!labels || typeof labels !== "object") return false;
  const labelled = (labels as Record<string, unknown>)[VPS_CONTAINER_LABEL];
  return (labels as Record<string, unknown>)[VPS_MANAGED_LABEL] === "1" && typeof labelled === "string" &&
    MANAGED_VPS_CONTAINER_NAME.test(labelled) && !MANAGED_VPS_CONTAINER_NAME.test(name) && name.startsWith(`${labelled}-`);
}
