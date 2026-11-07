import { vpsContainerStartedAt } from "./vps-container-start.ts";
import { ensureVpsScreenBrowser } from "./vps-browser-ready.ts";
import { independentScreenExecArgs, isManagedScreenViewerPort, type IndependentScreenTarget } from "./shared-desktop-screens.ts";
import { boxChromes, desktopTunnels, evictVpsBoxChrome, NATIVE_VIEWER_LIFETIME_MS, REMOTE_VIEWER_GRACE_MS, requireLiveScreen, screenKey, stopDesktopTunnel, type VpsScreenConnection } from "./vps-connections.ts";
export { closeVpsScreenConnections, closeVpsDesktopTunnel, closeAllVpsDesktopTunnels, vpsDesktopConnection, type VpsScreenConnection } from "./vps-connections.ts";
// BYO Linux VPS: Docker's SSH transport reaches the user's daemon; one Cua Driver desktop container per bot.
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

import {
  BASE_IMAGE,
  CUA_DRIVER_VERSION,
  CUA_EXECUTABLE,
  CUA_SOCKET,
  IMAGE as CUA_IMAGE,
  cuaExecArgs,
  dockerSecurityIsHardened,
  imageLabelsMatch,
  managedImageDockerfile,
  wholeScreenshot,
  type DockerHardeningConfig,
  BASE_IMAGE_DIGEST,
  BASE_IMAGE_LABEL,
  DRIVER_LABEL,
  IMAGE_LAYER_LABEL,
  IMAGE_LAYER_VERSION,
  MANAGED_LABEL,
} from "./container-computer.ts";
import { PIDS_LIMIT, raisePidsLimit } from "./container-limits.ts";
import {
  BOT_DESKTOP_IMAGE, BOT_DESKTOP_LABEL, BOT_DESKTOP_VERSION, botDesktopIsHardened, botDesktopLabelsMatch, botDesktopMountsAreSafe, botDesktopNetworkIsPrivate,
  containerBotDesktopMode, containerDesktopKind, preferredVpsDesktop, provisionBotDesktop, type BotDesktopProgress, type VpsDesktopKind,
} from "./bot-desktop.ts";
import { DATA_DIR, isValidSshAlias, vpsSshAlias, type AppConfig } from "./config.ts";
import { augmentedPath } from "./env-path.ts";
import { killCliTree, spawnCli } from "./procs.ts";
import { prepareVpsSsh } from "./vps-ssh.ts";
import { boxChromeExecArgs, boxChromeRelay, forwardViewer, isThisServerVps } from "./vps-local.ts";
import { sshViewer } from "./vps-viewer.ts";
import { loadEnvironmentId } from "./environment.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

export const VPS_IMAGE = CUA_IMAGE;
export const VPS_MANAGED_LABEL = "com.openmausbot.vps";
export const VPS_CONTAINER_LABEL = "com.openmausbot.container";
export const VPS_ENVIRONMENT_LABEL = "com.openmausbot.environment";
export const VPS_VIEWER_LABEL = "com.openmausbot.vps-viewer";
export const VPS_CONTAINER_PREFIX = "openmausbot-vps";
// Lazy: index must finish data migration and take the writer lease before this may create the data directory.
let vpsEnvironmentIdCache: string | null = null;
function vpsEnvironmentId(): string {
  if (!vpsEnvironmentIdCache) vpsEnvironmentIdCache = loadEnvironmentId(DATA_DIR);
  return vpsEnvironmentIdCache;
}
// ssh + docker need this long to tear down a remote exec over a WAN; an orphaned exec keeps the driver socket busy.
const COMMAND_TIMEOUT_TERM_GRACE_MS = 5_000;
// killCliTree also waits up to one second for the forced group exit.
const COMMAND_TIMEOUT_KILL_GRACE_MS = COMMAND_TIMEOUT_TERM_GRACE_MS + 1_000;

const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;
const CONTAINER_ID = /^[a-f0-9]{12,64}$/i;
const FULL_CONTAINER_ID = /^[a-f0-9]{64}$/i;
const MANAGED_VPS_CONTAINER_NAME = /^openmausbot-vps-[a-z0-9]{1,12}-[a-f0-9]{12}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/i;
const SCREENSHOT_PATH = "/tmp/openmausbot-vps-preview.png";
// The Cua XFCE base ships Pillow in /opt/venv; a container without it returns the original PNG.
const SCREENSHOT_TRANSFER = `/opt/venv/bin/python -I -c 'import base64, io, sys
from PIL import Image
with Image.open(sys.argv[1]) as image:
    image.thumbnail((1280, 1280))
    output = io.BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=70)
sys.stdout.write(base64.b64encode(output.getvalue()).decode("ascii"))' "$1" 2>/dev/null || { base64 < "$1" | tr -d "\\n"; }`;
const INTERNAL_VIEWER_PORT = 6901;
const VIEWER_VERSION = "1";
const lifecycleLocks = new Map<string, Promise<void>>();

const DESKTOP_PROBE = `version="$("$1" --version)"
[ "$version" = "$2" ] || { echo "unexpected Cua Driver version" >&2; exit 1; }
"$1" status --socket "$3" >/dev/null
"$1" call health_report '{}' --socket "$3"
"$1" call get_desktop_state '{}' --socket "$3" >/dev/null`;

export function vpsDesktopProbeArgs(container: string): string[] {
  const args = cuaExecArgs([], { container });
  return [...args.slice(0, -1), "sh", "-ec", DESKTOP_PROBE, "omb-desktop-probe", CUA_EXECUTABLE, `cua-driver ${CUA_DRIVER_VERSION}`, CUA_SOCKET];
}

/** The app config reloads in place: across awaits it could inspect one host and mutate another. */
function snapshotVpsConfig(cfg: AppConfig): AppConfig {
  const sshAlias = vpsSshAlias(cfg);
  return sshAlias ? { vps: { sshAlias } } : {};
}

export function vpsLifecycleBusy(): boolean {
  return lifecycleLocks.size > 0;
}

export function vpsComputerPreparing(cfg: AppConfig, botId: string): boolean {
  const key = vpsLockKey(cfg, botId);
  return key !== null && pendingProvisions.has(key);
}
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const STATUS_CACHE_TTL_MS = 3_000;
const statusCache = new Map<string, { status: VpsComputerStatus; expiresAt: number }>();
const pendingStatuses = new Map<string, Promise<VpsComputerStatus>>();
const pendingFreshStatuses = new Map<string, Promise<VpsComputerStatus>>();
const pendingProvisions = new Map<string, Promise<VpsComputerStatus>>();
const SCREENSHOT_BUDGET_MS = 45_000;
const SCREENSHOT_CLEANUP_BUDGET_MS = 10_000;
const PREPARATION_LOCK_TIMEOUT_MS = SCREENSHOT_BUDGET_MS + LOCK_ACQUIRE_TIMEOUT_MS;
type VpsScreenshot = { png: string; format: "png" | "jpeg" };
const pendingScreenshots = new Map<string, Promise<VpsScreenshot>>();
const viewerConnections = new Map<string, { privateIp: string; password: string }>();

function invalidateVpsStatus(key: string): void {
  statusCache.delete(key);
  // An inspection begun before a mutation must not be joined or republish its result after it.
  pendingStatuses.delete(key);
  pendingFreshStatuses.delete(key);
}

