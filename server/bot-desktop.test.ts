import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BOT_DESKTOP_IMAGE, BOT_DESKTOP_LABEL, BOT_DESKTOP_MODE_LABEL, BOT_DESKTOP_NETWORK, BOT_DESKTOP_VERSION } from "../shared/bot-desktop.ts";
import {
  FREE_CAPABILITIES,
  botDesktopIsHardened,
  botDesktopMode,
  botDesktopMountsAreSafe,
  botDesktopNetworkCreateArgs,
  botDesktopNetworkIsPrivate,
  botDesktopRunArgs,
  botDesktopVolume,
  containerBotDesktopMode,
  containerDesktopKind,
  hostIsolation,
  parseHostAddresses,
  preferredVpsDesktop,
  provisionBotDesktop,
} from "./bot-desktop.ts";
import { CUA_DRIVER_VERSION, DRIVER_LABEL } from "./container-computer.ts";
import type { AppConfig } from "./config.ts";
import { vpsComputerAction, vpsComputerStatus, vpsContainerName, type VpsCommandRunner } from "./vps-computer.ts";

const NAME = "openmausbot-vps-bot1-0123456789ab";
const IMAGE_ID = `sha256:${"c".repeat(64)}`;
const SECRET = "viewer-secret-123";

const flag = (args: string[], name: string) => args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : []));

/** What `docker inspect` reports for a strict box made by botDesktopRunArgs. */
function inspected(name: string, overrides: Record<string, unknown> = {}) {
  return {
    ReadonlyRootfs: true,
    Runtime: "runc",
    CapDrop: ["ALL"],
    CapAdd: ["CAP_NET_ADMIN", "CAP_SETUID", "CAP_SETGID"],
    SecurityOpt: ["no-new-privileges"],
    Privileged: false,
    PidMode: "",
    IpcMode: "private",
    UTSMode: "",
    Devices: [],
    DeviceRequests: [],
    UsernsMode: "",
    CgroupnsMode: "private",
    AutoRemove: false,
    RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
    NetworkMode: BOT_DESKTOP_NETWORK,
    PortBindings: {},
    PublishAllPorts: false,
    Binds: null,
    VolumesFrom: null,
    ...overrides,
    _mounts: [{ Type: "volume", Name: botDesktopVolume(name), Destination: "/home/cua", Driver: "local" }],
  };
}

/** The same for a free box: writable root, sudo-capable, no NET_ADMIN, no no-new-privileges. */
const freeInspected = (overrides: Record<string, unknown> = {}) => inspected(NAME, {
  ReadonlyRootfs: false, SecurityOpt: null, CapAdd: FREE_CAPABILITIES.map((cap) => `CAP_${cap}`), Runtime: "runsc", ...overrides,
});

