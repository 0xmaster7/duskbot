import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// one json file per module, written atomically. commit() writes at once (money, webhooks, provisioning steps);
// changed() batches cosmetic writes for a second.
export function createJsonStore<T extends object>(file: string, initial: () => T, valid: (value: unknown) => value is T) {
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
  return {
    state,
    commit,
    changed() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, 1000);
      timer.unref();
    },
    close() { if (timer) commit(); },
  };
}
