import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** How long a page that shows its own waiting mascot keeps the splash up before it takes over. */
export const BOOT_SHELL_HANDOFF_MS = 600;
export const CROSSFADE_MS = 280;
export const SLOW_AFTER_MS = 8_000;
export const STUCK_AFTER_MS = 45_000;

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

// the scenes are 115 by 77 cells, drawn at 4 css px a cell so they stay sharp at 1x and 2x
const CELL = 4, W = 115 * CELL, H = 77 * CELL;
const art = name => `data:image/png;base64,${readFileSync(fileURLToPath(new URL(`./resources/${name}`, import.meta.url))).toString("base64")}`;

const KIT = {
  body: "M2 2h2v1h-2zM12 2h2v1h-2zM2 3h3v2h-3zM11 3h3v2h-3zM2 5h4v1h-4zM10 5h4v1h-4zM2 6h12v2h-12zM1 8h14v1h-14zM1 9h14v3h-14zM1 12h14v1h-14zM2 13h12v2h-12zM3 15h10v1h-10z",
  eyes: "M4 9h2v3h-2zM10 9h2v3h-2z",
};
const PIP = {
  body: "M5 4h6v1h-6zM4 5h8v1h-8zM3 6h10v1h-10zM2 7h12v4h-12zM2 11h12v2h-12zM3 13h10v1h-10zM4 14h8v1h-8zM5 15h6v1h-6z",
  eyes: "M4 7h2v4h-2zM10 7h2v4h-2z",
};
const BOT = 3;
const sprite = (cls, { body, eyes }, bodyFill, eyeFill) => `<svg class="${cls}" width="${16 * BOT}" height="${16 * BOT}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">`
  + `<path fill="${bodyFill}" d="${body}"/><path class="eyes" fill="${eyeFill}" d="${eyes}"/></svg>`;

