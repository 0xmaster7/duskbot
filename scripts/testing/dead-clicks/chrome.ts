// A headless Chrome for Testing driven over CDP, for the dead-click crawl: one tab, evaluate, navigate and wait.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { waitForExit } from "../../../server/testing/cleanup.ts";

export interface ChromeTab {
  evaluate<T = unknown>(expression: string): Promise<T>;
  navigate(url: string, ready: string, timeoutMs?: number): Promise<void>;
  viewport(width: number, height: number): Promise<void>;
  errors: string[];
  close(): Promise<void>;
}

export async function openChrome(binary: string, home: string): Promise<ChromeTab> {
  const profile = join(home, "dead-clicks-chrome");
  mkdirSync(profile, { recursive: true });
  const chrome: ChildProcess = spawn(binary, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--password-store=basic", "--use-mock-keychain", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, stdio: "ignore",
  });
  const portFile = join(profile, "DevToolsActivePort");
  for (let tries = 0; !existsSync(portFile); tries++) {
    if (tries > 300) throw new Error("dead-click Chrome did not start");
    await new Promise((done) => setTimeout(done, 100));
  }
  const [port, endpoint] = readFileSync(portFile, "utf8").trim().split("\n");
  const socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const errors: string[] = [];
  let next = 0;
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data));
    if (value.method === "Runtime.exceptionThrown") errors.push(String(value.params?.exceptionDetails?.exception?.description ?? value.params?.exceptionDetails?.text).split("\n")[0]!);
    const waiting = pending.get(value.id);
    if (!waiting) return;
    pending.delete(value.id);
    if (value.error) waiting.reject(new Error(value.error.message)); else waiting.resolve(value.result);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("dead-click Chrome connection failed")), { once: true });
  });
  let sessionId: string | undefined;
  const request = (method: string, params: unknown = {}): Promise<any> => {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`dead-click Chrome ${method} timed out`)); }, 60_000);
      pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  };
  const target = await request("Target.createTarget", { url: "about:blank" });
  sessionId = (await request("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await request("Page.enable");
  await request("Runtime.enable");
  // a reload must not leave the run on a native "leave site?" prompt
  await request("Page.addScriptToEvaluateOnNewDocument", { source: "window.onbeforeunload = null; addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true);" });
  await request("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value as T;
  };
  return {
    evaluate,
    errors,
    async viewport(width, height) { await request("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); },
    async navigate(url, ready, timeoutMs = 60_000) {
      await request("Page.navigate", { url });
      const until = Date.now() + timeoutMs;
      while (!(await evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(ready)}))`).catch(() => false))) {
        if (Date.now() > until) throw new Error(`${url} never showed ${ready}`);
        await new Promise((done) => setTimeout(done, 200));
      }
      await evaluate("document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 300)))");
    },
    async close() {
      socket.close();
      if (chrome.exitCode === null) { chrome.kill(); await waitForExit(chrome).catch(() => undefined); }
    },
  };
}
