// The named sidebar sections, in order. Older versions also kept each section's shared instructions and team memory
// keys here; those fields are still read and written back untouched so nothing on disk is lost.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export const SECTION_CONTEXTS_FILE = join(DATA_DIR, "section-contexts.json");

interface SectionFile {
  version: 1;
  sections: string[];
  /** Retired: kept as they were on disk. */
  contexts: Record<string, unknown>;
  memoryKeys: Record<string, unknown>;
}

const sectionFileSchema = z.object({
  version: z.literal(1),
  sections: z.array(z.string()).optional(),
  memoryKeys: z.record(z.string(), z.unknown()).optional(),
  contexts: z.record(z.string(), z.unknown()).optional(),
});

const emptyFile = (): SectionFile => ({ version: 1, sections: [], contexts: Object.create(null), memoryKeys: Object.create(null) });

function sectionName(section?: string | null): string {
  return section?.trim() || "";
}

/** Own entries only (labels like __proto__ are section names), copied into a prototype-free dictionary. */
function ownEntries(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, entry] of Object.entries(value ?? {})) out[key] = entry;
  return out;
}

function loadFile(forWrite = false): SectionFile {
  if (!existsSync(SECTION_CONTEXTS_FILE)) return emptyFile();
  try {
    const candidate = sectionFileSchema.safeParse(JSON.parse(readFileSync(SECTION_CONTEXTS_FILE, "utf8")));
    if (!candidate.success) throw new Error("Invalid sections file");
    const contexts = ownEntries(candidate.data.contexts);
    // a section that only ever had shared instructions still counts as a section
    const sections = [...new Set([...(candidate.data.sections ?? []), ...Object.keys(contexts)].map(sectionName).filter(Boolean))];
    return { version: 1, sections, contexts, memoryKeys: ownEntries(candidate.data.memoryKeys) };
  } catch {
    if (forWrite) throw new Error("Saved sections could not be read; the existing file was left unchanged");
    return emptyFile();
  }
}

function saveFile(data: SectionFile): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  writeFileAtomic(SECTION_CONTEXTS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function readSections(): string[] {
  return loadFile().sections;
}

export function ensureSections(names: (string | undefined)[]): boolean {
  const data = loadFile(true);
  const sections = [...new Set([...data.sections, ...names.map(sectionName).filter(Boolean)])];
  if (sections.length === data.sections.length) return false;
  saveFile({ ...data, sections });
  return true;
}

export function changeEmptySection(name: string, nextName: string | null): void {
  const data = loadFile(true);
  const index = data.sections.indexOf(name);
  if (index < 0) throw new Error("No such section");
  if (nextName !== null && nextName !== name && data.sections.includes(nextName)) {
    throw new Error("A section with that name already exists");
  }
  if (nextName === name) return;
  if (nextName === null) data.sections.splice(index, 1);
  else data.sections[index] = nextName;
  // retired per-section fields follow a rename and go with a deletion
  for (const field of [data.contexts, data.memoryKeys]) {
    const value = field[name];
    delete field[name];
    if (nextName !== null && value !== undefined) field[nextName] = value;
  }
  saveFile(data);
}
