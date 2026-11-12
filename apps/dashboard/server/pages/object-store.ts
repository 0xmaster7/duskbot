import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { PAGE_MAX_BYTES } from "../../../../shared/published-page.ts";

export interface ObjectStore {
  put(key: string, body: Buffer, meta: { contentType: string }): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string; etag: string } | null>;
  delete(keys: string[]): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

const hash = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
function safeKey(key: string) {
  // oxlint-disable-next-line no-control-regex -- control characters are what this strips or refuses
  if (!key || key.includes("..") || key.includes("\\") || isAbsolute(key) || key.split("/").some(part => !part || part === ".") || /[\x00-\x1f\x7f]/.test(key)) throw new Error("Invalid object key.");
  return key;
}

export function createMemoryObjectStore(): ObjectStore {
  const objects = new Map<string, { body: Buffer; contentType: string; etag: string }>();
  return {
    async put(key, body, meta) { objects.set(safeKey(key), { body: Buffer.from(body), contentType: meta.contentType, etag: `"${hash(body)}"` }); },
    async get(key) { const object = objects.get(safeKey(key)); return object ? { ...object, body: Buffer.from(object.body) } : null; },
    async delete(keys) { keys.forEach(safeKey); for (const key of keys) objects.delete(key); },
    async list(prefix) { return [...objects.keys()].filter(key => key.startsWith(prefix)).sort(); },
  };
}

