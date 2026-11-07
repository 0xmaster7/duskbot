import { resolve } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { launchUi } from "./control-omb-ui.ts";
import { fixtureApi } from "./preview-fixture.ts";
import { createTeamVpsFixture } from "./team-vps-fixture.ts";

const MAP_TEAMS = [
  { team: "Research", bots: ["Iris", "Theo", "Mira", "Jonah"] },
  { team: "Growth", bots: ["Nova", "Felix", "Ruby", "Omar"] },
  { team: "Design", bots: ["Luna", "Kai", "Esme", "Remy"] },
  { team: "Ops", bots: ["Atlas", "Wren", "Sol", "Juno"] },
];

/** A Team map worth looking at: four teams whose bots each have their own cloud computer, one team sharing one, most
 * of them working (the fixture engine holds every turn open) and one asleep. */
export async function seedTeamMap(url: string): Promise<{ botIds: string[] }> {
  const api = fixtureApi(url);
  await api("PUT", "/api/config", { vps: { sshAlias: "fixture-vps" } });
  const botIds: string[] = [];
  for (const { team, bots } of MAP_TEAMS) {
    await api("POST", "/api/sidebar-sections", { name: team });
    for (const [index, name] of bots.entries()) {
      const { bot } = await api("POST", "/api/bots", { name, section: team, title: index === 0 ? "Chief of staff" : `${team} specialist` });
      if (index === 0) await api("PATCH", `/api/bots/${bot.id}`, { chiefOfStaff: true, managedSections: [], acknowledgePeerScope: true });
      if (team !== "Ops" || index === 0) {
        await api("PATCH", `/api/bots/${bot.id}`, { computer: "cloud" });
        await api("POST", `/api/bots/${bot.id}/computer/provision`, {});
      }
      botIds.push(bot.id);
    }
  }
  const computer: { id: string } = await api("POST", "/api/team-computers", { name: "Ops desktop", requestId: crypto.randomUUID(), acknowledgeCost: true });
  await api("PATCH", `/api/team-computers/${computer.id}`, { section: "Ops", acknowledgeSharedAccess: true });
  await api("POST", `/api/bots/${botIds[7]}/computer/sleep`, {});
  for (const [index, botId] of botIds.entries()) {
    if (index % 5 !== 3) await api("POST", `/api/bots/${botId}/messages`, { text: "Work on your task on your computer." });
  }
  return { botIds };
}

export async function launchTeamComputersPreview(options: { frames?: boolean; map?: boolean } = {}) {
  const vps = await createTeamVpsFixture({ frames: options.frames });
  const stdout = new Writable({ write(chunk, _encoding, done) {
    const info = JSON.parse(String(chunk));
    const setup = options.map ? seedTeamMap(info.url) : fixtureApi(info.url)("PUT", "/api/config", { vps: { sshAlias: "fixture-vps" } });
    setup.then(
      (seeded) => process.stdout.write(`${JSON.stringify({ ...info, ...(options.map ? seeded : {}), dockerCalls: vps.calls }, null, 2)}\n`, done),
      (error) => done(error instanceof Error ? error : new Error(String(error))),
    );
  } });
  try {
    await launchUi(options.map ? ["--mode", "hang"] : [], process.env, { stdout, stderr: process.stderr }, { localVm: vps.localVm });
  } finally { await vps.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const map = process.argv.includes("--map");
  await launchTeamComputersPreview({ map, frames: map || process.argv.includes("--frames") });
}
