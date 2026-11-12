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

const W = 480, H = 360;
const font = `data:font/woff2;base64,${readFileSync(fileURLToPath(new URL("./resources/general-sans.woff2", import.meta.url))).toString("base64")}`;

export const THEMES = Object.freeze({
  light: Object.freeze({ bg: "#fafbfc", ink: "#1b1b1f", soft: "#5d5f68", track: "#1b1b1f12", fill: "#1b1b1f", shadow: "#1b1b1f14", hover: "#1b1b1f0f" }),
  dark: Object.freeze({ bg: "#141418", ink: "#f2f3f5", soft: "#a3a6b0", track: "#ffffff14", fill: "#c9f63f", shadow: "#00000055", hover: "#ffffff14" }),
});

/** What each launch milestone (a startup trace mark) tells the person, in order. The first shows as the card opens. */
export const STEPS = Object.freeze([
  ["opening", "opening dusk bot"],
  ["credentials", "unlocking your sign-ins"],
  ["server", "starting your bots"],
  ["window", "opening your workspace"],
  ["loaded", "almost there"],
]);

/**
 * Light or dark for the card. `saved` is the last skin the app wore and whether the system was dark then:
 * a skin that matched the system then follows the system now, one that went against it was picked on purpose.
 */
export function startupDark({ systemDark, saved }) {
  if (!saved || typeof saved.light !== "boolean" || typeof saved.systemDark !== "boolean") return systemDark;
  return saved.light === saved.systemDark ? !saved.light : systemDark;
}

const GOO = {
  body: "M7 4h2v1h-2zM5 5h6v1h-6zM4 6h8v1h-8zM4 7h8v1h-8zM3 8h10v1h-10zM3 9h10v1h-10zM3 10h10v1h-10zM1 11h14v1h-14zM1 12h14v1h-14zM1 13h14v1h-14zM1 14h14v1h-14zM3 15h10v1h-10z",
  eyes: "M5 9h2v3h-2zM9 9h2v3h-2z",
};

