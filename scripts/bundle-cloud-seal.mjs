// Bundle what electron/cloud-seal.mjs needs from src/ and shared/ into one plain module Electron main can import:
// the packaged app ships no .ts and no node_modules. Runs in package:prepare; the output is not committed.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("../electron/seal/deps.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  legalComments: "eof",
  outfile: fileURLToPath(new URL("../electron/seal/deps.bundle.mjs", import.meta.url)),
  logLevel: "info",
});