describe("bot desktop run flags", () => {
  const strict = botDesktopRunArgs({ containerName: NAME, imageRef: IMAGE_ID, viewerSecret: SECRET, labels: ["a=1"], mode: "strict", blockedHostAddresses: ["203.0.113.7", "x; rm"] });
  const free = botDesktopRunArgs({ containerName: NAME, imageRef: IMAGE_ID, viewerSecret: SECRET, labels: ["a=1"], mode: "free", runtime: "runsc", blockedHostAddresses: ["203.0.113.7"] });

  it("starts either box capability-dropped on its own network with one home volume and nothing published", () => {
    for (const args of [strict, free]) {
      expect(args.slice(0, 2)).toEqual(["run", "-d"]);
      expect(args.at(-1)).toBe(IMAGE_ID);
      expect(flag(args, "--network")).toEqual([BOT_DESKTOP_NETWORK]);
      expect(flag(args, "--dns")).toEqual(["1.1.1.1", "9.9.9.9"]);
      expect(flag(args, "--cap-drop")).toEqual(["ALL"]);
      expect(flag(args, "--mount")).toEqual([`type=volume,source=${NAME}-home,target=/home/cua`]);
      expect(args.some((arg) => ["-v", "--volume", "-p", "--publish", "-P", "--privileged", "--pid", "--userns", "--device"].includes(arg))).toBe(false);
      expect(args.some((arg) => arg.includes("docker.sock"))).toBe(false);
      expect(flag(args, "--label")).toEqual(expect.arrayContaining(["a=1", `${BOT_DESKTOP_LABEL}=${BOT_DESKTOP_VERSION}`, `${DRIVER_LABEL}=${CUA_DRIVER_VERSION}`]));
      expect(flag(args, "--pids-limit")).toHaveLength(1);
      expect(flag(args, "--memory")).toEqual(["4g"]);
      expect(flag(args, "--cpus")).toEqual(["2"]);
    }
  });

  it("strict: read-only root, its own firewall capability, no-new-privileges, the host's addresses fenced inside", () => {
    expect(strict).toContain("--read-only");
    expect(flag(strict, "--cap-add").sort()).toEqual(["NET_ADMIN", "SETGID", "SETUID"]);
    expect(flag(strict, "--security-opt")).toEqual(["no-new-privileges"]);
    expect(flag(strict, "-e")).toEqual(["OMB_MODE=strict", `VNC_PW=${SECRET}`, "OMB_BLOCK_EXTRA=203.0.113.7"]);
    expect(strict).not.toContain("--runtime");
  });

  it("free: writable root and sudo, but never a network, raw-socket or kernel capability", () => {
    expect(free).not.toContain("--read-only");
    expect(flag(free, "--security-opt")).toEqual([]);
    expect(flag(free, "--cap-add").sort()).toEqual([...FREE_CAPABILITIES].sort());
    for (const cap of ["NET_ADMIN", "NET_RAW", "SYS_ADMIN", "SYS_PTRACE", "SYS_MODULE", "MKNOD", "DAC_READ_SEARCH", "SETFCAP"]) {
      expect(flag(free, "--cap-add")).not.toContain(cap);
    }
    expect(flag(free, "-e")).toEqual(["OMB_MODE=free", `VNC_PW=${SECRET}`]);
    expect(flag(free, "--runtime")).toEqual(["runsc"]);
    expect(flag(free, "--label")).toContain(`${BOT_DESKTOP_MODE_LABEL}=free`);
  });

  it("names the bridge the host fence keys on", () => {
    expect(botDesktopNetworkCreateArgs()).toEqual(expect.arrayContaining(["com.docker.network.bridge.name=omb-desk0", "com.docker.network.bridge.enable_icc=false"]));
  });
});

