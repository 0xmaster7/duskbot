// Bundle the companion sidecar into one self-contained dist-companion/index.js: it imports electron/legacy-names.mjs
// from outside its own folder, which a plain tsc emit leaves as a path the packaged app (resources/companion) never has.
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../dist-companion/", import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("../apps/companion/src/index.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  legalComments: "eof",
  outfile: `${out}index.js`,
  logLevel: "info",
});