export function createFsObjectStore(dir: string): ObjectStore {
  const root = resolve(dir);
  const location = (key: string) => join(root, ...safeKey(key).split("/").map(part => Buffer.from(part).toString("hex")));
  return {
    async put(key, body, meta) {
      const target = location(key);
      await mkdir(target, { recursive: true, mode: 0o700 });
      await writeFile(join(target, "body"), body, { mode: 0o600 });
      await writeFile(join(target, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
    },
    async get(key) {
      const target = location(key);
      try {
        const body = await readFile(join(target, "body")), meta = JSON.parse(await readFile(join(target, "meta.json"), "utf8"));
        if (typeof meta?.contentType !== "string") throw new Error("Invalid object metadata.");
        return { body, contentType: meta.contentType, etag: `"${hash(body)}"` };
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async delete(keys) {
      const targets = keys.map(location);
      for (const target of targets) {
        await rm(join(target, "body"), { force: true });
        await rm(join(target, "meta.json"), { force: true });
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      async function walk(target: string, parts: string[]) {
        let entries;
        try { entries = await readdir(target, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
        if (entries.some(entry => entry.name === "body" && entry.isFile()) && parts.join("/").startsWith(prefix)) keys.push(parts.join("/"));
        for (const entry of entries) if (entry.isDirectory() && /^(?:[a-f0-9]{2})+$/.test(entry.name)) await walk(join(target, entry.name), [...parts, Buffer.from(entry.name, "hex").toString("utf8")]);
      }
      await walk(root, []);
      return keys.sort();
    },
  };
}

const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
export function signS3Request(options: {
  method: string; url: URL | string; region: string; accessKeyId: string; secretAccessKey: string;
  headers?: Record<string, string>; body?: Buffer; date?: string;
}): Record<string, string> {
  const url = new URL(options.url), date = options.date ?? new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""), digest = hash(options.body ?? "");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.headers ?? {})) if (key.toLowerCase() !== "authorization") headers[key.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  headers.host = url.host; headers["x-amz-date"] = date; headers["x-amz-content-sha256"] = digest;
  const names = Object.keys(headers).sort(), signed = names.join(";");
  const query = [...url.searchParams].map(([key, value]) => `${encode(key)}=${encode(value)}`).sort().join("&");
  const canonical = [options.method.toUpperCase(), url.pathname, query, names.map(key => `${key}:${headers[key]}\n`).join(""), signed, digest].join("\n");
  const day = date.slice(0, 8), scope = `${day}/${options.region}/s3/aws4_request`;
  const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${options.secretAccessKey}`, day), options.region), "s3"), "aws4_request");
  const signature = hmac(key, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader(), chunks: Buffer[] = [];
  let size = 0;
  if (!reader) return Buffer.alloc(0);
  try {
    if (Number(response.headers.get("content-length")) > limit) throw new Error();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error();
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch { await reader.cancel().catch(() => {}); throw new Error("S3 response is too large or incomplete."); }
}

function xmlValues(xml: string, tag: string): string[] {
  const values = [...xml.matchAll(new RegExp(`<${tag}>([^<>]*)</${tag}>`, "g"))];
  if (values.length !== [...xml.matchAll(new RegExp(`<${tag}(?:\\s|>)`, "g"))].length || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Invalid S3 listing.");
  return values.map(match => {
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(match[1]!)) throw new Error("Invalid S3 listing.");
    return match[1]!.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity: string) => {
      if (!entity.startsWith("#")) return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity]!;
      const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw new Error("Invalid S3 listing.");
      return String.fromCodePoint(code);
    });
  });
}

export function createS3ObjectStore(options: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; fetch?: typeof fetch }): ObjectStore {
  const endpoint = new URL(options.endpoint), http = options.fetch ?? fetch;
  if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !options.bucket || !options.region || !options.accessKeyId || !options.secretAccessKey) throw new Error("Invalid S3 configuration.");
  function target(key?: string) {
    return new URL(`${endpoint.href.replace(/\/+$/, "")}/${encode(options.bucket)}${key === undefined ? "" : `/${safeKey(key).split("/").map(encode).join("/")}`}`);
  }
  async function request(method: string, url: URL, body?: Buffer, contentType?: string) {
    try {
      const headers = signS3Request({ ...options, method, url, body, headers: contentType ? { "content-type": contentType } : {} });
      const response = await http(url, { method, headers, ...(body ? { body: new Uint8Array(body) } : {}), redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!response.ok && !(method === "GET" && response.status === 404)) { await response.body?.cancel(); throw new Error(); }
      return response;
    } catch { throw new Error("S3 request failed."); }
  }
  return {
    async put(key, body, meta) { if (body.length > PAGE_MAX_BYTES) throw new Error("Object is too large."); const response = await request("PUT", target(key), body, meta.contentType); await boundedBody(response, 65_536); },
    async get(key) {
      const response = await request("GET", target(key));
      if (response.status === 404) { await response.body?.cancel(); return null; }
      const body = await boundedBody(response, PAGE_MAX_BYTES);
      return { body, contentType: (response.headers.get("content-type") ?? "application/octet-stream").slice(0, 256), etag: response.headers.get("etag") ?? `"${hash(body)}"` };
    },
    async delete(keys) { keys.forEach(safeKey); for (const key of keys) await boundedBody(await request("DELETE", target(key)), 65_536); },
    async list(prefix) {
      const keys: string[] = [], seen = new Set<string>();
      let token: string | undefined;
      do {
        const url = target(); url.searchParams.set("list-type", "2"); url.searchParams.set("prefix", prefix);
        if (token !== undefined) url.searchParams.set("continuation-token", token);
        const xml = (await boundedBody(await request("GET", url), 1024 * 1024)).toString("utf8");
        keys.push(...xmlValues(xml, "Key"));
        const next = xmlValues(xml, "NextContinuationToken"), truncated = xmlValues(xml, "IsTruncated");
        if (next.length > 1 || truncated.length !== 1 || !["true", "false"].includes(truncated[0]!) || truncated[0] === "true" && !next[0]) throw new Error("Invalid S3 listing.");
        token = truncated[0] === "true" ? next[0] : undefined;
        if (token !== undefined) { if (seen.has(token) || seen.size >= 1000) throw new Error("Invalid S3 continuation."); seen.add(token); }
        if (keys.length > 100_000 || keys.some(key => !key.startsWith(prefix))) throw new Error("Invalid S3 listing.");
      } while (token !== undefined);
      return keys;
    },
  };
}