describe("bot desktop isolation checks", () => {
  it("accepts exactly what the run flags produce", () => {
    expect(botDesktopIsHardened(inspected(NAME), "strict")).toBe(true);
    expect(botDesktopIsHardened(inspected(NAME, { Runtime: "runsc" }), "strict")).toBe(true);
    expect(botDesktopIsHardened(freeInspected(), "free")).toBe(true);
    expect(botDesktopIsHardened(freeInspected({ Runtime: "runc" }), "free")).toBe(true);
  });

  it.each([
    ["a writable root", { ReadonlyRootfs: false }],
    ["no no-new-privileges", { SecurityOpt: [] }],
    ["an extra capability", { CapAdd: ["CAP_NET_ADMIN", "CAP_SETUID", "CAP_SETGID", "CAP_SYS_ADMIN"] }],
    ["no firewall capability", { CapAdd: ["CAP_SETUID", "CAP_SETGID"] }],
    ["privileged", { Privileged: true }],
    ["host pid", { PidMode: "host" }],
    ["unconfined seccomp", { SecurityOpt: ["no-new-privileges", "seccomp=unconfined"] }],
    ["an unknown runtime", { Runtime: "kata" }],
  ])("refuses a strict box with %s", (_label, overrides) => {
    expect(botDesktopIsHardened(inspected(NAME, overrides), "strict")).toBe(false);
  });

  it.each([
    ["NET_ADMIN", { CapAdd: [...FREE_CAPABILITIES, "NET_ADMIN"] }],
    ["NET_RAW", { CapAdd: [...FREE_CAPABILITIES, "NET_RAW"] }],
    ["privileged", { Privileged: true }],
    ["host networking namespaces", { PidMode: "host" }],
    ["the host user namespace", { UsernsMode: "host" }],
    ["unconfined seccomp", { SecurityOpt: ["seccomp=unconfined"] }],
    ["a device", { Devices: [{ PathOnHost: "/dev/kvm" }] }],
  ])("refuses a free box with %s", (_label, overrides) => {
    expect(botDesktopIsHardened(freeInspected(overrides), "free")).toBe(false);
  });

  it("judges a box only as the mode its label and environment agree on", () => {
    expect(containerBotDesktopMode({ [BOT_DESKTOP_MODE_LABEL]: "free" }, ["OMB_MODE=free"])).toBe("free");
    expect(containerBotDesktopMode({ [BOT_DESKTOP_MODE_LABEL]: "strict" }, ["VNC_PW=x"])).toBe("strict");
    expect(containerBotDesktopMode({ [BOT_DESKTOP_MODE_LABEL]: "free" }, ["OMB_MODE=strict"])).toBeUndefined();
    expect(containerBotDesktopMode({}, [])).toBeUndefined();
    expect(botDesktopIsHardened(freeInspected(), undefined)).toBe(false);
    expect(botDesktopIsHardened(freeInspected(), "strict")).toBe(false);
  });

  it("allows only its own home volume and its own network", () => {
    const mounts = [{ Type: "volume", Name: `${NAME}-home`, Destination: "/home/cua", Driver: "local" }];
    expect(botDesktopMountsAreSafe(NAME, { Mounts: mounts, HostConfig: { Binds: null } })).toBe(true);
    expect(botDesktopMountsAreSafe(NAME, { Mounts: [{ ...mounts[0], Name: "other-home" }] })).toBe(false);
    expect(botDesktopMountsAreSafe(NAME, { Mounts: [...mounts, { Type: "bind", Destination: "/x" }] })).toBe(false);
    expect(botDesktopMountsAreSafe(NAME, { Mounts: mounts, HostConfig: { Binds: ["/:/host"] } })).toBe(false);
    expect(botDesktopMountsAreSafe(NAME, { Mounts: [] })).toBe(false);
    const networks = { [BOT_DESKTOP_NETWORK]: {} };
    expect(botDesktopNetworkIsPrivate({ NetworkMode: BOT_DESKTOP_NETWORK }, networks)).toBe(true);
    expect(botDesktopNetworkIsPrivate({ NetworkMode: "bridge" }, { bridge: {} })).toBe(false);
    expect(botDesktopNetworkIsPrivate({ NetworkMode: BOT_DESKTOP_NETWORK }, { ...networks, bridge: {} })).toBe(false);
    expect(botDesktopNetworkIsPrivate({ NetworkMode: BOT_DESKTOP_NETWORK, PortBindings: { "6901/tcp": [{}] } }, networks)).toBe(false);
  });

  it("frees a box only behind the host fence and gVisor or user-namespace remapping", () => {
    const gvisor = hostIsolation('{"Runtimes":{"runc":{},"runsc":{"path":"runsc"}},"SecurityOptions":["name=seccomp,profile=builtin"]}', {});
    const remapped = hostIsolation('{"Runtimes":{"runc":{}},"SecurityOptions":["name=seccomp,profile=builtin","name=userns"]}', {});
    const plain = hostIsolation('{"Runtimes":{"runc":{}},"SecurityOptions":["name=seccomp,profile=builtin"]}', {});
    expect(gvisor).toEqual({ runtime: "runsc", userns: false });
    expect(remapped).toEqual({ runtime: null, userns: true });
    expect(hostIsolation('{"Runtimes":{"runsc":{}}}', { OPENMAUSBOT_VPS_GVISOR: "off" }).runtime).toBeNull();
    expect(hostIsolation("not json", {})).toEqual({ runtime: null, userns: false });
    expect(botDesktopMode(true, gvisor, {})).toBe("free");
    expect(botDesktopMode(true, remapped, {})).toBe("free");
    expect(botDesktopMode(true, plain, {})).toBe("strict");
    expect(botDesktopMode(false, gvisor, {})).toBe("strict");
    expect(botDesktopMode(true, gvisor, { OPENMAUSBOT_VPS_BOX: "strict" })).toBe("strict");
  });

  it("reads host addresses and the desktop kind defensively", () => {
    expect(parseHostAddresses("2: eth0    inet 203.0.113.7/24 brd x scope global eth0\n2: eth0    inet6 2001:db8::7/64 scope global\nnoise")).toEqual(["203.0.113.7", "2001:db8::7"]);
    expect(preferredVpsDesktop({})).toBe("bot-desktop");
    expect(preferredVpsDesktop({ OPENMAUSBOT_VPS_DESKTOP: "cua" })).toBe("cua");
    expect(containerDesktopKind({ [BOT_DESKTOP_LABEL]: "1" })).toBe("bot-desktop");
    expect(containerDesktopKind({})).toBe("cua");
  });

  it("keeps build.sh's fallback tag and host-fence.sh's bridge in step with the constants", () => {
    const script = readFileSync(new URL("../deploy/bot-desktop/build.sh", import.meta.url), "utf8");
    expect(script).toContain(`image="\${image:-ghcr.io/sidddevz/omb-bot-desktop:v$version}"`);
    expect(BOT_DESKTOP_IMAGE).toBe(`ghcr.io/sidddevz/omb-bot-desktop:v${BOT_DESKTOP_VERSION}`);
    expect(readFileSync(new URL("../deploy/bot-desktop/host-fence.sh", import.meta.url), "utf8")).toContain("BRIDGE=omb-desk0\n");
  });
});

