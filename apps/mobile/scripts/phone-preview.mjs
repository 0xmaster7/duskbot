import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const vitePath = fileURLToPath(new URL("../../../node_modules/.bin/vite", import.meta.url));
const children = new Set();
let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    stop(signal);
  });
}
process.once("exit", () => {
  for (const child of children) child.kill("SIGTERM");
});

function start(command, args, env) {
  const child = spawn(command, args, { cwd: repoRoot, env, stdio: ["inherit", "pipe", "pipe"] });
  children.add(child);
  child.stderr.pipe(process.stderr);
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.once("close", (code) => {
    children.delete(child);
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
  return child;
}

function portFromUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("workspace URL must use http or https");
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

async function fixturePort() {
  const child = start(process.execPath, ["--experimental-strip-types", "scripts/control-omb.ts", "launch"], process.env);
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => onError(new Error("fixture did not print its URL within 90 seconds")), 90_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.removeListener("data", onData);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => onError(new Error("fixture exited before printing its URL"));
    const onData = (chunk) => {
      output += chunk.toString();
      let info;
      try { info = JSON.parse(output); } catch { return; }
      if (typeof info.url !== "string") return;
      try {
        const port = portFromUrl(info.url);
        cleanup();
        resolve(port);
      } catch (error) { onError(error); }
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

try {
  const args = process.argv.slice(2);
  let fixture = false;
  let workspaceUrl;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--fixture") fixture = true;
    else if (args[index] === "--url" && args[index + 1]) workspaceUrl = args[++index];
    else throw new Error(`unknown or incomplete argument: ${args[index]}`);
  }
  if (fixture && workspaceUrl) throw new Error("choose either --fixture or --url");
  const port = fixture ? await fixturePort() : workspaceUrl ? portFromUrl(workspaceUrl) : process.env.OMB_PORT || "8799";
  if (!stopping) {
    const vite = start(vitePath, ["--config", "apps/mobile/vite.config.ts"], { ...process.env, OMB_PORT: port });
    let output = "";
    let ready = false;
    vite.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk.toString();
      if (!ready && output.includes("ready in")) {
        ready = true;
        console.log(`phone preview: http://127.0.0.1:${Number(process.env.OMB_MOBILE_PORT) || 5320}/phone.html`);
      }
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  stop();
}
