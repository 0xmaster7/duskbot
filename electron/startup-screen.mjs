import { fileURLToPath } from 'node:url';
import { BOOT_MASCOT_CSS, bootMascotSvg } from './startup-mascot.mjs';

/** How long a page that shows its own waiting mascot keeps the splash up before it takes over. */
export const BOOT_SHELL_HANDOFF_MS = 600;
/** The ring gets this long to close before the app shows anyway. */
export const RING_CLOSE_LIMIT_MS = 900;
export const CROSSFADE_MS = 280;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The app fades in over the splash while the splash fades out, eased out. */
async function crossfade(win, splash) {
  const start = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - start) / CROSSFADE_MS), eased = 1 - (1 - t) ** 3;
    if (win.isDestroyed()) return;
    win.setOpacity(eased);
    if (!splash.isDestroyed()) splash.setOpacity(1 - eased);
    if (t === 1) return;
    await wait(16);
  }
}

export function startupScreenHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>OpenMaus Bot</title><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:Segoe UI,system-ui,sans-serif;color:#f5f5f5;background:transparent}
  main{height:100%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid #ffffff16;border-radius:20px;background:radial-gradient(ellipse at 50% 22%,#242529 0,#161719 54%,#111214 100%);-webkit-app-region:drag}
  .ring{position:relative;width:104px;height:104px;display:grid;place-items:center;margin-bottom:16px}
  .ring>svg:first-child{position:absolute;inset:0;transform:rotate(-90deg)}
  .ring circle{fill:none;stroke-width:2.5}.ring .track{stroke:#ffffff12}.ring .fill{stroke:#e8e9ec;stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:100}
  h1{font-size:25px;line-height:1.25;font-weight:600;letter-spacing:-.6px;margin:0 0 26px}
  .status{display:flex;align-items:center;gap:9px;color:#999da5;font-size:12px;line-height:18px}
  button{position:absolute;right:13px;top:13px;width:30px;height:30px;display:grid;place-items:center;padding:0;color:#999da5;border:0;border-radius:7px;background:transparent;cursor:pointer;-webkit-app-region:no-drag}
  button:hover{color:#fff;background:#ffffff10}button:focus-visible{outline:2px solid #1686ff;outline-offset:2px}button svg{pointer-events:none}
  ${BOOT_MASCOT_CSS}
  </style></head><body><main><button aria-label="Close" onclick="window.startupScreen.close()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="ring"><svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true"><circle class="track" cx="52" cy="52" r="50"/><circle class="fill" cx="52" cy="52" r="50" pathLength="100"/></svg>${bootMascotSvg({ size: 64, id: 'splash-mascot' })}</div><h1>OpenMaus Bot</h1><div class="status" role="status">Opening your workspace…</div></main><script>${RING_SCRIPT}</script></body></html>`;
}

// the ring creeps on its own so it never stalls, never passes 94% until main says the app is ready, then closes the circle
const RING_SCRIPT = `(() => {
  const fill = document.querySelector('.ring .fill'), start = performance.now();
  let shown = 0, goal = 0, finished = null, finish = null;
  const frame = now => {
    if (finish) shown += (1 - shown) * 0.14;
    else shown += Math.max(0, Math.min(0.94, Math.max(goal, 0.9 * (1 - Math.exp(-(now - start) / 2600)))) - shown) * 0.06;
    if (finish && 1 - shown < 0.004) shown = 1;
    fill.style.strokeDashoffset = String(100 - shown * 100);
    if (shown === 1) { setTimeout(finish, 160); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.ring = {
    to: value => { goal = Math.max(goal, value); },
    done: () => finished ??= new Promise(resolve => { finish = resolve; }),
  };
})();`;

export function createStartupScreen({
  BrowserWindow, iconPath, platform = process.platform, isQuitting, onQuit,
  onHide, isHidden = () => false, onShow, onFinished,
}) {
  let disposed = false, revealed = false, fallback, resolveReady;
  // window opacity is a no-op on Linux, so there the app just appears
  const canFade = win => platform !== "linux" && typeof win.setOpacity === "function";
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const splash = new BrowserWindow({
    width: 440, height: 300, resizable: false, maximizable: false,
    fullscreenable: false, frame: false, transparent: true,
    backgroundColor: "#00000000", show: false, icon: iconPath,
    title: "OpenMaus Bot", autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: fileURLToPath(new URL("./startup-screen-preload.cjs", import.meta.url)),
    },
  });
  splash.setMenu(null);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(fallback);
    resolveReady();
    if (!splash.isDestroyed()) splash.destroy();
    onFinished?.();
  };
  splash.on("close", event => {
    if (disposed || isQuitting()) return;
    event.preventDefault();
    if (platform === "win32" && onHide) onHide(splash);
    else onQuit();
  });
  // Renderer window.close() bypasses BrowserWindow's cancellable close path, so the page asks for the native one.
  splash.webContents.on("ipc-message", (_event, channel) => {
    if (channel === "startup-screen:close" && !disposed) splash.close();
  });
  let shown = false;
  const showSplash = () => {
    if (shown || disposed || isQuitting()) return;
    shown = true; splash.show(); resolveReady();
  };
  splash.once("ready-to-show", showSplash);
  // Some Wayland compositors (COSMIC) never paint a hidden window, so ready-to-show never comes.
  splash.webContents.once("did-finish-load", () => {
    const grace = setTimeout(showSplash, 500);
    grace.unref?.();
  });
  splash.on("show", () => onShow?.(splash));
  splash.once("closed", resolveReady);
  // The splash stays until the main window replaces it: as the only window, destroying it would quit the app.
  splash.webContents.once("render-process-gone", resolveReady);
  let said = null;
  const say = () => {
    if (said === null || disposed || splash.isDestroyed()) return;
    void splash.webContents.executeJavaScript(`(() => { const line = document.querySelector('.status'); if (line?.lastChild) line.lastChild.textContent = ${JSON.stringify(said)}; })()`).catch(() => {});
  };
  splash.webContents.on("did-finish-load", say);
  const startupFallback = setTimeout(resolveReady, 10_000);
  startupFallback.unref?.();
  void splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(startupScreenHtml()))
    .catch(resolveReady);
  const ring = (code) => splash.isDestroyed() ? Promise.resolve() : splash.webContents.executeJavaScript(code).catch(() => {});
  const attach = (win, { maximized = false } = {}) => {
    void ring("window.ring?.to(0.55)");
    const reveal = () => {
      if (revealed || win.isDestroyed() || isQuitting()) return;
      revealed = true;
      const minimized = !splash.isDestroyed() && splash.isMinimized();
      if (isHidden()) {
        win.setSkipTaskbar(true);
        win.hide();
        if (maximized) win.once("show", () => win.maximize());
      } else {
        if (maximized) win.maximize();
        if (minimized) { win.showInactive(); win.minimize(); }
        else if (canFade(win) && splash.isVisible?.()) { void closeRingThenFade(win); return; }
        else { win.show(); win.focus(); }
      }
      dispose();
    };
    const closeRingThenFade = async (win) => {
      await Promise.race([ring("window.ring?.done()"), wait(RING_CLOSE_LIMIT_MS)]);
      if (win.isDestroyed() || isQuitting()) { dispose(); return; }
      win.setOpacity(0); win.show(); win.focus();
      await crossfade(win, splash);
      if (!win.isDestroyed()) win.setOpacity(1);
      dispose();
    };
    win.webContents.on("did-finish-load", () => {
      void ring("window.ring?.to(0.8)");
      if (revealed || win.isDestroyed() || isQuitting()) return;
      void win.webContents.executeJavaScript(`new Promise(resolve => {
        const root = document.getElementById('root');
        if (!root || root.childElementCount) { resolve(); return; }
        const observer = new MutationObserver(() => {
          if (root.childElementCount) { observer.disconnect(); resolve(); }
        });
        observer.observe(root, { childList: true });
        if (document.getElementById('boot-shell')) setTimeout(resolve, ${BOOT_SHELL_HANDOFF_MS});
      })`).then(reveal).catch(reveal);
    });
    win.webContents.once("render-process-gone", reveal);
    win.once("show", () => { if (!revealed) { revealed = true; dispose(); } });
    win.once("closed", dispose);
    fallback = setTimeout(reveal, 10_000);
    fallback.unref?.();
  };
  /** The line under the name, in place of "Opening your workspace…". */
  const status = (text) => { said = String(text); say(); };
  return { ready, attach, dispose, status, window: splash };
}
