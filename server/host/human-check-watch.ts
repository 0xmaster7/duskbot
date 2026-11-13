// A human check card (request_sign_in with human_check) hands back by itself: the page behind it is read every few
// seconds, and once the check is gone the card settles as done and the bot carries on, so nobody has to press Done.
// Reading only: nothing here clicks, types or answers a check.
import { classifyChallenge, PROBE_EXPRESSION, type PageProbe } from "../browser/cdp/settle.ts";
import type { Surface } from "../../shared/wire.ts";
import { openBoxLoginPage } from "../box-login-page.ts";

export interface HumanCheckRef { botId: string; threadId: string; messageId: string; site: string; place: Surface }

/** The settle probe plus whether a check widget on the page already holds its answer token. */
export const HUMAN_CHECK_PAGE = `(() => {
  const probe = ${PROBE_EXPRESSION};
  const answered = [...document.querySelectorAll('input[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]')]
    .some((field) => typeof field.value === "string" && field.value.length > 0);
  return JSON.stringify({ ...probe, answered });
})()`;

export type HumanCheckPage = PageProbe & { answered?: boolean };

const WIDGET = /^https:\/\/(?:challenges\.cloudflare\.com\/|(?:www\.google\.com|www\.recaptcha\.net)\/recaptcha\/|(?:[\w-]+\.)?hcaptcha\.com\/)/u;

/** "check" while a check still waits on someone, "clear" once it is gone or answered; a block is not a check. */
export function humanCheckState(page: HumanCheckPage, frameUrls: readonly string[] = []): "check" | "clear" | "blocked" {
  const challenge = classifyChallenge(page, frameUrls);
  if (challenge?.state === "blocked") return "blocked";
  if (challenge) return "check";
  // an invisible reCAPTCHA sits on many ordinary pages and never asks anyone anything
  const widget = [...page.iframes, ...frameUrls].some((url) => WIDGET.test(url) && !/[?&]size=invisible\b/u.test(url));
  return widget && !page.answered ? "check" : "clear";
}

/** The page an engine's eval answered with, or null when it gave nothing readable. */
export function parseHumanCheckPage(value: unknown): HumanCheckPage | null {
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const page = value as Partial<HumanCheckPage> | null;
  if (!page || typeof page !== "object" || typeof page.title !== "string" || !Array.isArray(page.iframes) || !Array.isArray(page.scripts) || !Array.isArray(page.selectors)) return null;
  return { title: page.title, text: String(page.text ?? ""), textLength: Number(page.textLength) || 0, nodes: Number(page.nodes) || 0, controls: Number(page.controls) || 0,
    busy: page.busy === true, scripts: page.scripts.map(String), iframes: page.iframes.map(String), selectors: page.selectors.map(String), answered: page.answered === true };
}

export const CHECK_POLL_MS = 2_500;
/** Long enough for someone to notice the card; after it Done stays the way. */
export const CHECK_WATCH_MS = 20 * 60_000;
/** Two clear reads in a row, so the gap while the site swaps documents is not taken for the end of the check. */
const CLEAR_READS = 2;

export interface HumanCheckWatchDeps {
  /** The page in the place the card names, or null when it cannot be read there now. */
  read(ref: HumanCheckRef): Promise<HumanCheckPage | null>;
  /** Whether the card still waits on the person. */
  waits(ref: HumanCheckRef): boolean;
  /** Settles the card as done: the place goes back to the bot and its turn resumes. */
  cleared(ref: HumanCheckRef): void;
  pollMs?: number;
  limitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export function createHumanCheckWatch(deps: HumanCheckWatchDeps) {
  const pollMs = deps.pollMs ?? CHECK_POLL_MS;
  const limitMs = deps.limitMs ?? CHECK_WATCH_MS;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()));
  const watching = new Set<string>();

  async function run(ref: HumanCheckRef): Promise<void> {
    const until = now() + limitMs;
    let clearReads = 0;
    while (now() < until) {
      await sleep(pollMs);
      if (!deps.waits(ref)) return;
      const page = await deps.read(ref).catch(() => null);
      if (!page) { clearReads = 0; continue; }
      clearReads = humanCheckState(page) === "clear" ? clearReads + 1 : 0;
      if (clearReads >= CLEAR_READS) {
        if (deps.waits(ref)) deps.cleared(ref);
        return;
      }
    }
  }

  /** One watch per card; a card asked again keeps the watch it has. */
  function watch(ref: HumanCheckRef): Promise<void> {
    if (watching.has(ref.messageId)) return Promise.resolve();
    watching.add(ref.messageId);
    return run(ref)
      .catch((error: unknown) => deps.log?.(`human check on ${ref.site}: watching the page stopped (${error instanceof Error ? error.message : String(error)})`))
      .finally(() => watching.delete(ref.messageId));
  }

  return { watch, watching: (messageId: string) => watching.has(messageId) };
}

/** The page behind a check card: the bot's browser, or the front page of its own VPS desktop's Chromium; null elsewhere. */
export async function readHumanCheckPage(ref: HumanCheckRef, deps: {
  browserEval(ref: HumanCheckRef, expression: string): Promise<unknown>;
  boxChrome(botId: string): Promise<string | false | null>;
  open?: typeof openBoxLoginPage;
}): Promise<HumanCheckPage | null> {
  if (ref.place === "browser") return parseHumanCheckPage(await deps.browserEval(ref, HUMAN_CHECK_PAGE));
  if (ref.place !== "cloud") return null;
  const url = await deps.boxChrome(ref.botId);
  if (!url) return null;
  const page = await (deps.open ?? openBoxLoginPage)(url);
  if ("refusal" in page) return null;
  try { return parseHumanCheckPage((await page.input.engine(["eval", HUMAN_CHECK_PAGE]))?.result); }
  finally { page.close(); }
}
