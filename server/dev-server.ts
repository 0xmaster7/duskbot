// `pnpm dev:server`: the harness from a source checkout, whose UI reaches it through Vite's dev proxy in a browser on
// this machine. OMB_DEV_TRUST_LOCAL_BROWSER=0 tries the sign-in a self-hosted server asks a browser for.
// `pnpm dev:app` runs this same file as the desktop app's own utility child, which alone is granted this computer.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DESKTOP_COMPUTER_GRANT, desktopComputer } from "./desktop-computer.ts";

process.env.OMB_DEV_TRUST_LOCAL_BROWSER ??= "1";
await import("./index.ts");

const announceGrant = () => console.log(`[dev] this computer granted by the desktop app (${desktopComputer.connection() ? "driver ready" : desktopComputer.unavailableReason() ?? "no driver"})`);
if (desktopComputer.granted()) announceGrant();
const parentPort = (process as NodeJS.Process & { parentPort?: { on(event: "message", listener: (event: { data?: { type?: unknown } }) => void): void } }).parentPort;
parentPort?.on("message", ({ data }) => {
  if (data?.type === DESKTOP_COMPUTER_GRANT) announceGrant();
});
// in a utility child execPath is Electron, which runs a script only as node
const nodeEnv = process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env;

// a fresh checkout starts with test bots to work with, once per workspace; OMB_NO_TEST_BOTS=1 skips it
if (process.env.OMB_NO_TEST_BOTS !== "1") {
  const url = `http://127.0.0.1:${Number(process.env.OMB_PORT || process.env.OGB_PORT || 8799)}`;
  const script = fileURLToPath(new URL("../scripts/demo/test-bots.mjs", import.meta.url));
  const seedOnce = async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const up = await fetch(`${url}/api/health`).then((response) => response.ok, () => false);
      if (up) {
        spawn(process.execPath, [script, "--first-run", "--url", url], { stdio: "inherit", env: nodeEnv }).on("error", () => {});
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  void seedOnce();
}
