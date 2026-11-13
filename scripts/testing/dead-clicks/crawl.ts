// The dead-click crawl: from a starting screen, press every control (probe.ts) and follow every layer a press opens (a
// menu, a dialog, a sheet, a panel, a settings section) up to three presses deep, reopening the screen between presses
// so each control is pressed from the same state. Page-agnostic: the caller supplies how to evaluate in the page and
// how to reopen the starting screen (CDP for the gallery and the app in CI, Playwright for the desktop app locally).
import { installDeadClickProbe, type ClickResult, type ClickTarget } from "./probe.ts";

export interface CrawlPage {
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** Reload the starting screen from scratch (navigate, wait for it to draw). */
  open(): Promise<void>;
}

export interface DeadClick { surface: string; key: string; html: string }

export interface CrawlReport {
  surfaces: Array<{ name: string; scope: string; path: string[]; targets: number }>;
  pressed: number;
  skipped: Array<{ surface: string; key: string; why: string }>;
  dead: DeadClick[];
}

/** Presses that would reach outside the test: the OS (pickers, microphone, Finder), a real browser, money, or the end of
 * the session. The live desktop app needs these skipped; the CI page has no such reach and passes a narrower list. */
export const UNSAFE_IN_APP = /microphone|dictat|voice|\bcalls?\b|camera|screen record|attach|upload|choose file|import|finder|folder|reveal|in browser|open link|website|docs|help center|learn more|privacy|terms|download|export|update now|install|add files|photo|image|share screen|feedback|report a problem|github|quit|sign ?out|log ?out|uninstall|restart|relaunch|buy|checkout|upgrade|subscribe|\bpay\b|delete|remove|erase|reset|switch server|forget|disconnect|unpair|archive|move to|scan|qr/i;

const LAYERS = "[role=dialog],[role=menu],[role=listbox],[aria-modal=true],[data-panel-slot=open]";
const PROBE = `(${installDeadClickProbe.toString()})()`;

const json = (value: unknown) => JSON.stringify(value);

export async function crawlDeadClicks(page: CrawlPage, options: {
  name: string;
  scope?: string;
  unsafe?: RegExp;
  /** How many screens (the start and every layer or state found) to sweep at most. */
  budget?: number;
  depth?: number;
  waitMs?: number;
  /** Also sweep the same place again when a press swaps its controls (a settings section, a tab, a step). */
  states?: boolean;
  log?: (line: string) => void;
}): Promise<CrawlReport> {
  const { unsafe = UNSAFE_IN_APP, budget = 40, depth = 3, waitMs = 1000, states = true, log = () => {} } = options;
  const ensure = async () => { if (!(await page.evaluate<boolean>("Boolean(window.__deadClicks)"))) await page.evaluate(PROBE); };
  const targets = async (scope: string) => { await ensure(); return page.evaluate<ClickTarget[]>(`window.__deadClicks.targets(${json(scope)})`).catch(() => [] as ClickTarget[]); };
  const press = (key: string, scope: string, wait: number) => page.evaluate<ClickResult>(`window.__deadClicks.press(${json(key)}, ${json(scope)}, ${wait})`);
  const layers = () => page.evaluate<string[]>(`[...document.querySelectorAll(${json(LAYERS)})].filter((e) => e.getBoundingClientRect().width > 0).map((e) => {
    if (e.hasAttribute("data-panel-slot")) return "[data-panel-slot=open]";
    const role = e.getAttribute("role"); const label = e.getAttribute("aria-label");
    return role ? '[role="' + role + '"]' + (label ? '[aria-label=' + JSON.stringify(label) + ']' : "") : "[aria-modal=true]";
  })`).catch(() => [] as string[]);
  const enter = async (path: Array<{ key: string; scope: string }>) => {
    await page.open();
    await ensure();
    for (const step of path) {
      await press(step.key, step.scope, 500).catch(() => undefined);
      await ensure();
    }
  };

  const queue = [{ name: options.name, path: [] as Array<{ key: string; scope: string }>, scope: options.scope ?? "body" }];
  const seen = new Set<string>([queue[0]!.scope]);
  const report: CrawlReport = { surfaces: [], pressed: 0, skipped: [], dead: [] };
  while (queue.length && report.surfaces.length < budget) {
    const surface = queue.shift()!;
    await enter(surface.path);
    const baseLayers = await layers();
    const baseline = await targets(surface.scope);
    const baseKeys = baseline.map((target) => target.key);
    report.surfaces.push({ name: surface.name, scope: surface.scope, path: surface.path.map((step) => step.key), targets: baseline.length });
    log(`${surface.name}: ${baseline.length} controls`);
    for (const target of baseline) {
      const why = target.skipped ?? (unsafe.test(target.name) ? "reaches outside the test" : null);
      if (why) { report.skipped.push({ surface: surface.name, key: target.key, why }); continue; }
      let keys = (await targets(surface.scope)).map((one) => one.key);
      if (!keys.includes(target.key)) { await enter(surface.path); keys = (await targets(surface.scope)).map((one) => one.key); }
      if (!keys.includes(target.key)) continue;
      const result = await press(target.key, surface.scope, waitMs).catch((error: Error) => ({ key: target.key, effects: [`error ${error.message.slice(0, 80)}`] }) as ClickResult);
      report.pressed += 1;
      if (!result.missing && !result.covered && !result.chosen && result.effects.length === 0) {
        report.dead.push({ surface: surface.name, key: target.key, html: target.html });
        log(`dead: ${surface.name} ${target.key}`);
      }
      const opened = await layers();
      const now = (await targets(surface.scope)).map((one) => one.key);
      if (surface.path.length < depth) {
        const next = [...surface.path, { key: target.key, scope: surface.scope }];
        for (const layer of opened) {
          if (baseLayers.includes(layer) || seen.has(layer)) continue;
          seen.add(layer);
          queue.push({ name: `${surface.name} > ${target.name}`.slice(0, 140), path: next, scope: layer });
        }
        // the same place showing other controls (a settings section, a tab, a step) is a screen of its own
        const fresh = now.filter((key) => !baseKeys.includes(key));
        const state = `${surface.scope}::${fresh.slice(0, 6).join("|")}`;
        if (states && fresh.length >= 3 && !seen.has(state)) {
          seen.add(state);
          queue.push({ name: `${surface.name} > ${target.name}`.slice(0, 140), path: next, scope: surface.scope });
        }
      }
      if (now.join("|") !== baseKeys.join("|") || opened.join("|") !== baseLayers.join("|")) await enter(surface.path);
    }
  }
  return report;
}
