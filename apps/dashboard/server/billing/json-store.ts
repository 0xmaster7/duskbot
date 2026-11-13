import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { stateBackend } from "../persistence/backend.ts";
import type { StateHandle } from "../persistence/backend.ts";

/** the store's name in a backend: its file name without .json (billing.json is "billing") */
export const storeName = (file: string) => basename(file).replace(/\.json$/, "");

// one json file per module, written atomically, unless a backend is set (persistence/backend.ts). commit() writes at once
// (money, webhooks, provisioning steps); changed() batches cosmetic writes for a second.
export function createJsonStore<T extends object>(file: string, initial: () => T, valid: (value: unknown) => value is T): StateHandle<T> {
  const backend = stateBackend();
  if (backend) return backend.open(storeName(file), initial, valid);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let state = initial();
  try {
    const loaded: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!valid(loaded)) throw new Error(`Invalid state in ${file}.`);
    state = loaded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  function commit() {
    if (timer) clearTimeout(timer);
    timer = null;
    writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  function changed() {
    if (timer) return;
    timer = setTimeout(commit, 1000);
    timer.unref();
  }
  return {
    state,
    commit,
    changed,
    changedRow: changed,
    close() { if (timer) commit(); },
  };
}
