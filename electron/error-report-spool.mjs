import { appendFileSync, readFileSync, rmSync } from "node:fs";

/** fatal error events in one file: appended synchronously while the process dies, taken and removed by the next run */
export function fileSpool(path) {
  return {
    append(line) { appendFileSync(path, `${line}\n`, { mode: 0o600 }); },
    take() {
      let text = "";
      try { text = readFileSync(path, "utf8"); } catch { return []; }
      rmSync(path, { force: true });
      return text.split("\n").filter(Boolean);
    },
  };
}
