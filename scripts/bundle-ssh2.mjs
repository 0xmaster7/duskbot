// Bundle ssh2 into one self-contained file Electron main can require: the packaged app ships no node_modules. Its two
// optional native pieces (cpu-features, the sshcrypto addon) stay out; ssh2 already falls back to Node's own crypto.
//   node scripts/bundle-ssh2.mjs [--from <dir containing node_modules/ssh2>]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { from: { type: "string" } } });
const require = createRequire(values.from ? join(values.from, "package.json") : import.meta.url);
const entryPoint = require.resolve("ssh2");
const outfile = join(root, "electron/vendor/ssh2.cjs");

await build({
  entryPoints: [entryPoint],
  absWorkingDir: entryPoint.split(`${sep}node_modules${sep}`)[0],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["cpu-features", "*.node"],
  legalComments: "eof",
  outfile,
  logLevel: "info",
});
