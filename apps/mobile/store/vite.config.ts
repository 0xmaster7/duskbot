import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import base from "../vite.config.ts";

// a git worktree links node_modules into the main checkout, so vite has to be allowed to serve the fonts from there
const modules = realpathSync(fileURLToPath(new URL("../../../node_modules", import.meta.url)));
export default { ...base, server: { ...base.server, fs: { allow: [...(base.server?.fs?.allow ?? []), modules] } } };
