import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

export const teamComputerCreate = z.object({
  name: z.string().trim().min(1).max(60).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)),
  acknowledgeCost: z.literal(true),
  requestId: z.string().uuid(),
}).strict();
export const teamComputerAssignment = z.object({
  section: z.string().trim().max(60).nullable(),
  acknowledgeSharedAccess: z.literal(true),
}).strict();
const entrySchema = z.object({
  id: z.string().uuid(), name: teamComputerCreate.shape.name,
  section: z.string().trim().max(60).nullable(), createdAt: z.number().finite().nonnegative(),
  problem: z.string().max(500).optional(),
  scope: z.literal("workspace").optional(),
}).strict();
const fileSchema = z.object({ version: z.literal(1), environmentId: z.string().uuid(), computers: z.array(entrySchema).max(101) }).strict();
export type TeamComputerRecord = z.infer<typeof entrySchema>;
export function workspaceComputerId(environmentId: string): string {
  const bytes = createHash("sha1").update(`duskbot:workspace-computer:${environmentId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface BotPlacement {
  computer?: string; cloudBackend?: string; section?: string; vpsAlias?: string;
  createdBy?: string; reportsTo?: string; defaultBot?: { person?: string };
}

export const teamComputerOwner = (id: string): string => `computer_${id}`;
const failure = (message: string, status = 409) => Object.assign(new Error(message), { status });

/** Computer identities survive provisioning retries; invalid restored state is never reset. */
export class TeamComputers {
  private entries: TeamComputerRecord[] = [];
  private problem?: string;
  private readonly file: string;
  private readonly environmentId: string;
  constructor(file: string, environmentId: string) {
    this.file = file;
    this.environmentId = environmentId;
    try {
      if (!existsSync(file)) return;
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000) throw new Error("unsafe registry file");
      const saved = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      if (saved.environmentId !== environmentId) throw new Error("registry belongs to another workspace; its computers were not transferred");
      if (new Set(saved.computers.map(entry => entry.id)).size !== saved.computers.length) throw new Error("duplicate computer identity");
      const sections = saved.computers.flatMap(entry => entry.section === null ? [] : [entry.section]);
      if (new Set(sections).size !== sections.length) throw new Error("a team has more than one computer");
      const defaults = saved.computers.filter(entry => entry.scope === "workspace");
      if (defaults.length > 1 || defaults.some(entry => entry.id !== workspaceComputerId(environmentId) || entry.section !== null)) {
        throw new Error("invalid workspace computer identity");
      }
      if (saved.computers.filter(entry => entry.scope !== "workspace").length > 100) throw new Error("too many named computers");
      this.entries = saved.computers;
    } catch (error) {
      this.problem = `Team computer registry could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  list(): TeamComputerRecord[] {
    if (this.problem) throw failure(this.problem, 503);
    return this.entries.map(entry => ({ ...entry }));
  }
  get(id: string): TeamComputerRecord | undefined { return this.list().find(entry => entry.id === id); }
  forSection(section: string | undefined): TeamComputerRecord | undefined {
    return this.list().find(entry => entry.section !== null && entry.section === (section?.trim() || ""));
  }
  workspaceDefault(): TeamComputerRecord {
    const entries = this.list();
    const existing = entries.find(entry => entry.scope === "workspace");
    if (existing) return existing;
    const id = workspaceComputerId(this.environmentId);
    if (entries.some(entry => entry.id === id)) throw failure("The shared computer identity is already in use");
    const entry = entrySchema.parse({ id, name: "Shared computer", section: null, scope: "workspace", createdAt: Date.now() });
    this.save([...entries, entry]);
    return { ...entry };
  }
  forBot(bot: BotPlacement, options: { workspaceShared?: boolean } = {}): TeamComputerRecord | undefined {
    const placement = this.placement(bot);
    if (placement !== "workspace") return placement;
    return options.workspaceShared ? this.workspaceDefault() : undefined;
  }
  /** True when shared mode would move this bot off its own computer onto the workspace one; never creates the shared entry. */
  joinsWorkspaceComputer(bot: BotPlacement): boolean { return this.placement(bot) === "workspace"; }
  hasWorkspaceComputer(): boolean { return this.list().some(entry => entry.scope === "workspace"); }
  private placement(bot: BotPlacement): TeamComputerRecord | "workspace" | undefined {
    if (bot.computer !== undefined && bot.computer !== "cloud") return undefined;
    if (bot.computer === undefined) {
      const assigned = this.forSection(bot.section);
      if (assigned) return assigned;
    }
    if (bot.vpsAlias || bot.createdBy?.trim() || bot.reportsTo?.trim() || bot.defaultBot?.person?.trim()) return undefined;
    return "workspace";
  }
  create(name: string, id: string = randomUUID()): TeamComputerRecord {
    const entries = this.list();
    if (id === workspaceComputerId(this.environmentId)) throw failure("This identity is reserved for the shared computer");
    const existing = entries.find(entry => entry.id === id);
    if (existing) {
      if (existing.name !== name) throw failure("This creation id already names a different computer");
      return existing;
    }
    if (entries.filter(entry => entry.scope !== "workspace").length >= 100) throw failure("This workspace has reached its team computer limit");
    const entry = entrySchema.parse({ id, name, section: null, createdAt: Date.now() });
    this.save([...entries, entry]);
    return { ...entry };
  }
  assign(id: string, section: string | null): TeamComputerRecord {
    section = entrySchema.shape.section.parse(section);
    const entry = this.get(id);
    if (!entry) throw failure("No such team computer", 404);
    if (entry.scope === "workspace") throw failure("The shared workspace computer cannot be assigned to a section");
    if (entry.section !== null && section !== null && section !== entry.section) throw failure("Unassign this computer before moving it to another team");
    if (section !== null && this.list().some(other => other.id !== id && other.section === section)) throw failure("This team already has a computer; unassign it first");
    return this.patch(id, { section });
  }
  setProblem(id: string, problem?: string): TeamComputerRecord {
    return this.patch(id, { problem: problem?.slice(0, 500) });
  }
  renameSection(from: string, to: string): boolean {
    const entry = this.forSection(from);
    if (!entry || from === to) return false;
    if (this.forSection(to)) throw failure("This team already has a computer");
    this.patch(entry.id, { section: to });
    return true;
  }
  private patch(id: string, patch: Partial<TeamComputerRecord>): TeamComputerRecord {
    const entries = this.list();
    const entry = entries.find(candidate => candidate.id === id);
    if (!entry) throw failure("No such team computer", 404);
    const next = entrySchema.parse({ ...entry, ...patch });
    this.save(entries.map(candidate => candidate.id === id ? next : candidate));
    return { ...next };
  }
  private save(entries: TeamComputerRecord[]): void {
    writeFileAtomic(this.file, JSON.stringify({ version: 1, environmentId: this.environmentId, computers: entries }), { mode: 0o600 });
    this.entries = entries;
  }
}