export function startupScreenHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>dusk bot</title><style>
  :root{--ease-out:cubic-bezier(.23,1,.32,1);--text:#fafcff;--soft:#fafcffc7;--glass:#0d3a706b;--shade:#06224a66;--go-ink:#1a5aa8;--day:url("${art("startup-day.png")}");--dusk:url("${art("startup-dusk.png")}")}
  @media(prefers-color-scheme:dark){:root{--glass:#33236e66;--shade:#1c124a73;--go-ink:#4b3f9e}}
  *{box-sizing:border-box}
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:var(--text);
    font:13px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  main{position:relative;width:${W}px;height:${H}px;overflow:hidden;border-radius:18px;background:#8fdcfb var(--day) 0 0/${W}px ${H}px no-repeat;image-rendering:pixelated;-webkit-app-region:drag}
  @media(prefers-color-scheme:dark){main{background-color:#c3b6f0;background-image:var(--dusk)}}
  .layer{position:absolute;left:0;image-rendering:pixelated}
  .cloud{top:${30 * CELL}px;width:${12 * CELL}px;height:${4 * CELL}px;opacity:.95;animation:drift 110s linear -40s infinite}
  @keyframes drift{from{transform:translateX(-${16 * CELL}px)}to{transform:translateX(${W + 8}px)}}
  .kit{position:absolute;left:284px;top:${74 * CELL - 16 * BOT}px}
  .pip{position:absolute;left:344px;top:${73 * CELL - 16 * BOT - 3 * BOT}px;animation:float 3.8s ease-in-out infinite alternate}
  .shadow{position:absolute;left:${344 + 2 * BOT}px;top:${74 * CELL - BOT}px;width:${12 * BOT}px;height:${BOT}px;background:#3c7a0e2e;animation:breathe 3.8s ease-in-out infinite alternate}
  .eyes{transform-box:fill-box;transform-origin:50% 50%;animation:blink 5.4s steps(1,end) infinite}
  .pip .eyes{animation-duration:4.6s;animation-delay:-2s}
  @keyframes float{from{transform:translateY(0)}to{transform:translateY(-${2 * BOT}px)}}
  @keyframes breathe{from{transform:scaleX(1);opacity:1}to{transform:scaleX(.75);opacity:.6}}
  @keyframes blink{0%,95%{transform:scaleY(1)}96%,98%{transform:scaleY(.2)}}
  .center{position:absolute;left:0;right:0;top:118px;display:flex;justify-content:center;pointer-events:none}
  .talk{max-width:300px;padding:7px 14px;text-align:center;pointer-events:auto;border-radius:12px;background:var(--glass);-webkit-backdrop-filter:blur(10px) saturate(1.2);backdrop-filter:blur(10px) saturate(1.2);-webkit-app-region:no-drag;animation:arrive 500ms var(--ease-out) 120ms both}
  @keyframes arrive{from{opacity:0;transform:translateY(4px)}}
  .line{margin:0;font-size:13px;font-weight:600;letter-spacing:.1px;text-shadow:0 1px 2px var(--shade);transition:opacity 200ms ease}
  .line.out{opacity:0}
  .detail{margin:2px 0 0;font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-user-select:text;user-select:text}
  .detail:empty,.actions{display:none}
  .stuck .talk,.failed .talk{padding:10px 12px 12px}
  .stuck .actions,.failed .actions{display:flex;justify-content:center;gap:6px;margin-top:10px}
  .stuck .center,.failed .center{top:96px}
  .failed .eyes{animation:none;transform:scaleY(.2)}.failed .pip,.failed .shadow{animation:none}
  button{font:inherit;cursor:pointer;border:0;-webkit-app-region:no-drag}
  .actions button{height:28px;padding:0 12px;border-radius:8px;font-size:12.5px;font-weight:600;transition:background-color 150ms ease,transform 120ms var(--ease-out)}
  .actions .go{background:var(--text);color:var(--go-ink)}.actions .stop{background:#ffffff2e;color:var(--text)}
  @media(hover:hover) and (pointer:fine){.actions .go:hover{background:#e9f1ff}.actions .stop:hover{background:#ffffff47}.close:hover{background:#0b2f5c33;color:var(--text)}}
  .actions button:active{transform:scale(.97)}
  button:disabled{cursor:default;opacity:.6}
  button:focus-visible{outline:2px solid var(--text);outline-offset:2px}
  .close{position:absolute;right:10px;top:10px;width:28px;height:28px;display:grid;place-items:center;padding:0;border-radius:8px;background:transparent;color:var(--soft);filter:drop-shadow(0 1px 1px var(--shade));transition:background-color 150ms ease,color 150ms ease}
  .close svg{pointer-events:none}
  @media(prefers-reduced-motion:reduce){.cloud,.pip,.shadow,.eyes,.talk{animation:none}}
  </style></head><body><main>
  <img class="layer cloud" src="${art("startup-cloud.png")}" alt="">
  <div class="shadow" aria-hidden="true"></div>
  ${sprite("kit", KIT, "#d0cefb", "#2a2456")}${sprite("pip", PIP, "#286ef9", "#ffffff")}
  <button class="close" aria-label="Close" data-act="close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
  <div class="center"><div class="talk"><p class="line" role="status">opening…</p><p class="detail"></p>
  <div class="actions"><button class="go" data-act="retry">try again</button><button class="stop" data-act="quit">quit</button></div></div></div>
  </main><script>${PAGE_SCRIPT}</script></body></html>`;
}

const PAGE_SCRIPT = `(() => {
  const body = document.body, line = document.querySelector('.line'), detail = document.querySelector('.detail');
  let pinned = false, over = false;
  const write = text => {
    if (line.textContent === text) return;
    line.classList.add('out');
    setTimeout(() => { line.textContent = text; line.classList.remove('out'); }, 200);
  };
  const slowly = setTimeout(() => { if (!pinned && !over) write('taking a little longer…'); }, ${SLOW_AFTER_MS});
  const trouble = (kind, text, why = '') => {
    if (over) return;
    over = kind === 'failed'; clearTimeout(slowly);
    detail.textContent = why; detail.title = why;
    body.classList.remove('stuck'); body.classList.add(kind);
    write(text);
  };
  const stuck = setTimeout(() => trouble('stuck', 'this is taking longer than usual'), ${STUCK_AFTER_MS});
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-act]');
    if (!button) return;
    if (button.dataset.act === 'retry') { button.disabled = true; button.textContent = 'starting again…'; }
    window.startupScreen?.[button.dataset.act]?.();
  });
  window.card = {
    say: text => { pinned = true; if (!over) write(text); },
    fail: why => { clearTimeout(stuck); trouble('failed', "couldn't start", why || ''); },
    ready: () => { clearTimeout(slowly); clearTimeout(stuck); },
  };
})();`;

export function createStartupScreen({
  BrowserWindow, iconPath, platform = process.platform, isQuitting, onQuit, onRetry,
  onHide, isHidden = () => false, onShow, onFinished,
}) {
  let disposed = false, revealed = false, fallback, resolveReady;
  // window opacity is a no-op on Linux, so there the app just appears
  const canFade = win => platform !== "linux" && typeof win.setOpacity === "function";
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const splash = new BrowserWindow({
    width: W, height: H, resizable: false, maximizable: false,
    fullscreenable: false, frame: false, transparent: true,
    backgroundColor: "#00000000", show: false, icon: iconPath,
    title: "dusk bot", autoHideMenuBar: true,
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
    if (disposed) return;
    if (channel === "startup-screen:close") splash.close();
    else if (channel === "startup-screen:quit") onQuit();
    else if (channel === "startup-screen:retry") (onRetry ?? onQuit)();
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
  const page = (code) => disposed || splash.isDestroyed() ? Promise.resolve() : splash.webContents.executeJavaScript(code).catch(() => {});
  let said = null, failure = null;
  const tell = () => {
    if (said !== null) void page(`window.card?.say(${JSON.stringify(said)})`);
    if (failure !== null) void page(`window.card?.fail(${JSON.stringify(failure)})`);
  };
  splash.webContents.on("did-finish-load", tell);
  const startupFallback = setTimeout(resolveReady, 10_000);
  startupFallback.unref?.();
  void splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(startupScreenHtml()))
    .catch(resolveReady);
  const attach = (win, { maximized = false } = {}) => {
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
        else if (canFade(win) && splash.isVisible?.()) { void fadeIn(win); return; }
        else { win.show(); win.focus(); }
      }
      dispose();
    };
    const fadeIn = async (win) => {
      void page("window.card?.ready()");
      win.setOpacity(0); win.show(); win.focus();
      await crossfade(win, splash);
      if (!win.isDestroyed()) win.setOpacity(1);
      dispose();
    };
    win.webContents.on("did-finish-load", () => {
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
  /** The line under the name, in place of the rotating ones. */
  const status = (text) => { said = String(text); tell(); };
  /** Startup gave up: the card says so and offers try again and quit instead of waiting forever. */
  const fail = (error) => {
    failure = String(error?.message ?? error ?? "").slice(0, 200);
    showSplash();
    tell();
  };
  return { ready, attach, dispose, status, fail, window: splash };
}