export interface VpsCommandOptions {
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type VpsCommandRunner = (
  args: string[],
  options?: VpsCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

export type VpsLifecycleAction = "provision" | "start" | "stop" | "remove";

export function vpsStartsForTurn(input: { wants: "cloud" | "vm" | "local" | "off" | undefined; autoStartVps?: boolean; automationSource?: string }): boolean {
  if (input.wants === "cloud") return true;
  if (input.wants !== undefined) return false;
  return input.autoStartVps === true || Boolean(input.automationSource);
}

export function vpsUnavailableHint(input: { automationSource?: string; autoStartVps?: boolean; reachable?: boolean }): string {
  if (input.automationSource) return "This scheduled run tried to start the VPS computer and could not reach it. Check the VPS connection in Settings → API keys.";
  if (input.autoStartVps || input.reachable === false) return "Check the VPS connection in Settings → API keys.";
  return input.reachable ? "Open Computer and enable Start VPS automatically, or choose Cloud computer to start it manually." : "";
}

export interface VpsComputerStatus {
  configured: boolean;
  /** What this bot's container is (or a new one would be): the bot desktop, or the Cua XFCE fallback. */
  desktop: VpsDesktopKind;
  sshAlias: string | null;
  daemonUp: boolean;
  image: boolean;
  imageMatches: boolean;
  managed: boolean;
  container: "running" | "stopped" | "missing";
  network: "private" | "unsafe" | "unknown";
  mounts: "none" | "unsafe" | "unknown";
  security: "hardened" | "unsafe" | "unknown";
  desktopReady: boolean;
  desktop_error: string | null;
  ready: boolean;
  problem: string | null;
  image_ref: string;
  base_image_ref: string;
  driver_version: string;
  container_name: string;
  container_id: string | null;
  container_started_at?: string;
  image_id: string | null;
}

export interface ManagedVpsOwner {
  botId: string;
  name: string;
  inUse: boolean;
}

export interface ManagedVpsInventoryInstance {
  name: string;
  state: "created" | "restarting" | "running" | "removing" | "paused" | "exited" | "dead" | "unknown";
  /** The SSH alias whose host holds this container. */
  vpsAlias: string;
  ownerBotId: string | null;
  ownerName: string | null;
  orphaned: boolean;
  inUse: boolean;
}

export interface ManagedVpsInventory {
  configured: boolean;
  available: boolean;
  /** Every alias the listing covers: the default first, then each bot's own. */
  vpsAliases: string[];
  problem: string | null;
  instances: ManagedVpsInventoryInstance[];
}

function containerNamePart(botId: string): string {
  return botId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "bot";
}

export function vpsContainerName(botId: string): string {
  const hash = createHash("sha256").update(botId).digest("hex").slice(0, 12);
  return `${VPS_CONTAINER_PREFIX}-${containerNamePart(botId)}-${hash}`;
}

export function vpsDockerArgs(alias: string, args: string[]): string[] {
  // a server on the linked VPS drives its own daemon
  if (isThisServerVps(alias)) return args;
  if (!isValidSshAlias(alias)) {
    throw new Error("invalid VPS SSH config alias");
  }
  return ["-H", `ssh://${alias}`, ...args];
}

/** Never published by Docker: SSH forwards one loopback port to noVNC, and every caller-controlled part is validated before argv. */
export function vpsSshTunnelArgs(alias: string, localPort: number, privateIp: string, configPath: string | null = null, remotePort = INTERNAL_VIEWER_PORT): string[] {
  if (!isValidSshAlias(alias)) throw new Error("invalid VPS SSH config alias");
  if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535) {
    throw new Error("invalid VPS viewer port");
  }
  if (!isManagedScreenViewerPort(remotePort)) throw new Error("invalid VPS viewer port");
  if (!privateDockerIpv4(privateIp)) throw new Error("invalid VPS private container address");
  return [
    ...(configPath ? ["-F", configPath] : []),
    "-N",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-L",
    `127.0.0.1:${localPort}:${privateIp}:${remotePort}`,
    alias,
  ];
}

const STREAM_CAP_CHARS = 16 * 1024 * 1024;

function tailCollector() {
  const chunks: string[] = [];
  let total = 0;
  return {
    push(chunk: string) {
      chunks.push(chunk);
      total += chunk.length;
      for (;;) {
        const first = chunks[0];
        if (chunks.length < 2 || first === undefined || total - first.length < STREAM_CAP_CHARS) break;
        chunks.shift();
        total -= first.length;
      }
    },
    text(): string {
      return chunks.join("").slice(-STREAM_CAP_CHARS);
    },
  };
}

export function defaultRunner(args: string[], options: VpsCommandOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const cancelled = () => Object.assign(new Error("Docker-over-SSH command cancelled"), { name: "AbortError", status: 499 });
  if (options.signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    // Docker's SSH transport runs the first `ssh` on PATH: the app's shim, which shares one connection.
    const ssh = prepareVpsSsh(DATA_DIR, augmentedPath());
    const child = spawnCli("docker", args, {
      shell: false,
      env: { ...process.env, PATH: ssh.path },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = tailCollector();
    const stderr = tailCollector();
    let settled = false;
    let failure: Error | null = null;
    let timeout: ReturnType<typeof setTimeout>;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      finish();
    };
    const fail = (error: Error) => {
      if (settled || failure) return;
      failure = error;
      clearTimeout(timeout);
      // ssh can hold these pipes after Docker exits; stop only this command's process group (SSH masters detach from it).
      const cleaned = () => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        settle(() => reject(error));
      };
      void killCliTree(child, COMMAND_TIMEOUT_TERM_GRACE_MS).then(cleaned, cleaned);
    };
    const abort = () => fail(cancelled());
    timeout = setTimeout(() => fail(new Error("Docker-over-SSH command timed out")), options.timeoutMs ?? 120_000);
    timeout.unref?.();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr.push(chunk);
    });
    child.stdin.on("error", (error) => {
      fail(new Error(`Docker-over-SSH stdin failed: ${error.message}`));
    });
    child.on("error", (error) => {
      fail(new Error(`Docker-over-SSH could not start: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      if (failure) return;
      settle(() => {
        if (code === 0) return resolve({ stdout: stdout.text(), stderr: stderr.text() });
        const detail = stderr.text().trim().slice(-1000);
        reject(new Error(detail || `Docker-over-SSH exited ${code ?? signal ?? "without a status"}`));
      });
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    try {
      if (!failure) child.stdin.end(options.input);
    } catch (error) {
      fail(new Error(`Docker-over-SSH stdin failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

function emptyStatus(botId: string, alias: string | null, desktop = preferredVpsDesktop()): VpsComputerStatus {
  return {
    configured: Boolean(alias),
    desktop,
    sshAlias: alias,
    daemonUp: false,
    image: false,
    imageMatches: false,
    managed: false,
    container: "missing",
    network: "unknown",
    mounts: "unknown",
    security: "unknown",
    desktopReady: false,
    desktop_error: null,
    ready: false,
    problem: isThisServerVps(alias) ? "Docker is not running on this server"
      : alias ? "Docker over SSH is not reachable" : "Configure a VPS SSH alias in Settings → API keys",
    image_ref: desktop === "cua" ? VPS_IMAGE : BOT_DESKTOP_IMAGE,
    base_image_ref: BASE_IMAGE,
    driver_version: CUA_DRIVER_VERSION,
    container_name: vpsContainerName(botId),
    container_id: null,
    image_id: null,
  };
}

/** Docker and Podman report "No such object/image/container"; any other inspect failure is transport, not absence. */
function isMissingObjectMessage(message: string): boolean {
  return /no such (object|image|container)/i.test(message);
}

function transportFailure(message: string): string {
  if (/timed out/i.test(message)) {
    return "Docker over SSH failed while checking the VPS: the connection timed out. Check that the VPS is online, SSH is reachable from this computer, and Docker is running on the VPS, then retry. No computer was reset.";
  }
  return `Docker over SSH failed while checking the VPS: ${message.trim().slice(0, 200) || "unknown transport error"}`;
}

function privateDockerIpv4(value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function viewerPassword(env: string[] | undefined): string | null {
  const value = env?.find((entry) => entry.startsWith("VNC_PW="))?.slice("VNC_PW=".length);
  return value && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null;
}

function hasNoHostMounts(detail: {
  Mounts?: unknown;
  HostConfig?: { Binds?: string[] | null; VolumesFrom?: string[] | null };
}): boolean {
  return (
    Array.isArray(detail.Mounts) &&
    detail.Mounts.length === 0 &&
    (!detail.HostConfig?.Binds || detail.HostConfig.Binds.length === 0) &&
    (!detail.HostConfig?.VolumesFrom || detail.HostConfig.VolumesFrom.length === 0)
  );
}

function hasNoPublishedPorts(config: {
  NetworkMode?: string;
  PortBindings?: Record<string, unknown> | null;
  PublishAllPorts?: boolean;
} | undefined, networks?: Record<string, unknown> | null): boolean {
  if (!config) return false;
  const networkMode = (config.NetworkMode ?? "").toLowerCase();
  if (!["default", "bridge"].includes(networkMode)) return false;
  const attached = Object.keys(networks ?? {}).map((name) => name.toLowerCase());
  if (attached.length !== 1 || !["default", "bridge"].includes(attached[0]!)) return false;
  return (
    config.PublishAllPorts !== true &&
    !Object.values(config.PortBindings ?? {}).some((value) => Array.isArray(value) && value.length > 0)
  );
}

function statusProblem(status: VpsComputerStatus, desktopVersion?: string): string | null {
  if (!status.configured) return "Configure a VPS SSH alias in Settings → API keys";
  if (!status.daemonUp) return "Docker over SSH could not reach the VPS; check the SSH alias and Docker on the VPS";
  if (status.managed && status.desktop === "bot-desktop" && desktopVersion && /^\d{1,4}$/.test(desktopVersion) && desktopVersion !== BOT_DESKTOP_VERSION &&
    status.network === "private" && status.mounts === "none" && status.security === "hardened") {
    return `This managed computer uses desktop version ${desktopVersion}; this app requires version ${BOT_DESKTOP_VERSION}. Use Replace the desktop on your VPS in this bot's Computer panel: it downloads the new image or builds it on the VPS, then recreates the computer on its existing home volume, keeping saved files and browser sign-ins. No container or files were removed.`;
  }
  if (!status.image) {
    return status.desktop === "cua"
      ? `Prepare the pinned OpenMausBot Cua image on the VPS (Driver ${CUA_DRIVER_VERSION})`
      : `Prepare the OpenMausBot bot desktop image on the VPS (${BOT_DESKTOP_IMAGE})`;
  }
  if (status.container === "missing") return "No OpenMausBot container exists for this bot on the VPS";
  if (!status.imageMatches) return "The VPS container uses an incompatible or untrusted OpenMausBot image";
  if (!status.managed) return "The VPS container name is occupied by a container OpenMausBot did not create";
  if (status.network === "unsafe") return "The VPS container uses an unapproved network or publishes ports; refusing to use it";
  if (status.mounts === "unsafe") return "The VPS container has host mounts; refusing to use it";
  if (status.security === "unsafe") return "The VPS container has unsupported privilege, isolation, or automatic-removal settings";
  if (status.container === "stopped") return "The OpenMausBot VPS container is stopped";
  if (status.desktop_error) return `The VPS Cua desktop failed to start: ${status.desktop_error}`;
  if (!status.desktopReady) return "The VPS container started, but Cua Driver is not ready yet";
  return null;
}

async function computeVpsComputerStatus(
  cfg: AppConfig,
  botId: string,
  runner: VpsCommandRunner,
  prefer = preferredVpsDesktop(),
): Promise<VpsComputerStatus> {
  const alias = vpsSshAlias(cfg);
  const status = emptyStatus(botId, alias, prefer);
  if (!alias) return status;
  viewerConnections.delete(`${alias}:${status.container_name}`);
  const run = (args: string[], timeoutMs = 10_000, input?: string) =>
    runner(vpsDockerArgs(alias, args), { timeoutMs, input });
  // Retry only read-only inspections, never an exec or mutation whose outcome a lost connection hides.
  const inspect = async (args: string[]) => {
    try { return await run(args); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/timed out|connection reset by peer|broken pipe/i.test(message)) throw error;
      return run(args);
    }
  };

  let inspectedImageId: string | null = null, desktopVersion: string | undefined;
  // false only on a transport failure, with the problem already set
  const inspectImage = async (desktop: VpsDesktopKind): Promise<boolean> => {
    Object.assign(status, { desktop, image_ref: desktop === "cua" ? VPS_IMAGE : BOT_DESKTOP_IMAGE, image: false, image_id: null });
    inspectedImageId = null;
    try {
      const inspected = JSON.parse((await inspect(["image", "inspect", status.image_ref])).stdout) as Array<{
        Id?: string;
        id?: string;
        Config?: { Labels?: Record<string, string> };
        config?: { Labels?: Record<string, string>; labels?: Record<string, string> };
      }>;
      const image = inspected[0];
      const labels = image?.Config?.Labels ?? image?.config?.Labels ?? image?.config?.labels;
      const imageId = image?.Id ?? image?.id;
      inspectedImageId = imageId && IMAGE_ID.test(imageId) ? imageId : null;
      status.image_id = inspectedImageId;
      status.image = Boolean(inspectedImageId) && (desktop === "cua" ? imageLabelsMatch(labels) : botDesktopLabelsMatch(labels));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingObjectMessage(message)) { status.problem = transportFailure(message); return false; }
    }
    status.daemonUp = true;
    return true;
  };
  const [imageInspected, containerInspection] = await Promise.all([
    inspectImage(prefer),
    inspect(["inspect", status.container_name]).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    ),
  ]);
  if (!imageInspected) return status;

  try {
    if ("error" in containerInspection) throw containerInspection.error;
    const inspected = JSON.parse(containerInspection.result.stdout) as Array<{
      Config?: { Image?: string; Labels?: Record<string, string>; Env?: string[] };
      HostConfig?: DockerHardeningConfig & {
        ReadonlyRootfs?: boolean;
        Runtime?: string;
        Binds?: string[] | null;
        VolumesFrom?: string[] | null;
        NetworkMode?: string;
        PortBindings?: Record<string, unknown> | null;
        PublishAllPorts?: boolean;
      };
      Id?: string;
      id?: string;
      Image?: string;
      NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> | null };
      Mounts?: unknown;
      State?: { Running?: boolean; StartedAt?: unknown };
    }>;
    const detail = inspected[0];
    const labels = detail?.Config?.Labels;
    desktopVersion = labels?.[BOT_DESKTOP_LABEL];
    // an existing container is judged as what it was made from, whatever new ones get today
    if (containerDesktopKind(labels) !== status.desktop && !(await inspectImage(containerDesktopKind(labels)))) {
      status.daemonUp = false;
      return status;
    }
    const cua = status.desktop === "cua";
    const containerId = detail?.Id ?? detail?.id;
    status.container_id = containerId && CONTAINER_ID.test(containerId) ? containerId : null;
    status.container = detail?.State?.Running ? "running" : "stopped";
    const startedAt = vpsContainerStartedAt(detail?.State?.StartedAt);
    if (startedAt) status.container_started_at = startedAt;
    status.imageMatches =
      status.image &&
      Boolean(status.container_id) &&
      (detail?.Config?.Image === status.image_ref || detail?.Config?.Image === inspectedImageId) &&
      Boolean(inspectedImageId) &&
      detail?.Image === inspectedImageId &&
      (cua ? imageLabelsMatch(labels) : botDesktopLabelsMatch(labels)) &&
      labels?.[VPS_VIEWER_LABEL] === VIEWER_VERSION;
    const environmentLabel = labels?.[VPS_ENVIRONMENT_LABEL];
    status.managed =
      labels?.[VPS_MANAGED_LABEL] === "1" &&
      labels?.[VPS_CONTAINER_LABEL] === status.container_name &&
      (environmentLabel === undefined || environmentLabel === vpsEnvironmentId());
    if (status.managed && status.imageMatches && status.container_id) raisePidsLimit(status.container_id, detail?.HostConfig?.PidsLimit, run);
    const networks = detail?.NetworkSettings?.Networks;
    status.network = (cua ? hasNoPublishedPorts : botDesktopNetworkIsPrivate)(detail?.HostConfig, networks) ? "private" : "unsafe";
    // the bot desktop's one mount is its own home volume, so "none" here means no host mounts
    status.mounts = (cua ? hasNoHostMounts(detail ?? {}) : botDesktopMountsAreSafe(status.container_name, detail ?? {})) ? "none" : "unsafe";
    status.security = (cua ? dockerSecurityIsHardened(detail?.HostConfig, { restartPolicy: "any" })
      : botDesktopIsHardened(detail?.HostConfig, containerBotDesktopMode(labels, detail?.Config?.Env)))
      ? "hardened" : "unsafe";

    const connectionKey = `${alias}:${status.container_name}`;
    const privateIp = Object.values(detail?.NetworkSettings?.Networks ?? {})[0]?.IPAddress;
    const password = viewerPassword(detail?.Config?.Env);
    if (status.managed && privateIp && privateDockerIpv4(privateIp) && password) {
      viewerConnections.set(connectionKey, { privateIp, password });
    } else {
      viewerConnections.delete(connectionKey);
    }

    const containerRef = status.container_id;
    const canProbe =
      status.container === "running" &&
      status.image &&
      status.imageMatches &&
      status.managed &&
      status.network === "private" &&
      status.mounts === "none" &&
      status.security === "hardened";
    if (canProbe && containerRef) {
      try {
        const health = await run(vpsDesktopProbeArgs(containerRef), 20_000);
        const report = JSON.parse(health.stdout) as {
          schema_version?: string;
          overall?: string;
          checks?: unknown[];
        };
        if (
          report.schema_version !== "1" ||
          !Array.isArray(report.checks) ||
          (report.overall !== "ok" && report.overall !== "degraded")
        ) {
          throw new Error(`Cua health report is ${report.overall ?? "invalid"}`);
        }
        status.desktopReady = true;
      } catch (error) {
        status.desktopReady = false;
        status.desktop_error = error instanceof Error ? error.message.slice(0, 320) : null;
        try {
          const errorLog = await run(
            ["exec", containerRef, "tail", "-n", "4", "/var/log/supervisor/cua-driver.error.log"],
            10_000,
          );
          status.desktop_error =
            errorLog.stdout.replace(/\s+/g, " ").trim().slice(0, 320) || status.desktop_error;
        } catch {
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingObjectMessage(message)) {
      status.container = "missing";
    } else {
      status.daemonUp = false;
      status.problem = transportFailure(message);
      return status;
    }
  }

  status.problem = statusProblem(status, desktopVersion);
  status.ready = status.problem === null;
  return status;
}

export async function vpsComputerStatus(
  cfg: AppConfig,
  botId: string,
  runner: VpsCommandRunner = defaultRunner,
  options: { fresh?: boolean } = {},
): Promise<VpsComputerStatus> {
  cfg = snapshotVpsConfig(cfg);
  const key = vpsLockKey(cfg, botId);
  const cacheable = runner === defaultRunner && key !== null;
  if (cacheable && options.fresh) {
    const pending = pendingFreshStatuses.get(key);
    if (pending) return pending;
    invalidateVpsStatus(key);
  } else if (cacheable) {
    const capture = pendingScreenshots.get(key);
    if (capture) await capture.catch(() => {});
    const cached = statusCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.status;
    const pending = pendingStatuses.get(key);
    if (pending) return pending;
  }
  const inspection = computeVpsComputerStatus(cfg, botId, runner);
  if (cacheable) {
    pendingStatuses.set(key, inspection);
    if (options.fresh) pendingFreshStatuses.set(key, inspection);
  }
  try {
    const status = await inspection;
    if (cacheable && pendingStatuses.get(key) === inspection && !lifecycleLocks.has(key)) {
      statusCache.set(key, { status, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
    }
    return status;
  } finally {
    if (cacheable && pendingStatuses.get(key) === inspection) pendingStatuses.delete(key);
    if (cacheable && pendingFreshStatuses.get(key) === inspection) pendingFreshStatuses.delete(key);
  }
}

const VPS_INVENTORY_LIMIT = 256;
const VPS_INVENTORY_STATES = new Set<ManagedVpsInventoryInstance["state"]>([
  "created",
  "restarting",
  "running",
  "removing",
  "paused",
  "exited",
  "dead",
]);

type ManagedVpsAliasScan = Pick<ManagedVpsInventory, "available" | "problem" | "instances"> & { containerIds: Map<string, string> };

function inventoryFailure(alias: string, error: unknown): ManagedVpsAliasScan {
  const detail = (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 200);
  return {
    available: false,
    problem: `Docker over SSH could not list managed computers on ${alias}${detail ? `: ${detail}` : ""}`,
    instances: [],
    containerIds: new Map(),
  };
}

function managedVpsState(value: unknown, running: unknown): ManagedVpsInventoryInstance["state"] {
  const state = typeof value === "string" ? value.toLowerCase() : "";
  if (VPS_INVENTORY_STATES.has(state as ManagedVpsInventoryInstance["state"])) {
    return state as ManagedVpsInventoryInstance["state"];
  }
  if (running === true) return "running";
  if (running === false) return "exited";
  return "unknown";
}

async function scanManagedVpsAlias(
  alias: string,
  owners: ManagedVpsOwner[],
  runner: VpsCommandRunner,
): Promise<ManagedVpsAliasScan> {
  try {
    const listed = await runner(vpsDockerArgs(alias, [
      "container",
      "ls",
      "--all",
      "--filter",
      `label=${VPS_MANAGED_LABEL}=1`,
      "--format",
      "{{.ID}}",
    ]), { timeoutMs: 20_000 });
    const ids = [...new Set(listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
    if (ids.length > VPS_INVENTORY_LIMIT || ids.some((id) => !CONTAINER_ID.test(id))) {
      throw new Error("the VPS returned an invalid or unexpectedly large managed-container list");
    }
    if (ids.length === 0) {
      return { available: true, problem: null, instances: [], containerIds: new Map() };
    }

    const inspected = await runner(
      vpsDockerArgs(alias, ["container", "inspect", ...ids]),
      { timeoutMs: 20_000 },
    );
    const details = JSON.parse(inspected.stdout) as unknown;
    if (!Array.isArray(details) || details.length !== ids.length) {
      throw new Error("the VPS returned an incomplete managed-container inventory");
    }

    const ownerByName = new Map(owners.map((owner) => [vpsContainerName(owner.botId), owner]));
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const containerIds = new Map<string, string>();
    const instances: ManagedVpsInventoryInstance[] = [];
    for (const raw of details) {
      if (!raw || typeof raw !== "object") throw new Error("the VPS returned a malformed managed container");
      const detail = raw as {
        Id?: unknown;
        Name?: unknown;
        Config?: { Labels?: unknown };
        State?: { Status?: unknown; Running?: unknown };
      };
      const id = typeof detail.Id === "string" ? detail.Id.toLowerCase() : "";
      const name = typeof detail.Name === "string" ? detail.Name.replace(/^\//, "") : "";
      const labels = detail.Config?.Labels;
      const listedId = ids.find((candidate) => id.startsWith(candidate.toLowerCase()));
      if (
        !FULL_CONTAINER_ID.test(id) ||
        !listedId ||
        seenIds.has(listedId) ||
        !MANAGED_VPS_CONTAINER_NAME.test(name) ||
        seenNames.has(name) ||
        !labels ||
        typeof labels !== "object" ||
        (labels as Record<string, unknown>)[VPS_MANAGED_LABEL] !== "1" ||
        (labels as Record<string, unknown>)[VPS_CONTAINER_LABEL] !== name
      ) {
        throw new Error("the VPS returned a managed container whose identity could not be verified");
      }
      const owner = ownerByName.get(name);
      const environmentLabel = (labels as Record<string, unknown>)[VPS_ENVIRONMENT_LABEL];
      seenIds.add(listedId);
      seenNames.add(name);
      // Another installation may share this daemon: never return an id that would make its container removable.
      if (environmentLabel !== vpsEnvironmentId() && !(environmentLabel === undefined && owner)) {
        continue;
      }
      containerIds.set(name, id);
      instances.push({
        name,
        state: managedVpsState(detail.State?.Status, detail.State?.Running),
        vpsAlias: alias,
        ownerBotId: owner?.botId ?? null,
        ownerName: owner?.name ?? null,
        orphaned: !owner,
        inUse: owner?.inUse === true,
      });
    }
    if (seenIds.size !== ids.length) {
      throw new Error("the VPS returned an incomplete managed-container inventory");
    }
    return { available: true, problem: null, instances, containerIds };
  } catch (error) {
    return inventoryFailure(alias, error);
  }
}

export async function listManagedVpsComputers(
  cfg: AppConfig,
  owners: ManagedVpsOwner[],
  runner: VpsCommandRunner = defaultRunner,
  vpsAliases?: string[],
): Promise<ManagedVpsInventory> {
  const defaultAlias = vpsSshAlias(snapshotVpsConfig(cfg));
  const scanning = [...new Set((vpsAliases?.length ? vpsAliases : defaultAlias ? [defaultAlias] : []).filter(isValidSshAlias))];
  if (scanning.length === 0) {
    return { configured: false, available: false, vpsAliases: [], problem: null, instances: [] };
  }
  // Concurrently: one dead host must not delay the others behind its timeouts. Promise.all keeps
  // alias order, so the aggregate below matches the old serial loop exactly.
  const scans = await Promise.all(scanning.map((alias) => scanManagedVpsAlias(alias, owners, runner)));
  const problem = scans.find((scan) => !scan.available)?.problem ?? null;
  const instances = scans.flatMap((scan) => scan.instances).sort((left, right) =>
    Number(left.orphaned) - Number(right.orphaned) ||
    (left.ownerName ?? left.name).localeCompare(right.ownerName ?? right.name) ||
    left.vpsAlias.localeCompare(right.vpsAlias),
  );
  return { configured: true, available: scans.every((scan) => scan.available), vpsAliases: scanning, problem, instances };
}

/** Ownership labels every managed VPS container carries, whichever desktop it runs. */
function vpsOwnershipLabels(containerName: string): string[] {
  return [`${VPS_MANAGED_LABEL}=1`, `${VPS_CONTAINER_LABEL}=${containerName}`, `${VPS_ENVIRONMENT_LABEL}=${vpsEnvironmentId()}`, `${VPS_VIEWER_LABEL}=${VIEWER_VERSION}`];
}

/** The Cua XFCE fallback's flags; the bot desktop's are botDesktopRunArgs. */
export function vpsContainerRunArgs(
  containerName: string,
  imageRef = VPS_IMAGE,
  viewerSecret = randomBytes(18).toString("base64url"),
): string[] {
  if (!CONTAINER_NAME.test(containerName) || (imageRef !== VPS_IMAGE && !IMAGE_ID.test(imageRef))) {
    throw new Error("invalid managed VPS container or image reference");
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(viewerSecret)) throw new Error("invalid managed VPS viewer secret");
  const labels = [
    ...vpsOwnershipLabels(containerName), `${MANAGED_LABEL}=1`, `${DRIVER_LABEL}=${CUA_DRIVER_VERSION}`,
    `${BASE_IMAGE_LABEL}=${BASE_IMAGE_DIGEST}`, `${IMAGE_LAYER_LABEL}=${IMAGE_LAYER_VERSION}`,
  ];
  return [
    "run", "-d", "--name", containerName, ...labels.flatMap((label) => ["--label", label]),
    "--memory", "4g", "--memory-swap", "4g", "--cpus", "2", "--pids-limit", String(PIDS_LIMIT),
    "--network", "bridge", "--ipc", "private", "--cgroupns", "private",
    "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--shm-size", "512m",
    // Without a restart policy Docker leaves the container down after a VPS reboot; unless-stopped still honors Stop.
    "--restart", "unless-stopped", "-e", `VNC_PW=${viewerSecret}`, imageRef,
  ];
}

function assertUsableContainer(status: VpsComputerStatus) {
  if (
    !status.image ||
    !status.imageMatches ||
    !status.managed ||
    status.network !== "private" ||
    status.mounts !== "none" ||
    status.security !== "hardened"
  ) {
    throw Object.assign(new Error(status.problem ?? "The existing VPS container is unsafe or incompatible"), {
      status: 409,
    });
  }
}

async function prepareVpsImage(alias: string, runner: VpsCommandRunner) {
  await runner(vpsDockerArgs(alias, ["pull", BASE_IMAGE]), { timeoutMs: 10 * 60_000 });
  await runner(vpsDockerArgs(alias, ["build", "-t", VPS_IMAGE, "-"]), {
    input: managedImageDockerfile(),
    timeoutMs: 10 * 60_000,
  });
}

async function waitForVpsReady(
  cfg: AppConfig,
  botId: string,
  runner: VpsCommandRunner,
  budgetMs = 60_000,
): Promise<VpsComputerStatus> {
  const alias = vpsSshAlias(cfg);
  const deadline = Date.now() + budgetMs;
  let budgetExpired = false;
  const boundedRunner: VpsCommandRunner = async (args, options = {}) => {
    const remaining = deadline - Date.now() - COMMAND_TIMEOUT_KILL_GRACE_MS;
    if (remaining <= 0) {
      budgetExpired = true;
      throw new Error("VPS desktop readiness timed out");
    }
    try {
      return await runner(args, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 120_000, remaining) });
    } catch (error) {
      if (Date.now() >= deadline - COMMAND_TIMEOUT_KILL_GRACE_MS) budgetExpired = true;
      throw error;
    }
  };
  let status = await computeVpsComputerStatus(cfg, botId, boundedRunner);
  let delayMs = 500;
  while (!status.ready && alias && !budgetExpired && Date.now() < deadline) {
    if (
      !status.daemonUp ||
      !status.image ||
      !status.imageMatches ||
      !status.managed ||
      status.container !== "running" ||
      status.network !== "private" ||
      status.mounts !== "none" ||
      status.security !== "hardened"
    ) {
      return status;
    }
    await new Promise((resolve) => {
      const sleep = setTimeout(resolve, Math.min(delayMs, Math.max(0, deadline - Date.now())));
      sleep.unref?.();
    });
    delayMs = Math.min(delayMs * 2, 4_000);
    const container = status.container_id ?? status.container_name;
    const driverAnswers = await boundedRunner(
      vpsDockerArgs(alias, cuaExecArgs(["status", "--socket", CUA_SOCKET], { container })),
      { timeoutMs: 10_000 },
    ).then(
      () => true,
      () => false,
    );
    if (budgetExpired) break;
    if (!driverAnswers && Date.now() < deadline) continue;
    status = await computeVpsComputerStatus(cfg, botId, boundedRunner);
  }
  if (budgetExpired) return {
    ...status,
    ready: false,
    desktopReady: false,
    desktop_error: "VPS desktop readiness timed out",
    problem: "The VPS desktop did not become ready in time — retry when the connection recovers",
  };
  return status;
}

async function withVpsLifecycleLock<T>(key: string, operation: () => Promise<T>, acquireTimeoutMs = LOCK_ACQUIRE_TIMEOUT_MS): Promise<T> {
  const previous = lifecycleLocks.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  lifecycleLocks.set(key, current);
  if (previous) {
    let acquireTimer: ReturnType<typeof setTimeout> | undefined;
    const acquired = await Promise.race([
      previous.then(() => true),
      new Promise<boolean>((resolve) => {
        acquireTimer = setTimeout(() => resolve(false), acquireTimeoutMs);
        acquireTimer.unref?.();
      }),
    ]);
    if (acquireTimer) clearTimeout(acquireTimer);
    if (!acquired) {
      // This slot opens only when the holder's does, so a later caller never runs beside the long operation.
      void previous.then(() => {
        release();
        if (lifecycleLocks.get(key) === current) lifecycleLocks.delete(key);
      });
      throw Object.assign(new Error("the VPS is being prepared — try again shortly"), { status: 409 });
    }
  }
  try {
    return await operation();
  } finally {
    release();
    if (lifecycleLocks.get(key) === current) lifecycleLocks.delete(key);
  }
}

function vpsLockKey(cfg: AppConfig, botId: string): string | null {
  const alias = vpsSshAlias(cfg);
  return alias ? `${alias}:${vpsContainerName(botId)}` : null;
}

export async function removeManagedVpsComputer(
  cfg: AppConfig,
  owners: ManagedVpsOwner[],
  containerName: string,
  confirmName: string,
  runner: VpsCommandRunner = defaultRunner,
): Promise<{ removed: true; name: string }> {
  cfg = snapshotVpsConfig(cfg);
  const alias = vpsSshAlias(cfg);
  if (!alias) {
    throw Object.assign(new Error("VPS is not configured — add an SSH config alias in Settings → API keys"), { status: 409 });
  }
  if (!MANAGED_VPS_CONTAINER_NAME.test(containerName)) {
    throw Object.assign(new Error("invalid managed VPS computer name"), { status: 400 });
  }
  const key = `${alias}:${containerName}`;
  return withVpsLifecycleLock(key, async () => {
    invalidateVpsStatus(key);
    const scan = await scanManagedVpsAlias(alias, owners, runner);
    if (!scan.available) {
      throw Object.assign(new Error(scan.problem ?? "VPS computer inventory is unavailable"), { status: 503 });
    }
    const instance = scan.instances.find((candidate) => candidate.name === containerName);
    if (!instance) throw Object.assign(new Error("managed VPS computer not found"), { status: 404 });
    if (instance.inUse) {
      throw Object.assign(new Error("this VPS computer is in use — stop its bot's work first"), { status: 409 });
    }
    if (confirmName !== instance.name) {
      throw Object.assign(new Error("confirmation no longer matches this VPS computer — refresh and try again"), { status: 400 });
    }

    const containerId = scan.containerIds.get(instance.name);
    if (!containerId || !FULL_CONTAINER_ID.test(containerId)) {
      throw Object.assign(new Error("the VPS computer identity could not be revalidated"), { status: 409 });
    }
    try {
      // The immutable ID, not the name: a same-name replacement must not receive this removal.
      await runner(vpsDockerArgs(alias, ["rm", "-f", containerId]), { timeoutMs: 2 * 60_000 });
    } catch (error) {
      invalidateVpsStatus(key);
      const detail = (error instanceof Error ? error.message : String(error))
        .replace(/[\r\n\t]+/g, " ")
        .trim()
        .slice(0, 200);
      throw Object.assign(
        new Error(`The VPS refused to remove this computer${detail ? `: ${detail}` : ""}`),
        { status: 502 },
      );
    }
    invalidateVpsStatus(key);
    viewerConnections.delete(key);
    if (instance.ownerBotId) stopDesktopTunnel(instance.ownerBotId);
    return { removed: true, name: instance.name };
  });
}

export async function vpsComputerAction(
  action: VpsLifecycleAction,
  cfg: AppConfig,
  botId: string,
  runner: VpsCommandRunner = defaultRunner,
  guard: { expectedContainerId?: string; stillAllowed?: () => boolean; onStarting?: () => void; onProgress?: (step: BotDesktopProgress) => void } = {},
): Promise<VpsComputerStatus> {
  cfg = snapshotVpsConfig(cfg);
  const alias = vpsSshAlias(cfg);
  if (!alias) throw Object.assign(new Error("VPS is not configured — add an SSH config alias in Settings → API keys"), { status: 409 });
  const key = `${alias}:${vpsContainerName(botId)}`;
  const pending = action === "provision" ? pendingProvisions.get(key) : undefined;
  if (pending) return pending;
  const requireAllowed = () => {
    if (guard.stillAllowed?.() === false) throw Object.assign(new Error("This VPS computer action was cancelled"), { status: 409, code: "vps_action_cancelled" });
  };
  const guardedRunner: VpsCommandRunner = (args, options) => { requireAllowed(); return runner(args, options); };
  const operation = async () => {
    requireAllowed();
    invalidateVpsStatus(key);
    try {
      const before = await computeVpsComputerStatus(cfg, botId, runner);
      requireAllowed();
      if (!before.daemonUp) throw Object.assign(new Error(before.problem ?? "Docker over SSH is not reachable"), { status: 409 });
      if (guard.expectedContainerId !== undefined && before.container_id !== guard.expectedContainerId) {
        throw Object.assign(new Error("The VPS computer changed before this action"), { status: 409, code: "vps_container_changed" });
      }
      if (action === "provision" && before.ready) return before;
      if (action !== "provision" || before.container !== "running") stopDesktopTunnel(botId);
      const run = (args: string[], timeoutMs = 2 * 60_000) => guardedRunner(vpsDockerArgs(alias, args), { timeoutMs });

      const containerRef = before.container_id ?? before.container_name;
      if (action === "provision") {
        if (before.container === "missing" || before.container === "stopped") guard.onStarting?.();
        const botDesktop = () => provisionBotDesktop((args, timeoutMs) => run(args, timeoutMs), {
          containerName: before.container_name, imageId: before.image ? before.image_id : null, hostKey: alias,
          labels: vpsOwnershipLabels(before.container_name), viewerSecret: randomBytes(18).toString("base64url"), onProgress: guard.onProgress,
        });
        if (before.container === "missing") {
          if (before.desktop === "bot-desktop") await botDesktop();
          else {
            let imageRef = before.image ? before.image_id : null;
            if (!imageRef) {
              await prepareVpsImage(alias, guardedRunner);
              imageRef = (await computeVpsComputerStatus(cfg, botId, guardedRunner, "cua")).image_id;
            }
            if (!imageRef) throw Object.assign(new Error("The prepared VPS image could not be identified"), { status: 409 });
            await run(vpsContainerRunArgs(before.container_name, imageRef));
          }
        } else {
          assertUsableContainer(before);
          if (before.container === "stopped") await run(["start", containerRef]);
        }
      } else if (action === "start") {
        if (before.container === "missing") throw Object.assign(new Error("No VPS container exists for this bot"), { status: 409 });
        if (before.container === "running") throw Object.assign(new Error("The VPS container is already running"), { status: 409 });
        assertUsableContainer(before);
        guard.onStarting?.();
        await run(["start", containerRef]);
      } else if (action === "remove") {
        // Skips the usability check (remove escapes a broken container); the ownership labels are the only gate.
        if (before.container === "missing") return before;
        if (!before.managed) {
          throw Object.assign(
            new Error("The VPS container name is occupied by a container OpenMausBot did not create — remove it on the VPS yourself"),
            { status: 409 },
          );
        }
        await run(["rm", "-f", containerRef]);
        return await computeVpsComputerStatus(cfg, botId, runner);
      } else {
        if (before.container !== "running") throw Object.assign(new Error("The VPS container is not running"), { status: 409 });
        assertUsableContainer(before);
        await run(["stop", containerRef]);
      }
      return await (action === "stop" ? computeVpsComputerStatus(cfg, botId, runner) : waitForVpsReady(cfg, botId, guardedRunner));
    } finally {
      invalidateVpsStatus(key);
    }
  };
  const preparation = withVpsLifecycleLock(key, operation, action === "provision" ? PREPARATION_LOCK_TIMEOUT_MS : LOCK_ACQUIRE_TIMEOUT_MS);
  if (action === "provision") pendingProvisions.set(key, preparation);
  try { return await preparation; }
  finally { if (pendingProvisions.get(key) === preparation) pendingProvisions.delete(key); }
}

export async function reuseVps(
  cfg: AppConfig,
  botId: string,
  runner: VpsCommandRunner = defaultRunner,
): Promise<VpsComputerStatus | null> {
  const status = await inspectVpsForAuto(cfg, botId, runner);
  return status.ready ? status : null;
}

/** Auto inspections in flight: a turn joins one unless a start or stop has queued behind it. */
const pendingAutoInspections = new Map<string, { inspection: Promise<VpsComputerStatus>; lock?: Promise<void>; runner: VpsCommandRunner }>();

export async function inspectVpsForAuto(
  cfg: AppConfig,
  botId: string,
  runner: VpsCommandRunner = defaultRunner,
): Promise<VpsComputerStatus> {
  cfg = snapshotVpsConfig(cfg);
  const key = vpsLockKey(cfg, botId);
  if (!key) return computeVpsComputerStatus(cfg, botId, runner);
  const pending = pendingAutoInspections.get(key);
  if (pending && pending.runner === runner && lifecycleLocks.get(key) === pending.lock) return pending.inspection;
  const inspection = withVpsLifecycleLock(key, () => computeVpsComputerStatus(cfg, botId, runner), PREPARATION_LOCK_TIMEOUT_MS);
  // withVpsLifecycleLock queues synchronously, so the newest lock slot is this inspection's own.
  const entry = { inspection, lock: lifecycleLocks.get(key), runner };
  pendingAutoInspections.set(key, entry);
  try { return await inspection; }
  finally { if (pendingAutoInspections.get(key) === entry) pendingAutoInspections.delete(key); }
}

/** The loopback URL carries the container password in its fragment, which is never sent over HTTP. */
export async function vpsComputerJoin(
  cfg: AppConfig,
  botId: string,
  runner: VpsCommandRunner = defaultRunner,
  remoteViewer = false,
  screen?: VpsScreenConnection,
): Promise<{ joinUrl: string; state: "running" }> {
  cfg = snapshotVpsConfig(cfg);
  const alias = vpsSshAlias(cfg);
  if (!alias) throw Object.assign(new Error("VPS is not configured"), { status: 409 });

  requireLiveScreen(botId, screen);
  const tunnelKey = screenKey(botId, screen);
  // Always re-inspect: a cached IP or password may predate a container replacement.
  invalidateVpsStatus(`${alias}:${vpsContainerName(botId)}`);
  const status = await computeVpsComputerStatus(cfg, botId, runner);
  requireLiveScreen(botId, screen);
  if (screen && status.container_id !== screen.containerId) throw Object.assign(new Error("The independent screen container changed"), { status: 409 });
  if (!status.ready) {
    stopDesktopTunnel(tunnelKey);
    throw Object.assign(new Error(status.problem ?? "The VPS computer is not ready"), { status: 409 });
  }
  const connection = viewerConnections.get(`${alias}:${status.container_name}`);
  if (!connection) {
    throw Object.assign(
      new Error("This VPS computer predates secure live desktop access — replace its managed container once"),
      { status: 409 },
    );
  }

  const identity = JSON.stringify([alias, status.container_id, connection.privateIp, screen?.target.viewerPort ?? INTERNAL_VIEWER_PORT]);
  const existing = desktopTunnels.get(tunnelKey);
  if (existing && existing.link.alive() && existing.identity === identity) {
    if (!remoteViewer) existing.localViewer = true;
    if (!existing.viewers || existing.localViewer) {
      clearTimeout(existing.expiry);
      existing.expiry = setTimeout(() => stopDesktopTunnel(tunnelKey), existing.localViewer ? NATIVE_VIEWER_LIFETIME_MS : REMOTE_VIEWER_GRACE_MS);
      existing.expiry.unref();
    }
    return { joinUrl: existing.joinUrl, state: "running" };
  }
  stopDesktopTunnel(tunnelKey);


  const link = isThisServerVps(alias)
    ? await forwardViewer(connection.privateIp, undefined, screen?.target.viewerPort)
    : await sshViewer((localPort, configPath) => vpsSshTunnelArgs(alias, localPort, connection.privateIp, configPath, screen?.target.viewerPort), (gone) => {
      const active = desktopTunnels.get(tunnelKey);
      if (active?.link === gone) {
        invalidateVpsStatus(`${alias}:${vpsContainerName(botId)}`);
        clearTimeout(active.expiry);
        desktopTunnels.delete(tunnelKey);
      }
    });
  try { requireLiveScreen(botId, screen); } catch (error) { link.stop(); throw error; }
  const joinUrl = `http://127.0.0.1:${link.port}/vnc.html#autoconnect=true&resize=scale&password=${encodeURIComponent(connection.password)}`;
  const expiry = setTimeout(() => stopDesktopTunnel(tunnelKey), remoteViewer ? REMOTE_VIEWER_GRACE_MS : NATIVE_VIEWER_LIFETIME_MS);
  expiry.unref?.();
  desktopTunnels.set(tunnelKey, { link, joinUrl, identity, expiry, viewers: 0, localViewer: !remoteViewer });
  return { joinUrl, state: "running" };
}

/** Loopback CDP for one running bot desktop; the optional container id pins a turn to the computer it mounted. */
export async function vpsBoxChrome(cfg: AppConfig, botId: string, expectedContainerId?: string, runner: VpsCommandRunner = defaultRunner, screen?: VpsScreenConnection): Promise<string | null> {
  const alias = vpsSshAlias(snapshotVpsConfig(cfg));
  requireLiveScreen(botId, screen);
  const cacheKey = screenKey(botId, screen);
  const known = boxChromes.get(cacheKey);
  if (!alias) { known?.close(); boxChromes.delete(cacheKey); return null; }
  const status = await vpsComputerStatus(cfg, botId, runner);
  requireLiveScreen(botId, screen);
  const containerId = status.container_id;
  if (!status.ready || status.desktop !== "bot-desktop" || !containerId || (expectedContainerId !== undefined && containerId !== expectedContainerId)) {
    known?.close();
    boxChromes.delete(cacheKey);
    return null;
  }
  if (known?.alias === alias && known.containerId === containerId) return known.url;
  known?.close();
  boxChromes.delete(cacheKey);
  if (screen) await ensureVpsScreenBrowser(runner, alias, containerId, screen.target, { requireLive: () => requireLiveScreen(botId, screen) });
  const relayEnv = isThisServerVps(alias) ? process.env : { ...process.env, PATH: prepareVpsSsh(DATA_DIR, augmentedPath()).path };
  const relay = await boxChromeRelay(() => spawn("docker", vpsDockerArgs(alias, boxChromeExecArgs(containerId, screen?.target)), {
    shell: false, stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: relayEnv,
  }), () => {
    invalidateVpsStatus(`${alias}:${vpsContainerName(botId)}`);
    evictVpsBoxChrome(cacheKey, relay.url);
  });
  try { requireLiveScreen(botId, screen); } catch (error) { relay.close(); throw error; }
  const current = boxChromes.get(cacheKey);
  if (current && current.alias === alias && current.containerId === containerId) { relay.close(); return current.url; }
  current?.close();
  boxChromes.set(cacheKey, { alias, containerId, ...relay });
  return relay.url;
}

export function vpsContainerMcpArgs(alias: string, containerName: string, screen?: IndependentScreenTarget): string[] {
  if (!isValidSshAlias(alias) || (!CONTAINER_NAME.test(containerName) && !CONTAINER_ID.test(containerName))) {
    throw new Error("invalid VPS MCP connection");
  }
  if (screen) independentScreenExecArgs(containerName, "ensure", screen);
  return vpsDockerArgs(
    alias,
    cuaExecArgs(["mcp", "--socket", screen?.socket ?? CUA_SOCKET], { container: containerName, interactive: true }),
  );
}

export function vpsComputerMcp(cfg: AppConfig, botId: string, containerRef?: string, screen?: VpsScreenConnection): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const alias = vpsSshAlias(cfg);
  if (!alias) throw new Error("VPS is not configured — add an SSH config alias first");
  if (screen) { screenKey(botId, screen); if (containerRef !== screen.containerId) throw new Error("Independent screen container changed"); }
  return {
    command: process.execPath,
    args: [SPAWNED_PROXIES.vpsContainerMcp, alias, containerRef ?? vpsContainerName(botId), ...(screen ? [JSON.stringify(screen.target)] : [])],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

export async function vpsComputerScreenshot(
  cfg: AppConfig,
  botId: string,
  runner: VpsCommandRunner = defaultRunner,
  screen?: VpsScreenConnection,
): Promise<VpsScreenshot> {
  cfg = snapshotVpsConfig(cfg);
  const alias = vpsSshAlias(cfg);
  if (!alias) throw Object.assign(new Error("VPS is not configured"), { status: 409 });
  const key = `${alias}:${vpsContainerName(botId)}`;
  requireLiveScreen(botId, screen);
  const pendingKey = screenKey(key, screen);
  const pending = pendingScreenshots.get(pendingKey);
  if (pending) return pending;
  const cacheable = runner === defaultRunner;
  const deadline = Date.now() + SCREENSHOT_BUDGET_MS;
  const workDeadline = deadline - SCREENSHOT_CLEANUP_BUDGET_MS;
  let budgetExpired = false;
  const timeoutError = () => Object.assign(new Error("The VPS screen preview timed out. Retry the preview when the connection recovers."), { status: 504 });
  // Await the runner's termination grace: racing it would release the lock before cleanup.
  const boundedRunner: VpsCommandRunner = async (args, options = {}) => {
    const remaining = workDeadline - Date.now() - COMMAND_TIMEOUT_KILL_GRACE_MS;
    if (remaining <= 0) { budgetExpired = true; throw timeoutError(); }
    try {
      const result = await runner(args, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 120_000, remaining) });
      if (Date.now() >= workDeadline) { budgetExpired = true; throw timeoutError(); }
      return result;
    } catch (error) {
      if (Date.now() >= workDeadline - COMMAND_TIMEOUT_KILL_GRACE_MS) budgetExpired = true;
      throw budgetExpired ? timeoutError() : error;
    }
  };
  const capture = withVpsLifecycleLock(key, async () => {
    const cached = cacheable ? statusCache.get(key) : undefined;
    const pendingStatus = cacheable ? pendingStatuses.get(key) : undefined;
    let statusTimer: ReturnType<typeof setTimeout> | undefined;
    const status =
      cached && cached.expiresAt > Date.now()
        ? cached.status
        : pendingStatus
          ? await Promise.race([
            pendingStatus,
            new Promise<never>((_resolve, reject) => {
              statusTimer = setTimeout(() => {
                invalidateVpsStatus(key);
                reject(timeoutError());
              }, Math.max(0, workDeadline - Date.now()));
              statusTimer.unref?.();
            }),
          ]).finally(() => { if (statusTimer) clearTimeout(statusTimer); })
          : await computeVpsComputerStatus(cfg, botId, boundedRunner);
    if (budgetExpired) {
      if (cacheable) statusCache.delete(key);
      throw timeoutError();
    }
    if (screen && status.container_id !== screen.containerId) throw Object.assign(new Error("The independent screen container changed"), { status: 409 });
    if (!status.ready) {
      if (cacheable) statusCache.delete(key);
      throw Object.assign(new Error(status.problem ?? "The VPS computer is not ready"), { status: 409 });
    }
    const containerRef = status.container_id ?? status.container_name;
    // The ref goes straight into docker argv: revalidate it.
    if (!CONTAINER_ID.test(containerRef) && !CONTAINER_NAME.test(containerRef)) {
      throw Object.assign(new Error("the VPS container reference is malformed"), { status: 409 });
    }
    requireLiveScreen(botId, screen);
    let frame: VpsScreenshot;
    try {
      await boundedRunner(
        vpsDockerArgs(
          alias,
          cuaExecArgs(
            ["call", "get_desktop_state", "{}", "--socket", screen?.target.socket ?? CUA_SOCKET, "--screenshot-out-file", SCREENSHOT_PATH],
            { container: containerRef },
          ),
        ),
        { timeoutMs: 30_000 },
      );
      const encoded = (await boundedRunner(vpsDockerArgs(alias, [
        "exec",
        "-u",
        "cua",
        "-e",
        "HOME=/home/cua",
        containerRef,
        "sh",
        "-c",
        SCREENSHOT_TRANSFER,
        "openmausbot-preview",
        SCREENSHOT_PATH,
      ]), { timeoutMs: 30_000 })).stdout.trim();
      const checked = wholeScreenshot(Buffer.from(encoded, "base64"));
      if (!checked.ok) throw Object.assign(new Error("Cua Driver returned an incomplete VPS screenshot"), { status: 502 });
      frame = { png: encoded, format: checked.mime === "image/jpeg" ? "jpeg" : "png" };
    } catch (error) {
      if (cacheable) statusCache.delete(key);
      throw error;
    } finally {
      const cleanupMs = Math.min(5_000, deadline - Date.now() - COMMAND_TIMEOUT_KILL_GRACE_MS);
      if (cleanupMs > 0) await runner(vpsDockerArgs(alias, ["exec", "-u", "cua", containerRef, "rm", "-f", SCREENSHOT_PATH]), {
        timeoutMs: cleanupMs,
      }).catch(() => {});
    }
    if (cacheable) statusCache.set(key, { status, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
    requireLiveScreen(botId, screen);
    return frame;
  });
  pendingScreenshots.set(pendingKey, capture);
  try { return await capture; }
  finally { if (pendingScreenshots.get(pendingKey) === capture) pendingScreenshots.delete(pendingKey); }
}
