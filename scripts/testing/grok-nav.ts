// How a person reaches the places the one grok layout keeps off the sidebar:
// Automations, the Team map and the Inbox from Settings > Advanced features,
// bot Templates from Connect apps. Every step goes by accessible name.
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

/** Settings > Advanced features > one of its pages: "Bots", "Apps and tools", "Privacy and data"... */
export async function openAdvancedSettings(ui: Ui, page: string): Promise<void> {
  await openSettings(ui, "Advanced features");
  await clickByName(ui, new RegExp(`^${page.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`), "button");
}

/** A row of Advanced features' first card, which opens that place straight away. */
export async function openFromBotsSettings(ui: Ui, row: "Inbox" | "Automations" | "Team map" | "Files"): Promise<void> {
  await openSettings(ui, "Advanced features");
  await clickByName(ui, row, "button");
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

/** The bot's panel: the chat header's pill opens it, unless it is open already. */
export async function openBotPanel(ui: Ui, botName: string): Promise<void> {
  await dismissNotices(ui);
  if ((await ui("eval", "--js", "Boolean(document.getElementById('bot-panel'))")).result !== true) await clickByName(ui, `Open ${botName}'s profile`, "button");
  await expect.poll(async () => (await ui("eval", "--js", "Boolean(document.getElementById('bot-panel'))")).result, { timeout: 10_000 }).toBe(true);
}

/** Panel > Advanced > a row of the bot's settings ("tools", "permissions", "identity", "slack"...): its settings sheet,
 * open at that page. A row's name carries its value, so the row is found by its page. */
export async function openBotSheet(ui: Ui, botName: string, page: string): Promise<void> {
  await openBotPanel(ui, botName);
  await clickByName(ui, "Advanced", "tab");
  const row = `document.querySelector('#bot-panel [data-panel-page=${JSON.stringify(page)}]')`;
  await expect.poll(async () => (await ui("eval", "--js", `Boolean(${row})`)).result, { timeout: 10_000, message: `${page} row` }).toBe(true);
  await settled(ui);
  await ui("eval", "--js", `${row}.click(); true`);
  await expect.poll(async () => (await ui("eval", "--js", `document.querySelector('[data-bot-sheet] [data-bot-sheet-page][aria-current=page]')?.dataset.botSheetPage ?? null`)).result, { timeout: 10_000 }).toBe(page);
}

/** The bot's settings sheet closed, and the panel with it. */
export async function closeBotPanel(ui: Ui): Promise<void> {
  if ((await ui("eval", "--js", "Boolean(document.querySelector('[data-bot-sheet]'))")).result === true) {
    await ui("eval", "--js", "document.querySelector('[data-bot-sheet] .settings-close').click(); true");
    await expect.poll(async () => (await ui("eval", "--js", "Boolean(document.querySelector('[data-bot-sheet]'))")).result).toBe(false);
  }
  if ((await ui("eval", "--js", "Boolean(document.getElementById('bot-panel'))")).result === true) {
    await ui("eval", "--js", "document.querySelector('#bot-panel button[aria-label=\"Close\"]').click(); true");
    await expect.poll(async () => (await ui("eval", "--js", "Boolean(document.getElementById('bot-panel'))")).result, { timeout: 10_000 }).toBe(false);
  }
}

/** The panel's Share menu, which also holds this chat's copy, download, usage, Activity and Inspector. */
export async function openPanelMenu(ui: Ui, botName: string): Promise<void> {
  await openBotPanel(ui, botName);
  await clickByName(ui, "Share and more", "button");
  await expect.poll(async () => (await ui("eval", "--js", "Boolean(document.querySelector('[data-panel-share-menu]'))")).result, { timeout: 10_000 }).toBe(true);
  await settled(ui);
}

/** Another page of the open settings sheet, from its rail. */
export async function sheetPage(ui: Ui, page: string): Promise<void> {
  await ui("eval", "--js", `document.querySelector('[data-bot-sheet] [data-bot-sheet-page=${JSON.stringify(page)}]').click(); true`);
  await expect.poll(async () => (await ui("eval", "--js", `document.querySelector('[data-bot-sheet] [data-bot-sheet-page][aria-current=page]')?.dataset.botSheetPage ?? null`)).result, { timeout: 10_000 }).toBe(page);
}
