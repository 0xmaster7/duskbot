import { vpsSshAlias, type AppConfig } from "./config.ts";
import { teamComputerOwner, type TeamComputerRecord } from "./team-computers.ts";
import { vpsContainerName } from "./vps-computer.ts";

export function teamComputerVpsTarget(cfg: AppConfig, computer: Pick<TeamComputerRecord, "id">) {
  const ownerId = teamComputerOwner(computer.id);
  const alias = vpsSshAlias(cfg);
  return {
    ownerId,
    config: alias ? { vps: { sshAlias: alias } } : {},
    containerName: vpsContainerName(ownerId),
    resource: `computer:vps:${alias}:${ownerId}`,
  };
}
