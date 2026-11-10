// A routine's probe check (Routine.probe): plain code reads one public page, feed or price before any AI turn. The same
// reading as last time is nothing new and wakes no model; a change becomes one run, and the reading is kept only once
// that run's answer is, so a run that fails sees the change again. A read that fails is a failed check, never "nothing
// new", and says so once per streak. State is a hash or a price and a few item ids per routine (routine-probes.json).
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { RoutineProbe } from "../shared/routines.ts";
import { writeFileAtomic } from "./atomic.ts";
import { clean, recordsBlock, recordsText } from "./records-block.ts";
import type { Routine, RoutineCheckResult, RoutineChecks, RoutineRun } from "./routines.ts";
import { fetchPublicPage, pageText, type PublicPage } from "./wait-probes.ts";

export const PROBES_FILE = "routine-probes.json";
const KEY_PREFIX = "prb-";
const EXCERPT = 6_000;
const FEED_ITEMS = 30;
const PENDING_MS = 3 * 60 * 60_000;

/** What one read found: `value` is what is compared (a hash, a price), `items` a feed's newest item ids. */
export interface ProbeReading {
  value: string;
  items?: Array<{ id: string; title: string; link?: string }>;
  text?: string;
  price?: string;
}

interface Kept {
  url: string;
  kind: RoutineProbe["kind"];
  value: string;
  seen?: string[];
  price?: string;
  at: number;
  failing?: true;
  pending?: Record<string, { at: number; value: string; seen?: string[]; price?: string }>;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'" };
const unescape = (text: string) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name: string) => ENTITY[name]!).trim();
const tag = (block: string, name: string): string | undefined => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return match ? unescape(match[1]!) : undefined;
};

/** A feed's newest items, RSS or Atom: each by its guid, id or link. */
export function feedItems(xml: string): NonNullable<ProbeReading["items"]> {
  const items: NonNullable<ProbeReading["items"]> = [];
  for (const match of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const block = match[2]!;
    const href = /<link[^>]*\bhref=["']([^"']+)["']/i.exec(block)?.[1];
    const link = tag(block, "link") || href;
    const id = tag(block, "guid") || tag(block, "id") || link || tag(block, "title");
    if (id) items.push({ id: id.slice(0, 500), title: (tag(block, "title") ?? "").slice(0, 300), ...(link ? { link: link.slice(0, 1_000) } : {}) });
    if (items.length >= FEED_ITEMS) break;
  }
  return items;
}

/** The page's price: its structured data first (JSON-LD, microdata, Open Graph), else the first amount with a currency
 * sign in its words. Null when there is none. */
