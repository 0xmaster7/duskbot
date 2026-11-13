// The surfaces gallery's layout guard: every settings page, every bot panel tab, the dialogs and sheets the store opens,
// and the first-run steps a browser gets, in the real app on desktop and phone widths, checked by the chat gallery's
// layout audit (scoped to the open surface). Screenshots go to DUSK_GALLERY_DIR (default
// .dusk-scratch/verify-evidence/chat-gallery), beside the chat cards'.
//
//   DUSK_UI_E2E=1 pnpm exec vitest run scripts/testing/surface-gallery.e2e.test.ts
//   DUSK_SURFACES_ONLY=settings:appearance,panel:soul  narrows the run.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlDusk, type VerificationServer } from "../control-dusk.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { ensureUiBrowser } from "./control-dusk-ui.ts";
import { fixtureApi, mountPreview, REPO_ROOT, type MountedPreview } from "./preview-fixture.ts";
import { connect } from "./chat-gallery/cdp.ts";
import type { LayoutIssue } from "./chat-gallery/layout-audit.ts";
import type { AppSettingsSection, BotSettingsSection } from "../../src/state/store.tsx";
import { NOTICES } from "../../src/lib/notices.ts";

const enabled = process.env.DUSK_UI_E2E === "1";
if (!enabled) console.log("skipping the surfaces gallery: set DUSK_UI_E2E=1 for isolated browser qualification");

const SETTINGS: AppSettingsSection[] = [
  "general", "appearance", "looks", "bots", "engines", "connections", "apps", "computer", "logins", "usage", "people", "botAccess",
  "activity", "backups", "skills", "import", "updates", "texting", "permissions", "advanced", "data", "builder", "about", "transfer",
  "experimental", "companion", "remote", "desktopWorkspaces", "organization", "cloudAccount",
];
const PANEL: BotSettingsSection[] = [
  "overview", "identity", "slack", "soul", "skills", "memory", "library", "routines", "access", "model", "permissions", "voice",
  "visibility", "history", "usage", "computer",
];
/** Store actions that open a dialog or sheet of their own. */
const DIALOGS: Record<string, string> = {
  shortcuts: `{ type: "toggleShortcuts", open: true }`,
  "connect-apps": `{ type: "togglePlugins", open: true, surface: "apps" }`,
  "mcp-servers": `{ type: "togglePlugins", open: true, surface: "mcp" }`,
  computer: `{ type: "toggleComputer", open: true }`,
  "cloud-add": `{ type: "openCloudAdd", source: "app_menu" }`,
  "cloud-how-to": `{ type: "cloudHowTo", open: true }`,
  "welcome-replay": `{ type: "toggleWelcome", open: true }`,
};
/** What a browser's first run shows (place, bring, phone and making need the desktop app's bridge). */
const ONBOARDING = ["welcome", "account", "ai"];

const VIEWPORTS = [
  { id: "desktop", width: 1280, height: 860, touch: false },
  { id: "phone", width: 390, height: 844, touch: true },
] as const;
const ONLY = process.env.DUSK_SURFACES_ONLY?.split(",");
const DIALOG_SCOPE = `[role=dialog], [role=alertdialog], [aria-modal=true]`;

type Surface = { id: string; open: string | null; onboarding?: string; scope: string };
const SURFACES: Surface[] = [
  ...SETTINGS.map((section) => ({ id: `settings:${section}`, open: `{ type: "toggleAppSettings", open: true, section: "${section}" }`, scope: DIALOG_SCOPE })),
  ...PANEL.map((section) => ({ id: `panel:${section}`, open: `{ type: "toggleSettings", open: true, section: "${section}", botId: window.__surfaceGallery.botId }`, scope: DIALOG_SCOPE })),
  ...Object.entries(DIALOGS).map(([id, action]) => ({ id: `dialog:${id}`, open: action, scope: id === "computer" ? "#root" : DIALOG_SCOPE })),
  ...ONBOARDING.map((step) => ({ id: `onboarding:${step}`, open: null, onboarding: step, scope: "[data-welcome]" })),
].filter((surface) => !ONLY || ONLY.includes(surface.id));