describe("bot desktop provisioning", () => {
  function host({ pull = true, network = false, runsc = false, fenced = false } = {}) {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "pull") { if (!pull) throw new Error("denied"); return { stdout: "" }; }
      if (args[0] === "image") return { stdout: JSON.stringify([{ Id: IMAGE_ID, Config: { Labels: { [BOT_DESKTOP_LABEL]: BOT_DESKTOP_VERSION, [DRIVER_LABEL]: CUA_DRIVER_VERSION } } }]) };
      if (args[0] === "network" && args[1] === "inspect") {
        if (!network) throw new Error(`Error: No such network: ${BOT_DESKTOP_NETWORK}`);
        return { stdout: JSON.stringify({ Labels: { "com.openmausbot.vps-network": "1" }, Options: { "com.docker.network.bridge.name": "omb-desk0" } }) };
      }
      if (args[0] === "info") return { stdout: JSON.stringify({ Runtimes: runsc ? { runc: {}, runsc: {} } : { runc: {} }, SecurityOptions: [] }) };
      if (args.includes("/usr/local/bin/omb-host-fence")) { if (!fenced) throw new Error("exit status 1"); return { stdout: "" }; }
      if (args.includes("--entrypoint")) return { stdout: "2: eth0 inet 198.51.100.4/24 scope global eth0\n" };
      return { stdout: "" };
    };
    return { calls, run };
  }
  const input = { containerName: NAME, imageId: null, labels: [], viewerSecret: SECRET };
  const steps = (calls: string[][]) => calls.map((args) => (args.includes("--entrypoint") ? `probe ${args[args.indexOf("--entrypoint") + 1]}` : args.slice(0, 2).join(" ")));

  it("without the host fence: pulls, makes the network, and starts a strict box that fences the host's addresses itself", async () => {
    const fake = host({ runsc: true });
    expect(await provisionBotDesktop(fake.run, input)).toBe("strict");
    expect(steps(fake.calls)).toEqual(["pull ghcr.io/sidddevz/omb-bot-desktop:v1", "image inspect", "network inspect", "network create", "info --format", "probe /usr/local/bin/omb-host-fence", "probe ip", "run -d"]);
    const started = fake.calls.at(-1)!;
    expect(started.at(-1)).toBe(IMAGE_ID);
    expect(started).toEqual(expect.arrayContaining(["--read-only", "--runtime", "runsc", "OMB_MODE=strict", "OMB_BLOCK_EXTRA=198.51.100.4"]));
  });

  it("behind the host fence with gVisor: a free box, no address probe needed", async () => {
    const fake = host({ runsc: true, network: true, fenced: true });
    expect(await provisionBotDesktop(fake.run, input)).toBe("free");
    expect(steps(fake.calls)).toEqual(["pull ghcr.io/sidddevz/omb-bot-desktop:v1", "image inspect", "network inspect", "info --format", "probe /usr/local/bin/omb-host-fence", "run -d"]);
    expect(fake.calls.at(-1)).toEqual(expect.arrayContaining(["--runtime", "runsc", "OMB_MODE=free"]));
    expect(fake.calls.at(-1)).not.toContain("--read-only");
  });

  it("behind the fence but on plain runc: still strict", async () => {
    expect(await provisionBotDesktop(host({ network: true, fenced: true }).run, input)).toBe("strict");
  });

  it("tells the caller to fall back when the image cannot be pulled, before touching anything else", async () => {
    const fake = host({ pull: false, network: true });
    expect(await provisionBotDesktop(fake.run, input)).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it("shares preparation for concurrent bots on one host, then rechecks the fence on the next start", async () => {
    const fake = host({ runsc: true, network: true, fenced: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = async (args: string[]) => {
      if (args[0] === "pull") await gate;
      return fake.run(args);
    };
    const first = provisionBotDesktop(run, { ...input, hostKey: "shared-vps" });
    const second = provisionBotDesktop(run, { ...input, containerName: `${NAME}-other`, hostKey: "shared-vps" });
    release();
    expect(await Promise.all([first, second])).toEqual(["free", "free"]);
    expect(fake.calls.filter((args) => args[0] === "pull")).toHaveLength(1);
    expect(fake.calls.filter((args) => args[0] === "network")).toHaveLength(1);
    expect(fake.calls.filter((args) => args[0] === "info")).toHaveLength(1);
    expect(fake.calls.filter((args) => args.includes("/usr/local/bin/omb-host-fence"))).toHaveLength(1);
    const starts = fake.calls.filter((args) => args[0] === "run" && args[1] === "-d");
    expect(starts).toHaveLength(2);
    expect(starts.map((args) => flag(args, "--name")[0])).toEqual([NAME, `${NAME}-other`]);

    const unfenced = host({ runsc: true, network: true, fenced: false });
    expect(await provisionBotDesktop(unfenced.run, { ...input, imageId: IMAGE_ID, hostKey: "shared-vps" })).toBe("strict");
    expect(unfenced.calls.some((args) => args.includes("/usr/local/bin/omb-host-fence"))).toBe(true);
  });

  it("keeps preparation separate across hosts and lets a failed pull retry", async () => {
    const unavailable = host({ pull: false });
    const available = host({ runsc: true, network: true, fenced: true });
    expect(await Promise.all([
      provisionBotDesktop(unavailable.run, { ...input, hostKey: "offline-vps" }),
      provisionBotDesktop(available.run, { ...input, hostKey: "online-vps" }),
    ])).toEqual([false, "free"]);
    expect(await provisionBotDesktop(available.run, { ...input, hostKey: "offline-vps" })).toBe("free");
    expect(available.calls.filter((args) => args[0] === "pull")).toHaveLength(2);
  });
});


describe("bot desktop on the VPS path", () => {
  beforeEach(() => { vi.stubEnv("OPENMAUSBOT_VPS_DESKTOP", ""); });
  const CONFIG: AppConfig = { vps: { sshAlias: "production-vps" } };
  const BOT = "bot-desktop-1";
  const name = vpsContainerName(BOT);

  function daemon() {
    const state = { image: false, container: false, running: false, secret: "" };
    const calls: string[][] = [];
    const runner: VpsCommandRunner = async (args) => {
      const docker = args.slice(2);
      calls.push(docker);
      const [command] = docker;
      if (command === "pull") { state.image = true; return { stdout: "", stderr: "" }; }
      if (command === "image") {
        if (!state.image) throw new Error(`Error: No such image: ${docker[2]}`);
        return { stdout: JSON.stringify([{ Id: IMAGE_ID, Config: { Labels: { [BOT_DESKTOP_LABEL]: BOT_DESKTOP_VERSION, [DRIVER_LABEL]: CUA_DRIVER_VERSION } } }]), stderr: "" };
      }
      if (command === "network") {
        if (docker[1] === "inspect") throw new Error("Error: No such network");
        return { stdout: "", stderr: "" };
      }
      if (command === "info") return { stdout: '{"runc":{}}', stderr: "" };
      if (command === "run" && docker[1] === "--rm") return { stdout: "", stderr: "" };
      if (command === "run") {
        state.container = true;
        state.running = true;
        state.secret = docker.find((arg) => arg.startsWith("VNC_PW="))!.slice(7);
        const labels = Object.fromEntries(flag(docker, "--label").map((label) => label!.split("=") as [string, string]));
        Object.assign(state, { labels });
        return { stdout: `${name}\n`, stderr: "" };
      }
      if (command === "inspect") {
        if (!state.container) throw new Error(`Error: No such object: ${name}`);
        const { _mounts, ...hostConfig } = inspected(name);
        return {
          stdout: JSON.stringify([{
            Id: "d".repeat(64),
            Image: IMAGE_ID,
            Config: { Image: IMAGE_ID, Env: [`VNC_PW=${state.secret}`], Labels: (state as unknown as { labels: Record<string, string> }).labels },
            HostConfig: hostConfig,
            NetworkSettings: { Networks: { [BOT_DESKTOP_NETWORK]: { IPAddress: "172.30.0.2" } } },
            Mounts: _mounts,
            State: { Running: state.running },
          }]),
          stderr: "",
        };
      }
      if (command === "exec") {
        if (docker.at(-1) === "--version") return { stdout: `cua-driver ${CUA_DRIVER_VERSION}\n`, stderr: "" };
        if (docker.includes("omb-desktop-probe") || docker.includes("health_report")) return { stdout: JSON.stringify({ schema_version: "1", overall: "ok", checks: [] }), stderr: "" };
        return { stdout: "{}\n", stderr: "" };
      }
      throw new Error(`unexpected docker ${command}`);
    };
    return { calls, runner, state };
  }

  it("provisions the bot desktop by default and then reports it ready through the same Cua Driver probes", async () => {
    const fake = daemon();
    const before = await vpsComputerStatus(CONFIG, BOT, fake.runner);
    expect(before).toMatchObject({ desktop: "bot-desktop", image: false, container: "missing", image_ref: BOT_DESKTOP_IMAGE });
    const status = await vpsComputerAction("provision", CONFIG, BOT, fake.runner);
    expect(status).toMatchObject({ desktop: "bot-desktop", ready: true, network: "private", mounts: "none", security: "hardened", problem: null });
    expect(fake.calls.some((args) => args[0] === "build")).toBe(false);
    expect(fake.calls.find((args) => args[0] === "run" && args[1] === "-d")).toEqual(expect.arrayContaining(["--read-only", "--network", BOT_DESKTOP_NETWORK]));
  });

  it("falls back to building the Cua desktop when the bot desktop image cannot be pulled", async () => {
    const fake = daemon();
    const runner: VpsCommandRunner = async (args, options) => {
      if (args[2] === "pull" && args[3] === BOT_DESKTOP_IMAGE) throw new Error("manifest unknown");
      if (args[2] === "pull" || args[2] === "build") return { stdout: "", stderr: "" };
      return fake.runner(args, options);
    };
    // the Cua image never appears in this fake, so the fallback stops at identifying it: enough to prove the route
    await expect(vpsComputerAction("provision", CONFIG, BOT, runner)).rejects.toThrow(/could not be identified/);
  });
});
