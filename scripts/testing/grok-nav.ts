// How a person reaches the places the one grok layout keeps off the sidebar:
// Automations, the Team map and the Inbox from Settings > Advanced features >
// Bots, bot Templates from Connect apps. Every step goes by accessible name.
import { expect } from "vitest";

type Ui = (verb: string, ...args: string[]) => Promise<Record<string, any>>;
type Ref = { name: string; role: string };

/** Menus and dialogs slide in; a click mid-motion lands where the target was a frame ago, so wait for still frames. */
export async function settled(ui: Ui): Promise<void> {
  await ui("eval", "--js", `new Promise((done) => {
    const until = performance.now() + 2000;
    const tick = () => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity) || performance.now() > until ? done(true) : setTimeout(tick, 16);
    tick();
  })`);
}

/** Click the one element with this role (or a button or menuitem) and name, once React has painted it. */
export async function clickByName(ui: Ui, name: string | RegExp, role?: string, timeout = 10_000): Promise<void> {
  let matches: Array<[string, Ref]> = [];
  const roles = role ? [role] : ["button", "menuitem"];
  let page = "";
  await expect.poll(async () => {
    const state = await ui("snapshot");
    page = state.snapshot as string;
    matches = Object.entries(state.refs as Record<string, Ref>).filter(([, entry]) => roles.includes(entry.role)
      && (typeof name === "string" ? entry.name === name : name.test(entry.name)));
    return matches.length;
  }, { timeout, message: `one ${roles.join("/")} named ${String(name)}` }).toBe(1).catch((error: Error) => {
    if (process.env.TRACE_UI) console.log(page);
    throw error;
  });
  await settled(ui);
  await ui("click", "--ref", `@${matches[0]![0]}`);
}

/** The ref of the one `role "name"` inside the snapshot node whose line contains `container` (e.g. `dialog "Ben"`):
 * the sidebar keeps a button of the same name beside a dialog's own. */
export async function refWithin(ui: Ui, container: string, name: string, role = "button", timeout = 10_000): Promise<string> {
  let refs: string[] = [];
  await expect.poll(async () => {
    const lines = ((await ui("snapshot")).snapshot as string).split("\n");
    const at = lines.findIndex((line) => line.includes(container));
    refs = [];
    if (at < 0) return 0;
    const depth = lines[at]!.search(/\S/);
    for (const line of lines.slice(at + 1)) {
      if (line.search(/\S/) <= depth) break;
      const ref = line.includes(`${role} ${JSON.stringify(name)}`) ? line.match(/ref=(e\d+)/)?.[1] : undefined;
      if (ref) refs.push(ref);
    }
    return refs.length;
  }, { timeout, message: `one ${role} named ${name} in ${container}` }).toBe(1);
  return `@${refs[0]}`;
}

/** A notice card (a GitHub star ask, a Cloud offer) sits over the sidebar's footer; a person closes it first. */
export async function dismissNotices(ui: Ui): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const label = (await ui("eval", "--js", "document.querySelector('aside[data-notice] button[aria-label]')?.getAttribute('aria-label') ?? null")).result as string | null;
    if (!label) return;
    await clickByName(ui, label, "button");
    await expect.poll(async () => (await ui("eval", "--js", `[...document.querySelectorAll('aside[data-notice] button[aria-label]')].some(button => button.getAttribute('aria-label') === ${JSON.stringify(label)})`)).result).toBe(false);
  }
}

/** You > Settings, then a pane of its rail: General, Permissions, Models, Advanced features... */
export async function openSettings(ui: Ui, pane?: string): Promise<void> {
  await dismissNotices(ui);
  await clickByName(ui, "You", "button");
  await clickByName(ui, "Settings", "menuitem");
  if (pane) await clickByName(ui, pane, "button");
}

/** Settings > Advanced features > one of its pages: "Bots", "Apps and Tools", "Privacy and Data"... */
export async function openAdvancedSettings(ui: Ui, page: string): Promise<void> {
  await openSettings(ui, "Advanced features");
  await clickByName(ui, new RegExp(`^${page.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `), "button");
}

/** The Open button in the Bots page's row of this title; every row's button is named Open, so the row's group names it. */
export async function openFromBotsSettings(ui: Ui, row: "Inbox" | "Automations" | "Team map" | "Files"): Promise<void> {
  await openAdvancedSettings(ui, "Bots");
  await expect.poll(async () => (await ui("snapshot")).snapshot as string, { timeout: 10_000 }).toContain(`group "${row}"`);
  const { snapshot, refs } = await ui("snapshot") as { snapshot: string; refs: Record<string, Ref> };
  const lines = snapshot.split("\n");
  const at = lines.findIndex((line) => line.includes(`group "${row}"`));
  const open = lines.slice(at + 1).find((line) => /button "Open" \[.*ref=(e\d+)/.test(line));
  const ref = open?.match(/ref=(e\d+)/)?.[1];
  expect(ref && refs[ref]?.name).toBe("Open");
  // the pane wipes in from the side; a click mid-wipe opens the row beside it
  const button = `document.querySelector('[data-settings-open=${row.toLowerCase().replace(" ", "-")}]')`;
  await expect.poll(async () => (await ui("eval", "--js", `new Promise((done) => { const at = () => { const r = ${button}?.getBoundingClientRect(); return r ? [r.left, r.top].join() : null; };
    const first = at(); setTimeout(() => done(first !== null && first === at()), 250); })`)).result, { timeout: 10_000, message: `${row} row still` }).toBe(true);
  await ui("click", "--ref", `@${ref}`);
}

export async function openTeamMap(ui: Ui): Promise<void> {
  await openFromBotsSettings(ui, "Team map");
  await expect.poll(async () => (await ui("eval", "--js", "Boolean(document.querySelector('[data-team-canvas]'))")).result, { timeout: 10_000 }).toBe(true);
}

export async function openAutomations(ui: Ui): Promise<void> {
  await openFromBotsSettings(ui, "Automations");
}

/** Connect apps > Bot templates: the Templates library with its Explore, Import, From a folder and Share tabs. */
export async function openTemplates(ui: Ui): Promise<void> {
  await dismissNotices(ui);
  await clickByName(ui, "Connect apps", "button");
  await clickByName(ui, "Bot templates", "button", 15_000);
  await expect.poll(async () => (await ui("snapshot")).snapshot as string, { timeout: 20_000 }).toContain('dialog "Templates"');
}