export function startupScreenHtml({ dark = false } = {}) {
  const t = dark ? THEMES.dark : THEMES.light;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${dark ? "dark" : "light"}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>dusk bot</title><style>
  @font-face{font-family:"General Sans";src:url("${font}") format("woff2");font-weight:200 700}
  :root{--bg:${t.bg};--ink:${t.ink};--soft:${t.soft};--track:${t.track};--fill:${t.fill};--shadow:${t.shadow};--hover:${t.hover};--ease-out:cubic-bezier(.23,1,.32,1)}
  *{box-sizing:border-box}
  html,body{margin:0;width:100%;height:100%;overflow:hidden}
  body{background:var(--bg);color:var(--ink);font:500 14px/1.4 "General Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;display:grid;place-items:center;-webkit-app-region:drag;-webkit-user-select:none;user-select:none}
  .stage{display:flex;flex-direction:column;align-items:center}
  .m{display:block;transform-origin:50% 100%;animation:breathe 2.8s ease-in-out infinite alternate}
  .e{transform-box:fill-box;transform-origin:50% 100%;animation:blink 5.2s steps(1,end) infinite}
  .floor{width:96px;height:8px;border-radius:50%;background:var(--shadow);margin-top:-4px;animation:settle 2.8s ease-in-out infinite alternate}
  @keyframes breathe{to{transform:scale(.985,1.03)}}
  @keyframes settle{to{transform:scaleX(.94)}}
  @keyframes blink{0%,94%{transform:scaleY(1)}95%,97%{transform:scaleY(.34)}}
  .line{margin:26px 0 0;font-size:17px;font-weight:600;letter-spacing:-.2px;transition:opacity 180ms ease}
  .line.out{opacity:0}
  .bar{width:220px;height:6px;border-radius:999px;background:var(--track);margin-top:16px;overflow:hidden}
  .bar i{display:block;height:100%;border-radius:inherit;background:var(--fill);transform:scaleX(0);transform-origin:0 50%;transition:transform 260ms linear}
  .row{display:flex;gap:10px;align-items:baseline;margin-top:10px;color:var(--soft);font-size:13px}
  .row b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
  .detail{max-width:340px;margin:8px 0 0;font:500 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-user-select:text;user-select:text;-webkit-app-region:no-drag}
  .detail:empty,.actions{display:none}
  .stuck .actions,.failed .actions{display:flex;gap:8px;margin-top:16px}
  .failed .bar,.failed .row{display:none}
  .failed .m,.failed .floor{animation:none}.failed .e{animation:none;transform:scaleY(.34)}
  button{font:inherit;cursor:pointer;border:0;-webkit-app-region:no-drag}
  .actions button{height:32px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:600;transition:background-color 150ms ease,opacity 150ms ease,transform 120ms var(--ease-out)}
  .actions .go{background:var(--ink);color:var(--bg)}.actions .stop{background:var(--track);color:var(--ink)}
  .actions button:active{transform:scale(.97)}
  button:disabled{cursor:default;opacity:.6}
  button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .close{position:absolute;right:10px;top:10px;width:28px;height:28px;display:grid;place-items:center;padding:0;border-radius:999px;background:transparent;color:var(--soft);opacity:.7;transition:background-color 150ms ease,opacity 150ms ease}
  .close svg{pointer-events:none}
  @media(hover:hover) and (pointer:fine){.close:hover{background:var(--hover);opacity:1}.actions .go:hover{opacity:.88}.actions .stop:hover{background:var(--hover)}}
  @media(prefers-reduced-motion:reduce){.m,.floor,.e{animation:none}.bar i{transition:none}}
  </style></head><body>
  <button class="close" aria-label="Close" data-act="close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
  <main class="stage"><svg class="m" width="168" height="168" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#f75e51" d="${GOO.body}"/><path class="e" fill="#ffffff" d="${GOO.eyes}"/></svg><div class="floor" aria-hidden="true"></div>
  <p class="line" role="status">${STEPS[0][1]}</p>
  <div class="bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="opening dusk bot"><i></i></div>
  <div class="row" aria-hidden="true"><b class="num">0%</b><span class="of">step 1 of ${STEPS.length}</span></div>
  <p class="detail"></p>
  <div class="actions"><button class="go" data-act="retry">try again</button><button class="stop" data-act="quit">quit</button></div>
  </main><script>${PAGE_SCRIPT}</script></body></html>`;
}

// the bar creeps toward the end of the current step while it waits, and never reaches it before the step does
const PAGE_SCRIPT = `(() => {
  const body = document.body, line = document.querySelector('.line'), detail = document.querySelector('.detail');
  const bar = document.querySelector('.bar'), fill = bar.firstElementChild, num = document.querySelector('.num'), of = document.querySelector('.of');
  const lines = ${JSON.stringify(STEPS.map(([, text]) => text))}, total = lines.length, span = 100 / total;
  let pinned = false, over = false, step = 1, value = 0;
  const write = text => {
    if (line.textContent === text) return;
    line.classList.add('out');
    setTimeout(() => { line.textContent = text; line.classList.remove('out'); }, 180);
  };
  const draw = () => {
    const shown = Math.floor(value);
    fill.style.transform = 'scaleX(' + (value / 100) + ')';
    num.textContent = shown + '%'; bar.setAttribute('aria-valuenow', String(shown));
    of.textContent = 'step ' + step + ' of ' + total;
  };
  const creep = setInterval(() => {
    const ceiling = step * span - 2;
    if (value < ceiling) { value += (ceiling - value) * 0.05; draw(); }
  }, 250);
  const quiet = () => over || body.classList.contains('stuck');
  const slowly = setTimeout(() => { if (!pinned && !quiet()) write('taking a little longer…'); }, ${SLOW_AFTER_MS});
  const trouble = (kind, text, why = '') => {
    if (over) return;
    over = kind === 'failed'; clearTimeout(slowly);
    if (over) clearInterval(creep);
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
  draw();
  window.card = {
    say: text => { pinned = true; if (!over) write(text); },
    step: n => {
      if (over || !(n > step) || n > total) return;
      step = n; value = Math.max(value, (n - 1) * span); draw();
      if (!pinned && !quiet()) write(lines[n - 1]);
    },
    fail: why => { clearTimeout(stuck); trouble('failed', "couldn't start", why || ''); },
    ready: () => { clearTimeout(slowly); clearTimeout(stuck); clearInterval(creep); if (!over) { value = 100; draw(); } },
  };
})();`;

export function createStartupScreen({
  BrowserWindow, iconPath, platform = process.platform, isQuitting, onQuit, onRetry,
  onHide, isHidden = () => false, onShow, onFinished, dark = false,
}) {
  let disposed = false, revealed = false, fallback, resolveReady;
  // window opacity is a no-op on Linux, so there the app just appears
  const canFade = win => platform !== "linux" && typeof win.setOpacity === "function";
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const splash = new BrowserWindow({
    width: W, height: H, resizable: false, maximizable: false,
    fullscreenable: false, frame: false,
    backgroundColor: dark ? THEMES.dark.bg : THEMES.light.bg, show: false, icon: iconPath,
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
  let said = null, failure = null, step = 1;
  const tell = () => {
    if (step > 1) void page(`window.card?.step(${step})`);
    if (said !== null) void page(`window.card?.say(${JSON.stringify(said)})`);
    if (failure !== null) void page(`window.card?.fail(${JSON.stringify(failure)})`);
  };
  splash.webContents.on("did-finish-load", tell);
  const startupFallback = setTimeout(resolveReady, 10_000);
  startupFallback.unref?.();
  void splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(startupScreenHtml({ dark })))
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
  /** A startup trace mark was reached: the bar and line move to its step. Marks without a step are ignored. */
  const progress = (mark) => {
    const at = STEPS.findIndex(([name]) => name === mark) + 1;
    if (at <= step) return;
    step = at; tell();
  };
  /** Startup gave up: the card says so and offers try again and quit instead of waiting forever. */
  const fail = (error) => {
    failure = String(error?.message ?? error ?? "").slice(0, 200);
    showSplash();
    tell();
  };
  return { ready, attach, dispose, status, progress, fail, window: splash };
}
