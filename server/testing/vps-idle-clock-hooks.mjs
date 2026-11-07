import { registerHooks } from "node:module";

const directory = process.env.OMB_DATA_DIR;
if (!directory || directory !== process.env.HOME || process.env.OMB_TEST_VPS_IDLE_CLOCK !== "1") {
  throw new Error("The VPS idle clock requires an explicitly isolated fixture");
}
const idle = new URL("../vps-idle.ts", import.meta.url).href;
const from = "const value = deps.idleMs();";
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== idle) return result;
    const source = String(result.source);
    if (source.split(from).length !== 2) throw new Error("VPS idle clock seam changed");
    return { ...result, source: source.replace(from, "const value = deps.idleMs() === 0 ? 0 : 750;") };
  },
});
