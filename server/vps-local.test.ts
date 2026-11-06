import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { vpsSshAlias } from "./config.ts";
import { spawn } from "node:child_process";

import { vpsDockerArgs } from "./vps-computer.ts";
import { THIS_SERVER_VPS, boxChromeExecArgs, boxChromeRelay, detectThisServerVps, forwardViewer } from "./vps-local.ts";

afterEach(() => { vi.unstubAllEnvs(); });

describe("a server on its own linked VPS", () => {
  it("knows it is one from the link agent's tunnel file, on Linux only, and the env can say either way", () => {
    const home = mkdtempSync(join(tmpdir(), "omb-vps-local-"));
    try {
      expect(detectThisServerVps({}, "linux", home)).toBe(false);
      mkdirSync(join(home, ".config", "openmausbot-link"), { recursive: true });
      writeFileSync(join(home, ".config", "openmausbot-link", "tunnel.json"), "{}");
      expect(detectThisServerVps({}, "linux", home)).toBe(true);
      expect(detectThisServerVps({}, "darwin", home)).toBe(false);
      expect(detectThisServerVps({ OPENMAUSBOT_VPS_DOCKER: "ssh" }, "linux", home)).toBe(false);
      expect(detectThisServerVps({ OPENMAUSBOT_VPS_DOCKER: "local" }, "darwin", home)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("drives its own Docker with no SSH, while a saved alias still goes over SSH", () => {
    vi.stubEnv("OPENMAUSBOT_VPS_DOCKER", "local");
    expect(vpsSshAlias({})).toBe(THIS_SERVER_VPS);
    expect(vpsSshAlias({ vps: { sshAlias: "production-vps" } })).toBe("production-vps");
    expect(vpsDockerArgs(THIS_SERVER_VPS, ["ps"])).toEqual(["ps"]);
    expect(vpsDockerArgs("production-vps", ["ps"])).toEqual(["-H", "ssh://production-vps", "ps"]);
    vi.stubEnv("OPENMAUSBOT_VPS_DOCKER", "ssh");
    expect(vpsSshAlias({})).toBeNull();
  });

  it("pipes one loopback port to a container's private address, and stops every socket when closed", async () => {
    await expect(forwardViewer("127.0.0.1")).rejects.toThrow(/private container address/);
    await expect(forwardViewer("8.8.8.8")).rejects.toThrow(/private container address/);
    const echo = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
    const echoPort = (echo.address() as AddressInfo).port;
    const link = await forwardViewer("172.18.0.2", () => createConnection({ host: "127.0.0.1", port: echoPort }));
    const client = createConnection({ host: "127.0.0.1", port: link.port });
    const got = await new Promise<string>((resolve) => { client.once("data", (data) => resolve(data.toString())); client.write("RFB 003.008\n"); });
    expect(got).toBe("RFB 003.008\n");
    expect(link.alive()).toBe(true);
    const closed = new Promise((resolve) => client.once("close", resolve));
    link.stop();
    await closed;
    expect(link.alive()).toBe(false);
    await new Promise((resolve) => echo.close(resolve));
  });

  it("reaches the box's own Chromium through docker exec as the desktop user, never a published port", async () => {
    const id = "a".repeat(64);
    const args = boxChromeExecArgs(id);
    expect(args.slice(0, 6)).toEqual(["exec", "-i", "-u", "1000:1000", id, "python3"]);
    expect(args.at(-1)).toContain("9222");
    expect(() => boxChromeExecArgs("bad name; echo hi")).toThrow(/invalid/);
    // each connection is its own exec: here `cat` stands in, so the bytes come straight back
    const relay = await boxChromeRelay(() => spawn("cat", [], { stdio: ["pipe", "pipe", "ignore"] }));
    expect(relay.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const client = createConnection({ host: "127.0.0.1", port: Number(new URL(relay.url).port) });
    const got = await new Promise<string>((resolve) => { client.once("data", (data) => resolve(data.toString())); client.write("GET /json/version HTTP/1.1\r\n\r\n"); });
    expect(got).toBe("GET /json/version HTTP/1.1\r\n\r\n");
    const closed = new Promise((resolve) => client.once("close", resolve));
    relay.close();
    await closed;
  });
});
