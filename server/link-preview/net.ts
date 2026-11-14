// SECURITY: a link in chat makes this server fetch an address someone else wrote. Every hop is resolved and every
// address it resolves to must be public (electron/egress-addresses.mjs), the socket is pinned to the address that was
// checked so a DNS rebind cannot swap in a private one, no cookie or credential is ever sent, and bodies are capped
// after decompression.
import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { isPublicAddress } from "../site-icons.ts";

export const MAX_HOPS = 5;
export const HOP_TIMEOUT_MS = 6_000;

export type Resolver = (host: string) => Promise<LookupAddress[]>;

export interface Answer { status: number; location: string | null; type: string; body: Buffer; truncated: boolean }

export interface RequestOptions {
  limit: number;
  /** Keep the first `limit` bytes of a longer body instead of refusing it. */
  partial: boolean;
  accept(type: string): boolean;
  headers: Record<string, string>;
  signal: AbortSignal;
}

/** One GET over a socket to `address` only. */
export type PinnedRequest = (url: URL, address: LookupAddress, options: RequestOptions) => Promise<Answer>;

export type Fetched =
  | { ok: true; url: URL; type: string; body: Buffer; truncated: boolean }
  | { ok: false; reason: "address" | "blocked" | "status" | "type" | "size" | "hops" | "network" };

/** http on 80 or https on 443, with no credentials in the address. */
export function fetchableUrl(url: URL): boolean {
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return url.port === "" || url.port === "443";
  if (url.protocol === "http:") return url.port === "" || url.port === "80";
  return false;
}

const resolveAll: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

export const pinnedRequest: PinnedRequest = (url, address, options) => new Promise((resolve, reject) => {
  // TLS and Host keep the name; only the socket is pinned to the checked address.
  const lookup: LookupFunction = (_host, lookupOptions, callback) => {
    if (lookupOptions.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const request = send(url, {
    method: "GET", agent: false, lookup, signal: options.signal,
    headers: { "accept-encoding": "gzip, deflate, br", ...options.headers },
  }, (response) => {
    const status = response.statusCode ?? 0;
    const location = typeof response.headers.location === "string" ? response.headers.location : null;
    const type = String(response.headers["content-type"] ?? "").toLowerCase();
    const head: Answer = { status, location, type, body: Buffer.alloc(0), truncated: false };
    const declared = Number(response.headers["content-length"]);
    if (status < 200 || status >= 300 || !options.accept(type)) { response.destroy(); resolve(head); return; }
    if (!options.partial && Number.isFinite(declared) && declared > options.limit) { response.destroy(); resolve({ ...head, status: 413 }); return; }
    const encoding = String(response.headers["content-encoding"] ?? "").trim().toLowerCase();
    let stream: Readable = response;
    if (encoding === "gzip" || encoding === "x-gzip") stream = response.pipe(createGunzip());
    else if (encoding === "deflate") stream = response.pipe(createInflate());
    else if (encoding === "br") stream = response.pipe(createBrotliDecompress());
    else if (encoding && encoding !== "identity") { response.destroy(); resolve({ ...head, status: 415 }); return; }
    const chunks: Buffer[] = [];
    let size = 0, done = false;
    const finish = (answer: Answer) => {
      if (done) return;
      done = true;
      response.destroy();
      if (stream !== response) stream.destroy();
      resolve(answer);
    };
    const failed = (error: unknown) => {
      if (done) return;
      if (options.partial && chunks.length) finish({ ...head, body: Buffer.concat(chunks), truncated: true });
      else { done = true; response.destroy(); reject(error); }
    };
    stream.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size <= options.limit) { chunks.push(chunk); return; }
      if (!options.partial) { finish({ ...head, status: 413 }); return; }
      chunks.push(chunk.subarray(0, chunk.length - (size - options.limit)));
      finish({ ...head, body: Buffer.concat(chunks), truncated: true });
    });
    stream.on("end", () => finish({ ...head, body: Buffer.concat(chunks) }));
    stream.on("error", failed);
    response.on("error", failed);
  });
  request.on("error", reject);
  request.end();
});

export interface GuardedGetDeps { resolve?: Resolver; request?: PinnedRequest }

/** GET `start`, following redirects, through public addresses only. */
export async function guardedGet(start: URL, options: RequestOptions, deps: GuardedGetDeps = {}): Promise<Fetched> {
  const resolve = deps.resolve ?? resolveAll;
  const request = deps.request ?? pinnedRequest;
  let url = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!fetchableUrl(url)) return { ok: false, reason: "address" };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: LookupAddress[];
    try {
      addresses = await resolve(host);
    } catch {
      return { ok: false, reason: "network" };
    }
    // every address the name has: one private answer among public ones is a rebind setup
    if (!addresses.length || !addresses.every(({ address }) => isPublicAddress(address))) return { ok: false, reason: "blocked" };
    let answer: Answer;
    try {
      answer = await request(url, addresses[0]!, { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(HOP_TIMEOUT_MS)]) });
    } catch {
      return { ok: false, reason: "network" };
    }
    if (answer.status >= 300 && answer.status < 400) {
      if (!answer.location) return { ok: false, reason: "status" };
      try {
        url = new URL(answer.location, url);
      } catch {
        return { ok: false, reason: "status" };
      }
      continue;
    }
    if (answer.status === 413) return { ok: false, reason: "size" };
    if (answer.status < 200 || answer.status >= 300) return { ok: false, reason: "status" };
    if (!options.accept(answer.type)) return { ok: false, reason: "type" };
    return { ok: true, url, type: answer.type, body: answer.body, truncated: answer.truncated };
  }
  return { ok: false, reason: "hops" };
}