(enabled ? it : it.skip)("draws every settings page, panel tab, dialog and first-run step without overlap or clipping", async () => {
  let fixture: VerificationServer | undefined;
  let preview: MountedPreview | undefined;
  // a brand-new install for the first-run steps: nothing welcomed, no bot made
  let fresh: VerificationServer | undefined;
  let freshPreview: MountedPreview | undefined;
  let chrome: ChildProcess | undefined;
  let cdp: Awaited<ReturnType<typeof connect>> | undefined;
  const evidence = process.env.DUSK_GALLERY_DIR || join(process.env.DUSK_UI_EVIDENCE_DIR || join(REPO_ROOT, ".dusk-scratch", "verify-evidence"), "chat-gallery");
  mkdirSync(evidence, { recursive: true });
  const report: Array<{ shot: string; opened: boolean; issues: LayoutIssue[]; probe?: unknown }> = [];
  try {
    const tools = await ensureUiBrowser();
    if (!tools.chrome) throw new Error("the gallery needs the pinned Chrome for Testing");
    fixture = await launchVerificationServer(process.env);
    const api = fixtureApi(fixture.info.url);
    await api("PATCH", "/api/config", { language: "en" });
    const { bots } = await api("GET", "/api/bots");
    for (const bot of bots.filter((bot: { defaultBot?: unknown }) => bot.defaultBot)) await api("PATCH", `/api/bots/${bot.id}`, { welcomed: true });
    await runControlDusk(["new-bot", "--name", "Pepper", "--url", fixture.info.url]);
    preview = await mountPreview(fixture, { entry: "/scripts/testing/surface-gallery-preview.tsx", route: "/__surface-gallery.html", title: "Surfaces gallery", logLevel: "warn", hmr: false });
    if (SURFACES.some((surface) => surface.onboarding)) {
      fresh = await launchVerificationServer(process.env);
      await fixtureApi(fresh.info.url)("PATCH", "/api/config", { language: "en" });
      freshPreview = await mountPreview(fresh, { entry: "/scripts/testing/surface-gallery-preview.tsx", route: "/__surface-gallery-fresh.html", title: "Surfaces gallery, first run", logLevel: "warn", hmr: false });
    }
    const profile = join(fixture.info.dataDir, "chrome");
    mkdirSync(profile, { recursive: true });
    const mouse = "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2";
    chrome = spawn(tools.chrome, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--password-store=basic", "--use-mock-keychain", "--hide-scrollbars", mouse, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
      env: { PATH: process.env.PATH, HOME: fixture.info.dataDir, USERPROFILE: fixture.info.dataDir, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, stdio: "ignore",
    });
    const portFile = join(profile, "DevToolsActivePort");
    await expect.poll(() => existsSync(portFile), { timeout: 30_000 }).toBe(true);
    const [port, endpoint] = readFileSync(portFile, "utf8").trim().split("\n");
    cdp = await connect(`ws://127.0.0.1:${port}${endpoint}`);
    const target = await cdp.request("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.request("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const request = (method: string, params: unknown = {}) => cdp!.request(method, params, sessionId);
    const evaluate = async (expression: string) => {
      const response = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    await request("Page.enable");
    await request("Runtime.enable");
    await request("Page.addScriptToEvaluateOnNewDocument", { source: `try { for (const notice of ${JSON.stringify(NOTICES)}) localStorage.setItem(notice, "1"); } catch {}` });
    await request("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const errors: string[] = [];
    let current = "";
    cdp.on((method, params) => {
      if (method === "Runtime.exceptionThrown") errors.push(`${current}: ${params.exceptionDetails?.exception?.description?.split("\n")[0] ?? params.exceptionDetails?.text}`);
      if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        const text = params.args?.map((arg: any) => arg.value ?? arg.description ?? "").join(" ") ?? "";
        if (/error occurred in|Maximum update depth|Each child in a list|Encountered two children/.test(text)) errors.push(`${current}: ${text.split("\n")[0]}`);
      }
    });

    for (const viewport of VIEWPORTS) {
      if (viewport.touch) await request("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      for (const surface of SURFACES) {
        const shot = `surface-${surface.id.replace(":", "-")}-${viewport.id}`;
        current = shot;
        await request("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.touch });
        // each surface from a clean start: an open panel or a settings page must not carry over to the next
        await evaluate(`try { localStorage.clear(); sessionStorage.clear(); } catch {} true`).catch(() => undefined);
        await request("Page.navigate", { url: surface.onboarding ? `${freshPreview!.previewUrl}?onboarding=${surface.onboarding}` : preview.previewUrl });
        await expect.poll(() => evaluate(`Boolean(window.__surfaceGallery?.ready)`).catch(() => false), { timeout: 120_000 }).toBe(true);
        let opened = true;
        if (surface.onboarding) opened = await expect.poll(() => evaluate(`document.querySelector("[data-welcome]")?.getAttribute("data-welcome")`), { timeout: 15_000 }).toBe(surface.onboarding).then(() => true, () => false);
        if (surface.open) {
          await evaluate(`window.__surfaceGallery.dispatch(${surface.open}); true`);
          opened = await expect.poll(() => evaluate(`document.querySelectorAll(${JSON.stringify(surface.scope)}).length > 0`), { timeout: 15_000 }).toBe(true).then(() => true, () => false);
        }
        await evaluate(`document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 700)))`);
        const issues: LayoutIssue[] = opened ? await evaluate(`window.__galleryAudit({ touch: ${viewport.touch}, focus: ${viewport.id === "desktop"}, scopeSelector: ${JSON.stringify(surface.scope)} })`) : [];
        const { data } = await request("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(evidence, `${shot}.png`), Buffer.from(data, "base64"));
        const probe = process.env.DUSK_GALLERY_PROBE ? await evaluate(process.env.DUSK_GALLERY_PROBE) : undefined;
        report.push({ shot, opened, issues, ...(probe === undefined ? {} : { probe }) });
      }
    }
    writeFileSync(join(evidence, "surfaces-report.json"), JSON.stringify(report, null, 2));
    const hard = report.flatMap(({ shot, issues }) => issues.filter((issue) => issue.hard).map((issue) => `${shot}: ${issue.kind} ${issue.where}: ${issue.detail}`));
    expect(errors).toEqual([]);
    expect(hard).toEqual([]);
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) { chrome.kill(); await waitForExit(chrome).catch(() => undefined); }
    await preview?.close();
    await freshPreview?.close();
    await fixture?.close();
    await fresh?.close();
  }
}, 1_800_000);
