// Draws the store screenshot set from the phone app itself, in a headless Chrome at each store size, against the
// built-in demo workspace (sample data, no server, no account).
//
//   pnpm mobile:preview --fixture                    (in another terminal; any phone preview address works)
//   node --experimental-strip-types apps/mobile/scripts/store-shots.ts http://127.0.0.1:5320 docs/store/ios
//
// These are the app's real screens at the stores' pixel sizes, but a browser draws no iOS status bar and no home
// indicator. For the listing, retake them in the simulator once a runtime is installed (docs/mobile-readiness.md).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openHeadlessChrome, type HeadlessPage } from "../../../scripts/testing/headless-chrome.ts";

const [base = "http://127.0.0.1:5320", out = "docs/store/ios"] = process.argv.slice(2);
/** css points and scale per store size: 6.9 inch is 1320 x 2868, 6.5 inch is 1284 x 2778 */
const SIZES = [{ name: "6.9", width: 440, height: 956, scale: 3 }, { name: "6.5", width: 428, height: 926, scale: 3 }];

const click = (page: HeadlessPage, expression: string) => page.evaluate(`(() => { const el = ${expression}; if (!el) return false; el.click(); return true; })()`);
const row = (name: string) => `[...document.querySelectorAll("button")].find((button) => button.textContent.includes(${JSON.stringify(name)}))`;

async function type(page: HeadlessPage, text: string) {
  await page.evaluate(`(() => {
    const field = document.querySelector("[data-mobile-chat] textarea");
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await delay(300);
  for (const kind of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type: kind, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}

for (const size of SIZES) {
  const profile = mkdtempSync(join(tmpdir(), "dusk-store-shots-"));
  const page = await openHeadlessChrome(profile);
  const dir = join(out, size.name);
  mkdirSync(dir, { recursive: true });
  const shot = async (name: string) => { await delay(900); writeFileSync(join(dir, `${name}.png`), await page.capture()); console.log(`${dir}/${name}.png`); };
  const open = async (scheme: "light" | "dark", storage: Record<string, string>) => {
    await page.send("Page.navigate", { url: `${base}/?frame=1&scheme=${scheme}` });
    await delay(1500);
    await page.evaluate(`localStorage.clear(); for (const [key, value] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem(key, value); location.reload()`);
    await delay(2500);
  };
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: true });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.send("Page.enable");

    await open("light", { "omb.mobile.demo": "1", "omb.mobile.introSeen": "1" });
    await page.until(`document.body.textContent.includes("Launch room")`, 30_000);
    await shot("01-your-team");

    await click(page, row("Quill"));
    await page.until(`Boolean(document.querySelector("[data-mobile-chat] textarea"))`, 20_000);
    await delay(1200);
    await type(page, "Yes, send it to the team");
    await page.until(`document.querySelector("[data-mobile-chat]").textContent.includes("demo")`, 20_000);
    await shot("02-text-a-bot");
    await click(page, `document.querySelector("[data-mobile-chat] nav button")`);
    await delay(1000);

    await click(page, row("Launch room"));
    await page.until(`document.querySelector("[data-mobile-chat]")?.textContent.includes("Friday is on")`, 20_000);
    // the page mounts offscreen and then slides in
    await delay(1600);
    await shot("03-rooms");
    await click(page, `document.querySelector("[data-mobile-chat] nav button")`);
    await delay(1000);

    await open("dark", { "omb.mobile.demo": "1", "omb.mobile.introSeen": "1" });
    await page.until(`document.body.textContent.includes("Launch room")`, 30_000);
    await shot("04-dark");

    await page.send("Page.navigate", { url: `${base}/?frame=1&pair=1&scheme=dark` });
    await delay(1500);
    await page.evaluate(`localStorage.clear(); localStorage.setItem("omb.mobile.introSeen", "1"); location.reload()`);
    await page.until(`document.body.textContent.includes("Scan")`, 20_000);
    await shot("05-pair-with-your-computer");
  } finally {
    page.close();
    // chrome is still writing its profile for a moment after it is told to quit
    await delay(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}
