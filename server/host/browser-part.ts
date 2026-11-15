// The packaged app's built-in browser when its installer leaves it out: fetched on the first open, waited for by a
// turn that needs it, shown in that bot's chat as one progress line. The download never holds the workspace (no 409s):
// it writes only to the app's shared parts folder, never to a workspace.
import { existsSync, readFileSync } from "node:fs";
import { browserBundlePaths } from "../browser-bundle-release.ts";
import { browserPartPending } from "../browser-engine.ts";
import { createPartsDownloader, partsRoot, readPartsManifest, type PartSpec, type PartState, type PartsDownloader } from "../app-parts.ts";

export interface BrowserPartFrame {
  kind: "browser-part";
  phase: "download" | "setup" | "failed" | "ready";
  received: number;
  total: number;
  /** bots that needed the browser since it is not here yet; their chats show the line */
  botIds: string[];
}

export interface BrowserPartHost {
  pending(): boolean;
  downloading(): boolean;
  start(): void;
  retry(): void;
  /** A turn that needs the browser waits here; false when the download failed (it keeps retrying by itself). */
  waitFor(botId: string): Promise<boolean>;
  stop(): void;
}

/** A downloaded browser must be the bundle this app pins for this machine before anything in it runs. */
export function checkBrowserPart(part: Pick<PartSpec, "target">, directory: string, target = `${process.platform}-${process.arch}`): void {
  if (part.target !== target) throw new Error(`the browser part is for ${part.target}, not ${target}`);
  const paths = browserBundlePaths(directory, target);
  for (const file of [paths.manifest, paths.engine, paths.chrome, paths.licenses]) {
    if (!existsSync(file)) throw new Error("the browser part is incomplete");
  }
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8")) as { target?: unknown };
  if (manifest.target !== target) throw new Error("the browser part's manifest names another machine");
}

const NONE: BrowserPartHost = {
  pending: () => false, downloading: () => false, start() {}, retry() {}, waitFor: async () => true, stop() {},
};

export function createBrowserPartHost(deps: {
  env?: NodeJS.ProcessEnv;
  broadcast(frame: BrowserPartFrame): void;
  /** the part arrived: the browser settings and the bots' tools see it */
  onReady(): void;
  log?(line: string): void;
  downloader?: (spec: Parameters<typeof createPartsDownloader>[0]) => PartsDownloader;
  throttleMs?: number;
}): BrowserPartHost {
  const env = deps.env ?? process.env;
  let manifest;
  try { manifest = readPartsManifest(env); }
  catch (error) { deps.log?.(`app parts: ${(error as Error).message}`); return NONE; }
  const root = partsRoot(env);
  if (!manifest || !root || !manifest.parts.some((part) => part.name === "browser")) return NONE;

  const needed = new Set<string>();
  let last: PartState = { phase: "waiting" };
  let sentAt = 0;
  const throttle = deps.throttleMs ?? 500;
  const frame = (): BrowserPartFrame | null => {
    if (last.phase === "waiting") return null;
    const total = "total" in last ? last.total : 0;
    const received = "received" in last ? last.received : total;
    return { kind: "browser-part", phase: last.phase, received, total, botIds: [...needed] };
  };
  const send = (force: boolean) => {
    const next = frame();
    if (!next || (needed.size === 0 && next.phase !== "ready")) return;
    const now = Date.now();
    if (!force && now - sentAt < throttle) return;
    sentAt = now;
    deps.broadcast(next);
  };

  const downloader = (deps.downloader ?? createPartsDownloader)({
    manifest,
    root,
    check: (part, directory) => checkBrowserPart(part, directory),
    log: deps.log,
    onChange: (name, state) => {
      if (name !== "browser") return;
      const changed = state.phase !== last.phase;
      last = state;
      if (state.phase === "ready") {
        send(true);
        needed.clear();
        deps.onReady();
      } else send(changed);
    },
  });

  return {
    pending: () => browserPartPending(env),
    downloading: () => last.phase === "download" || last.phase === "setup",
    start: () => downloader.start(),
    retry: () => downloader.retry("browser"),
    async waitFor(botId) {
      if (!browserPartPending(env)) return true;
      needed.add(botId);
      const ready = downloader.ready("browser");
      send(true);
      return ready;
    },
    stop: () => downloader.stop(),
  };
}
