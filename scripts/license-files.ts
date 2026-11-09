import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/** Emits LICENSE, docs/LICENSING.md and third_party/openmausbot/ into a build's licenses/ folder, so every shipped bundle carries its terms. */
export function licenseFiles(repoRoot: string): Plugin {
  return {
    name: "license-files",
    apply: "build",
    generateBundle() {
      const files: Array<[string, string]> = [["LICENSE", "LICENSE.txt"], [join("docs", "LICENSING.md"), "LICENSING.md"]];
      for (const name of readdirSync(join(repoRoot, "third_party", "openmausbot"))) files.push([join("third_party", "openmausbot", name), name]);
      for (const [from, to] of files) {
        this.emitFile({ type: "asset", fileName: `licenses/${to}`, source: readFileSync(join(repoRoot, from)) });
      }
    },
  };
}
