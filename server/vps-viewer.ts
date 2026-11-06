// The SSH half of a VPS computer's live desktop: one loopback port forwarded to its noVNC.
import { spawn } from "node:child_process";
import { createConnection, createServer, type AddressInfo } from "node:net";

import { DATA_DIR } from "./config.ts";
import { augmentedPath } from "./env-path.ts";
import type { ViewerLink } from "./vps-local.ts";
import { prepareVpsSsh } from "./vps-ssh.ts";

function unusedLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      // SAFETY: bound to an IPv4 TCP address above, so Node returns AddressInfo, not a socket path.
      const port = (probe.address() as AddressInfo).port;
      probe.close((error) => {
        if (error) reject(error);
        else if (port >= 1024) resolve(port);
        else reject(new Error("could not reserve a VPS viewer port"));
      });
    });
  });
}

function loopbackAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answer);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

/** An SSH -L forward to a remote VPS container's noVNC, ready once its loopback port answers. */
export async function sshViewer(args: (localPort: number, configPath: string | null) => string[], exited: (link: ViewerLink) => void): Promise<ViewerLink> {
  const localPort = await unusedLoopbackPort();
  const ssh = prepareVpsSsh(DATA_DIR, augmentedPath());
  const child = spawn("ssh", args(localPort, ssh.configPath), {
    shell: false,
    env: { ...process.env, PATH: ssh.path },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  const link: ViewerLink = {
    port: localPort,
    alive: () => child.exitCode === null && !child.killed,
    stop: () => { if (child.exitCode === null && !child.killed) child.kill("SIGTERM"); },
  };
  let failure: string | null = null;
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-1000);
  });
  child.once("error", (error) => {
    failure = error.message;
  });
  child.once("close", (code) => {
    exited(link);
    if (!failure) failure = stderr.trim() || `SSH viewer tunnel exited ${code ?? "without a status"}`;
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !failure) {
    if (await loopbackAnswers(localPort)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (failure || !(await loopbackAnswers(localPort))) {
    link.stop();
    const detail = failure || stderr.trim() || "the SSH port forward did not become ready";
    throw Object.assign(new Error(`Could not open the VPS live desktop: ${detail}`), { status: 502 });
  }
  return link;
}
