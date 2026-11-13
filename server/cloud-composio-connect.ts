// Connecting an app on a dusk cloud with no Composio key: the same Composio Connect the desktop app uses by default
// (composio-connect.ts). A cloud has no browser, so the person's own browser (the tab the dashboard opened) signs in to
// Composio once, with the cloud's public address as the OAuth redirect (mcp-oauth.ts, a remote browser); that callback
// then sends the same tab on to the app's own sign-in page. After the first time it goes straight to the app's page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { appSlug } from "../shared/dashboard-protocol.ts";
import { COMPOSIO_CONNECT_URL, composioCallFailure, composioConnectServer, manageAppConnection, type AppConnection } from "./composio-connect.ts";
import type { StoredRemoteMcpServer } from "./mcp-registry.ts";
import type { RemoteMcpSpec } from "./contracts.ts";

export const CLOUD_COMPOSIO_CONNECT_NAME = "composio-connect";
/** a Composio sign-in this old no longer sends its tab on to the app */
const CONTINUE_MS = 15 * 60_000;
/** apps connected this way, so the dashboard's apps report can ask Composio about them */
const APPS_FILE = "composio-connect-apps.json";

export class CloudConnectError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

export interface CloudComposioConnectDeps {
  dataDir: string;
  servers(): Record<string, unknown> | undefined;
  /** adds Composio Connect as an MCP server, turned on */
  add(name: string, url: string): void;
  enable(name: string): void;
  signedIn(name: string, server: StoredRemoteMcpServer): boolean;
  withToken(name: string, server: StoredRemoteMcpServer): Promise<RemoteMcpSpec | null>;
  /** starts the OAuth sign-in for the person's browser, coming back to the cloud's public address */
  startSignIn(name: string, url: string): Promise<{ authorizationUrl: string | null }>;
  manage?: typeof manageAppConnection;
  now?: () => number;
}

const trustedLink = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "composio.dev" || url.hostname.endsWith(".composio.dev")) ? url.toString() : null;
  } catch { return null; }
};

export function createCloudComposioConnect(deps: CloudComposioConnectDeps) {
  const now = deps.now ?? Date.now, manage = deps.manage ?? manageAppConnection;
  const onward = new Map<string, { slug: string; until: number }>();
  const file = join(deps.dataDir, APPS_FILE);
  const tracked = (): string[] => {
    try { const list = JSON.parse(readFileSync(file, "utf8")) as unknown; return Array.isArray(list) ? list.flatMap((s) => appSlug(s) ?? []) : []; } catch { return []; }
  };
  const track = (slug: string) => {
    const list = tracked();
    if (!list.includes(slug)) try { writeFileAtomic(file, JSON.stringify([...list, slug].slice(-200)), { mode: 0o600 }); } catch {}
  };

  /** Composio Connect, added and turned on */
  function server(): { name: string; server: StoredRemoteMcpServer } {
    let found = composioConnectServer(deps.servers());
    if (!found) {
      deps.add(CLOUD_COMPOSIO_CONNECT_NAME, COMPOSIO_CONNECT_URL);
      found = composioConnectServer(deps.servers());
      if (!found) throw new CloudConnectError("Composio could not be added on this cloud. Try again.", 500);
    }
    if (!found.server.enabled) deps.enable(found.name);
    return found;
  }
  async function signedInSpec(found: { name: string; server: StoredRemoteMcpServer }) {
    return deps.signedIn(found.name, found.server) ? deps.withToken(found.name, found.server) : null;
  }
  async function ask(spec: RemoteMcpSpec, slug: string, action: "add" | "list"): Promise<AppConnection> {
    try { return await manage(spec, slug, undefined, action); } catch (error) {
      const failure = composioCallFailure(error);
      throw new CloudConnectError(failure.body.error, failure.status);
    }
  }

  return {
    /** the page the person's browser opens next: the app's sign-in, or Composio's own the first time */
    async connect(input: string): Promise<{ url: string }> {
      const slug = appSlug(input);
      if (!slug) throw new CloudConnectError("This app could not be found.", 400);
      const found = server();
      const spec = await signedInSpec(found);
      if (spec) {
        const answer = await ask(spec, slug, "add");
        track(slug);
        if (answer.status === "started") {
          const url = trustedLink(answer.url);
          if (url) return { url };
          throw new CloudConnectError("Composio sent back a sign-in page dusk bot does not trust.", 502);
        }
        if (answer.status === "connected") throw new CloudConnectError(`${slug} is connected already.`);
        if (answer.status === "failed") throw new CloudConnectError(answer.message, 502);
        throw new CloudConnectError("Composio did not hand back a sign-in page. Try again.", 502);
      }
      // the first time: the person signs in to their own Composio, then the callback sends them on to the app
      const started = await deps.startSignIn(found.name, found.server.url);
      if (!started.authorizationUrl) throw new CloudConnectError("Composio's sign-in did not start. Try again.", 502);
      const state = new URL(started.authorizationUrl).searchParams.get("state");
      if (state) {
        for (const [key, entry] of onward) if (entry.until <= now()) onward.delete(key);
        onward.set(state, { slug, until: now() + CONTINUE_MS });
      }
      return { url: started.authorizationUrl };
    },
    /** after Composio's sign-in came back to this cloud: the app's sign-in page to send that tab on to, if it was one */
    async afterSignIn(search: string): Promise<string | null> {
      const state = new URLSearchParams(search).get("state") ?? "";
      const entry = onward.get(state);
      onward.delete(state);
      if (!entry || entry.until <= now()) return null;
      try {
        const found = server();
        const spec = await signedInSpec(found);
        if (!spec) return null;
        const answer = await ask(spec, entry.slug, "add");
        track(entry.slug);
        return answer.status === "started" ? trustedLink(answer.url) : null;
      } catch { return null; }
    },
    /** apps connected (or being connected) this way, for the dashboard's apps report; null when Composio Connect is not signed in */
    async apps(): Promise<Array<{ slug: string; connected: boolean; pending: boolean }> | null> {
      const found = composioConnectServer(deps.servers());
      const spec = found ? await signedInSpec(found).catch(() => null) : null;
      if (!spec) return null;
      const out: Array<{ slug: string; connected: boolean; pending: boolean }> = [];
      for (const slug of tracked().slice(-40)) {
        const answer = await ask(spec, slug, "list").catch(() => null);
        if (answer?.status === "connected" || answer?.status === "waiting") out.push({ slug, connected: answer.status === "connected", pending: answer.status === "waiting" });
      }
      return out;
    },
  };
}

export type CloudComposioConnect = ReturnType<typeof createCloudComposioConnect>;
