// First start with the fact store: every bot's memory files and About me are copied, untouched, into a backup folder,
// then read into the fact store. The files themselves are not rewritten, so nothing the person kept can be lost; the
// backup is for undoing anything later steps change. Runs once; a crash midway runs it again on the next start.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { aboutOwner, factStats, parseAboutFacts, parseFactFile, syncAboutFacts, syncWorkspaceFacts } from "./memory-facts.ts";
import { isMemoryTopicName, memoryDate, WORKSPACES_DIR } from "./workspace.ts";

export const MIGRATION_FILE = "memory-v2.json";
export const BACKUP_DIR = "memory-v1-backup";

export interface MigrationReport {
  at: number;
  backup: string;
  bots: number;
  files: number;
  /** Fact lines found in the files and About me, and rows the store holds for them: equal when nothing was missed. */
  lines: number;
  facts: number;
}

function copyTree(from: string, to: string, keep: (name: string) => boolean): number {
  let copied = 0;
  mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const stat = statSync(source);
    if (stat.isDirectory()) {
      if (name === "log") continue;
      copied += copyTree(source, join(to, name), keep);
    } else if (stat.isFile() && keep(name)) {
      copyFileSync(source, join(to, name));
      copied += 1;
    }
  }
  return copied;
}

/** `aboutMe`: the server's About me text, or null on a Team Cloud (each person's lives with them). */
export function migrateMemory(dataDir: string, input: { botIds: readonly string[]; aboutMe: string | null; now?: Date }): MigrationReport | null {
  const marker = join(dataDir, MIGRATION_FILE);
  if (existsSync(marker)) return null;
  const now = input.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backup = join(dataDir, BACKUP_DIR, stamp);
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  let files = 0;
  const workspaces = existsSync(WORKSPACES_DIR) ? readdirSync(WORKSPACES_DIR).filter((name) => statSync(join(WORKSPACES_DIR, name)).isDirectory()) : [];
  for (const id of workspaces) {
    const dir = join(WORKSPACES_DIR, id);
    const memory = existsSync(join(dir, "MEMORY.md")) ? 1 : 0;
    if (memory) {
      mkdirSync(join(backup, "workspaces", id), { recursive: true, mode: 0o700 });
      copyFileSync(join(dir, "MEMORY.md"), join(backup, "workspaces", id, "MEMORY.md"));
    }
    files += memory + (existsSync(join(dir, "memory")) ? copyTree(join(dir, "memory"), join(backup, "workspaces", id, "memory"), isMemoryTopicName) : 0);
  }
  for (const name of ["profile-learned.json", "general-memory-history.json"]) {
    if (existsSync(join(dataDir, name))) {
      copyFileSync(join(dataDir, name), join(backup, name));
      files += 1;
    }
  }
  if (input.aboutMe !== null) {
    writeFileAtomic(join(backup, "about-me.md"), input.aboutMe, { mode: 0o600 });
    files += 1;
  }
  const today = memoryDate(now);
  let lines = 0;
  const owners: string[] = [];
  for (const id of workspaces) {
    const dir = join(WORKSPACES_DIR, id);
    const read = (path: string) => {
      try {
        return readFileSync(join(dir, path), "utf8");
      } catch {
        return "";
      }
    };
    const topics = existsSync(join(dir, "memory")) ? readdirSync(join(dir, "memory")).filter(isMemoryTopicName) : [];
    const idents = new Set<string>();
    for (const path of ["MEMORY.md", ...topics.map((name) => `memory/${name}`)]) for (const fact of parseFactFile(path, read(path), today)) idents.add(`${path}\n${fact.ident}`);
    lines += idents.size;
    syncWorkspaceFacts(id, now);
    owners.push(id);
  }
  if (input.aboutMe !== null) {
    lines += new Set(parseAboutFacts(input.aboutMe).map((fact) => fact.ident)).size;
    syncAboutFacts(aboutOwner(), input.aboutMe, now);
    owners.push(aboutOwner());
  }
  const stats = factStats(owners);
  const facts = stats.active + stats.superseded + stats.expired + stats.merged;
  const report: MigrationReport = { at: now.getTime(), backup, bots: input.botIds.length, files, lines, facts };
  writeFileAtomic(marker, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}