export function pagePrice(html: string, text: string): string | null {
  const structured = /"price"\s*:\s*"?(\d[\d,]*(?:\.\d+)?)"?/.exec(html)?.[1] ??
    /itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i.exec(html)?.[1] ??
    /property=["'](?:product|og):price:amount["'][^>]*content=["']([\d.,]+)["']/i.exec(html)?.[1];
  const currency = /"priceCurrency"\s*:\s*"([A-Z]{3})"/.exec(html)?.[1];
  if (structured) return currency ? `${structured} ${currency}` : structured;
  const shown = /([$€£₹¥])\s?(\d[\d,]*(?:\.\d{1,2})?)/.exec(text);
  return shown ? `${shown[1]}${shown[2]}` : null;
}

export function readingOf(probe: RoutineProbe, page: Extract<PublicPage, { ok: true }>): ProbeReading | { error: string } {
  const body = page.body.toString("utf8");
  if (probe.kind === "feed") {
    const items = feedItems(body);
    return items.length ? { value: sha(items.map((item) => item.id).join("\n")), items } : { error: "It has no feed items to read." };
  }
  const text = pageText(body);
  if (probe.kind === "price") {
    const price = pagePrice(body, text);
    return price ? { value: price, price } : { error: "No price could be found on it." };
  }
  return text ? { value: sha(text), text } : { error: "The page has no words to compare." };
}

export interface RoutineProbesDeps {
  dataDir: string;
  now?: () => number;
  fetch?: (url: string) => Promise<PublicPage>;
  /** Once per streak of failed reads: the person hears it, so a probe that cannot read never looks quiet. */
  failed?(routine: Routine, sentence: string): void;
}

export function createRoutineProbes(deps: RoutineProbesDeps) {
  const file = join(deps.dataDir, PROBES_FILE);
  const now = deps.now ?? Date.now;
  const fetchPage = deps.fetch ?? ((url: string) => fetchPublicPage(url));
  let state: Record<string, Kept> = {};
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) state = value as Record<string, Kept>;
  } catch { /* none yet */ }

  const save = () => {
    try { writeFileAtomic(file, `${JSON.stringify(state)}\n`, { mode: 0o600 }); }
    catch (error) { console.warn(`probes: could not save ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const ownerOf = (key: string): Kept | undefined => Object.values(state).find((kept) => kept.pending?.[key]);
  const host = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

  function prompt(routine: Routine, probe: RoutineProbe, kept: Kept, reading: ProbeReading, newItems: NonNullable<ProbeReading["items"]>): string {
    const source = `${host(probe.url)}, a public web page`;
    const lines = [routine.prompt.trim(), ""];
    if (probe.kind === "price") {
      lines.push(`The routine's price check found that the price at ${probe.url} changed from ${clean(kept.price ?? kept.value, 60)} to ${clean(reading.price!, 60)}.`);
    } else if (probe.kind === "feed") {
      lines.push(`The routine's feed check found ${newItems.length} new item${newItems.length === 1 ? "" : "s"} in ${probe.url}:`,
        recordsBlock(source, newItems.map((item) => `${item.title || "(untitled)"}${item.link ? ` · ${item.link}` : ""}`)));
    } else {
      lines.push(`The routine's page check found that ${probe.url} changed since the last check. What it says now:`, recordsText(source, reading.text!.slice(0, EXCERPT)));
    }
    lines.push("If the change does not matter for these instructions, answer with one short line saying so.");
    return lines.join("\n");
  }

  const checks: RoutineChecks = {
    async check(routine, context): Promise<RoutineCheckResult> {
      const probe = routine.probe;
      if (!probe) return {};
      if (context.hold) return { held: true };
      let kept: Kept | undefined = state[routine.id];
      if (kept && (kept.url !== probe.url || kept.kind !== probe.kind)) kept = undefined;
      for (const [key, pending] of Object.entries(kept?.pending ?? {})) if (now() - pending.at > PENDING_MS) delete kept!.pending![key];
      // a run already holds a change: it is that run's to answer
      if (kept?.pending && Object.keys(kept.pending).length) return { held: true };
      const page = await fetchPage(probe.url);
      const reading = page.ok ? readingOf(probe, page) : { error: page.error };
      if ("error" in reading) {
        const sentence = `Couldn't check ${host(probe.url)}: ${reading.error}`;
        if (kept && !kept.failing) { kept.failing = true; save(); deps.failed?.(routine, sentence); }
        else if (!kept) { state[routine.id] = { url: probe.url, kind: probe.kind, value: "", at: now(), failing: true }; save(); deps.failed?.(routine, sentence); }
        return { trouble: sentence };
      }
      const seen = reading.items?.map((item) => item.id);
      // the first good read is the baseline: nothing to compare yet
      if (!kept || !kept.value) {
        state[routine.id] = { url: probe.url, kind: probe.kind, value: reading.value, at: now(), ...(seen ? { seen } : {}), ...(reading.price ? { price: reading.price } : {}) };
        save();
        return {};
      }
      if (kept.failing) delete kept.failing;
      const fresh = reading.items?.filter((item) => !kept!.seen?.includes(item.id)) ?? [];
      const changed = probe.kind === "feed" ? fresh.length > 0 : reading.value !== kept.value;
      if (!changed) {
        kept.at = now();
        if (seen) kept.seen = seen;
        save();
        return {};
      }
      const key = `${KEY_PREFIX}${randomUUID()}`;
      kept.pending = { [key]: { at: now(), value: reading.value, ...(seen ? { seen } : {}), ...(reading.price ? { price: reading.price } : {}) } };
      save();
      return { run: { key, prompt: prompt(routine, probe, kept, reading, fresh) } };
    },
    release(key) {
      const kept = ownerOf(key);
      if (!kept) return;
      delete kept.pending![key];
      save();
    },
    settled(run: RoutineRun) {
      const key = run.checkKey;
      const kept = key ? ownerOf(key) : undefined;
      if (!key || !kept) return;
      const pending = kept.pending![key]!;
      if (run.status === "completed") Object.assign(kept, { value: pending.value, at: now() }, pending.seen ? { seen: pending.seen } : {}, pending.price ? { price: pending.price } : {});
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "missed") {
        delete kept.pending![key];
        save();
      }
    },
  };
  return checks;
}

/** One set of checks for the routine manager: a routine with a probe goes to the probe, every other to `inner`. */
export function withProbes(inner: RoutineChecks | undefined, probes: RoutineChecks): RoutineChecks {
  return {
    check: (routine, context) => routine.checks?.includes("probe") ? probes.check(routine, context) : inner?.check(routine, context) ?? Promise.resolve({}),
    release: (key) => (key.startsWith(KEY_PREFIX) ? probes.release(key) : inner?.release(key)),
    settled: (run) => (run.checkKey?.startsWith(KEY_PREFIX) ? probes.settled(run) : inner?.settled(run)),
  };
}
