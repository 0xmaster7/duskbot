// Waits a person makes without thinking, before the templates group's clicks.
import { expect } from "vitest";

import { dismissNotices, openTemplates } from "./grok-nav.ts";

type Ui = (verb: string, ...args: string[]) => Promise<Record<string, any>>;

const button = (text: string) => `[...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)})`;

/** Until this button is where the pointer lands: a closing dialog or the sidebar's 5 s import toast can still cover it.
 * Notice cards stay until closed, so close them first. */
export async function waitUncovered(ui: Ui, text: string): Promise<void> {
  await dismissNotices(ui);
  await expect.poll(async () => (await ui("eval", "--js", `(() => { const button = ${button(text)}; if (!button) return false;
    const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })()`)).result,
  { timeout: 15_000, message: `${text} uncovered` }).toBe(true);
}

/** Until this button stops moving: a Settings pane wipes in, and a click mid-wipe lands on its neighbour. */
export async function waitStill(ui: Ui, text: string): Promise<void> {
  await expect.poll(async () => (await ui("eval", "--js", `new Promise(done => { const at = () => { const r = ${button(text)}?.getBoundingClientRect(); return r ? [r.left, r.top].join() : null; };
    const first = at(); setTimeout(() => done(first !== null && first === at()), 250); })`)).result,
  { timeout: 10_000, message: `${text} still` }).toBe(true);
}

/** Connect apps > Bot templates once the sidebar's footer takes the pointer again. */
export async function openTemplatesWhenFree(ui: Ui): Promise<void> {
  await waitUncovered(ui, "Connect apps");
  await openTemplates(ui);
}
