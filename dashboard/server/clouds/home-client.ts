import { createHash, createHmac, randomBytes } from "node:crypto";
import type { HomeClient } from "./types.ts";
import { boundedJson } from "./http.ts";

export function signCloudRequest(secret: string, timestamp: string, nonce: string, method: string, target: string, body: string | Buffer): string {
  const hash = createHash("sha256").update(body).digest("base64url");
  return createHmac("sha256", secret).update(`v1\n${timestamp}\n${nonce}\n${method}\n${target}\n${hash}`).digest("base64url");
}

export function createHomeClient(options: { fetch?: typeof fetch; now?: () => number; random?: (size: number) => Buffer } = {}): HomeClient {
  const fetcher = options.fetch ?? fetch, now = options.now ?? Date.now, random = options.random ?? randomBytes;
  async function request(origin: string, secret: string, method: string, target: string, body = ""): Promise<unknown> {
    try {
      const url = new URL(origin);
      if (origin !== url.origin || url.username || url.password || (!options.fetch && (url.protocol !== "https:" || !url.hostname.includes("."))) || (options.fetch && !["https:", "http:"].includes(url.protocol))) throw new Error();
      const timestamp = String(Math.floor(now() / 1000)), nonce = random(24).toString("base64url");
      if (!/^[A-Za-z0-9_-]{22,128}$/.test(nonce)) throw new Error();
      const response = await fetcher(`${origin}${target}`, {
        method, redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json", "x-omb-cloud-timestamp": timestamp, "x-omb-cloud-nonce": nonce, "x-omb-cloud-signature": `v1=${signCloudRequest(secret, timestamp, nonce, method, target, body)}` },
        ...(method === "POST" ? { body } : {}),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      return await boundedJson(response, method === "POST" ? 4096 : 65_536);
    } catch { throw new Error("Cloud home request failed."); }
  }
  return {
    async pair(origin, secret, input) {
      const value = await request(origin, secret, "POST", "/api/cloud/pairing", JSON.stringify(input)) as { code?: unknown; expiresAt?: unknown } | null;
      if (!value || typeof value.code !== "string" || !/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(value.code) || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= now() || (value.expiresAt as number) > now() + 600_000) throw new Error("Invalid cloud pairing answer.");
      return { code: value.code, expiresAt: value.expiresAt as number };
    },
    async healthy(origin, secret) {
      try {
        const answer = await request(origin, secret, "GET", "/api/cloud/health?after=0") as { v?: unknown } | null;
        return answer?.v === 1;
      } catch { return false; }
    },
  };
}
