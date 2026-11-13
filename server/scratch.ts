// Security invariant: only files inside a scratch root the app itself owns are ever deleted here. Roots are an
// allowlist, symlinks are never followed (a link is removed as a link), and a root that is itself a link is skipped.
import { lstatSync, readdirSync, rmdirSync, statfsSync, unlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export const SCRATCH_MAX_AGE_MS = 24 * 60 * 60_000;
/** Above this share of the disk in use, the oldest scratch goes first. */
export const DISK_GUARD_PERCENT = 80;
const WALK_MAX_DEPTH = 8;
const WALK_MAX_ENTRIES = 50_000;

export interface ScratchFile { path: string; mtimeMs: number }
export type DiskUsage = () => number | null;

export function within(root: string, path: string): boolean {
  const base = resolve(root);
  const target = resolve(path);
  return target !== base && target.startsWith(base + sep);
}

function realDirectory(path: string): boolean {
  try { return lstatSync(path).isDirectory(); } catch { return false; }
}

function removeFile(path: string): boolean {
  try {
    if (lstatSync(path).isDirectory()) return false;
    unlinkSync(path);
    return true;
  } catch { return false; }
}

/** Files and links under each root, never through a link, oldest first. */
export function listScratch(roots: readonly string[]): ScratchFile[] {
  const files: ScratchFile[] = [];
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++seen > WALK_MAX_ENTRIES) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < WALK_MAX_DEPTH) walk(path, depth + 1); continue; }
      try { files.push({ path, mtimeMs: lstatSync(path).mtimeMs }); } catch {}
    }
  };
  for (const root of roots) if (realDirectory(root)) walk(root, 0);
  return files.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function pruneEmptyDirs(dir: string, depth = 0): void {
  if (depth > WALK_MAX_DEPTH) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    pruneEmptyDirs(path, depth + 1);
    try { rmdirSync(path); } catch {}
  }
}

/** Deletes scratch older than `maxAgeMs`; the roots themselves stay. */
export function sweepScratch(roots: readonly string[], { now = Date.now(), maxAgeMs = SCRATCH_MAX_AGE_MS } = {}): number {
  let removed = 0;
  for (const file of listScratch(roots)) {
    if (now - file.mtimeMs < maxAgeMs) break;
    if (removeFile(file.path)) removed += 1;
  }
  for (const root of roots) if (realDirectory(root)) pruneEmptyDirs(root);
  return removed;
}

/** Over the limit, deletes the oldest scratch until the disk is under it, never what a running turn still holds; `full`
 * when that was not enough. */
export function guardDisk(
  roots: readonly string[],
  usedPercent: DiskUsage,
  { limit = DISK_GUARD_PERCENT, keep = () => false }: { limit?: number; keep?: (path: string) => boolean } = {},
): { removed: number; full: boolean } {
  let used = usedPercent();
  if (used === null || used <= limit) return { removed: 0, full: false };
  let removed = 0;
  for (const file of listScratch(roots)) {
    if (keep(file.path)) continue;
    if (removeFile(file.path)) removed += 1;
    used = usedPercent();
    if (used === null || used <= limit) return { removed, full: false };
  }
  return { removed, full: true };
}

export function diskUsedPercent(path: string): DiskUsage {
  return () => {
    try {
      const fs = statfsSync(path);
      const used = fs.blocks - fs.bfree;
      const total = used + fs.bavail;
      return total > 0 ? Math.ceil((used / total) * 100) : null;
    } catch { return null; }
  };
}

/** Scratch files a holder (a browser session a turn holds) made, deleted together once it lets go. */
export class ScratchLedger {
  readonly #roots: readonly string[];
  readonly #held = new Map<string, Set<string>>();

  constructor(roots: readonly string[]) { this.#roots = roots; }

  /** Only a path inside a scratch root is ever tracked. */
  mark(holder: string, path: string): boolean {
    if (!this.#roots.some((root) => within(root, path))) return false;
    let paths = this.#held.get(holder);
    if (!paths) this.#held.set(holder, paths = new Set());
    paths.add(resolve(path));
    return true;
  }

  release(holder: string): number {
    const paths = this.#held.get(holder);
    if (!paths) return 0;
    this.#held.delete(holder);
    let removed = 0;
    for (const path of paths) if (removeFile(path)) removed += 1;
    return removed;
  }

  held(holder: string): string[] { return [...this.#held.get(holder) ?? []]; }

  inUse(path: string): boolean {
    const target = resolve(path);
    for (const paths of this.#held.values()) if (paths.has(target)) return true;
    return false;
  }
}
