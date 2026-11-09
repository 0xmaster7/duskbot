// The saved servers' file (environments.json): read back with each local environment's folder checked, written whole
// through a temporary file so a crash never leaves half a list.
import environmentsModule from "./environments.cjs";

const { LOCAL_ID, parseEnvironments, serializeEnvironments } = environmentsModule;

function readableEnvironments(raw) {
  try {
    const version = JSON.parse(raw)?.version ?? 1;
    return version === 1 || version === 2;
  } catch {
    return false;
  }
}

/**
 * @param {{ file(): string, fs: typeof import("node:fs"), path: typeof import("node:path"), log?(line: string): void }} deps
 */
export function createEnvironmentsFile({ file, fs, path, log = () => {}, now = Date.now }) {
  let keptAside = null;
  // an unreadable list (damaged, or written by a newer version) reads as no saved servers, and the next save writes
  // over it: keep it beside itself first, once, so the person's servers can come back
  const keepAside = (raw) => {
    if (keptAside === raw) return;
    keptAside = raw;
    const aside = `${file()}.unreadable-${now()}`;
    try {
      fs.writeFileSync(aside, raw, { mode: 0o600, flag: "wx" });
      log(`environments: could not read the saved servers; kept them as ${aside}`);
    } catch (error) {
      log(`environments: could not keep the unreadable saved servers (${error?.message ?? error})`);
    }
  };
  return {
    read() {
      try {
        const raw = fs.readFileSync(file(), "utf8");
        if (!readableEnvironments(raw)) keepAside(raw);
        const state = parseEnvironments(raw);
        return {
          ...state,
          environments: state.environments.map((entry) =>
            entry.kind === "local" ? { ...entry, missing: !fs.existsSync(entry.dataDir) } : { ...entry, missing: false }),
        };
      } catch {
        return { environments: [], activeId: LOCAL_ID };
      }
    },
    write(state) {
      const target = file();
      const temporary = `${target}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(temporary, serializeEnvironments(state), { mode: 0o600 });
        fs.renameSync(temporary, target);
      } catch (error) {
        try { fs.rmSync(temporary, { force: true }); } catch {}
        log(`environments save failed: ${error?.message ?? error}`);
        throw new Error("Could not save server connections on this computer. Please try again.");
      }
    },
  };
}
