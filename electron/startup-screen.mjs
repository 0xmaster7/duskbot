import { fileURLToPath } from 'node:url';
import { cloudSvg, flowersSvg, hillsSvg, logoSvg, meadowSvg, puffSvg, sprite, starsSvg } from './startup-art.mjs';

/** How long a page that shows its own waiting mascot keeps the splash up before it takes over. */
export const BOOT_SHELL_HANDOFF_MS = 600;
/** The meadow gets this long to finish blooming before the app shows anyway. */
export const RING_CLOSE_LIMIT_MS = 900;
export const CROSSFADE_MS = 280;
export const SLOW_AFTER_MS = 8_000;
export const STUCK_AFTER_MS = 45_000;

export const STATUS_LINES = Object.freeze([
  "waking the bots…", "brewing coffee for kit…", "finding your chats…", "fluffing the clouds…",
  "watering the meadow…", "dusting off your projects…", "teaching kit to sit…", "tidying the sky…",
]);
export const SLOW_LINES = Object.freeze([
  "still going, first opens take a little longer…", "nearly there, kit's on it…", "everything's fine, just a slow morning…",
]);

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

const W = 440, H = 300, GROUND = 248, CLOUD = { x: 256, y: 112 };
const BOTS = [
  { name: "pip", colour: "#286ef9", ground: 104, spot: 264, delay: 700 },
  { name: "mochi", colour: "#f12b93", ground: 158, spot: 312, delay: 1300 },
  { name: "loaf", colour: "#fb7c01", ground: 212, spot: 360, delay: 1900 },
];
const BOT_CELL = 3, BOT_SIZE = 16 * BOT_CELL, ON_CLOUD = CLOUD.y + 8 - BOT_SIZE;
const KIT = { x: 352, cell: 4 };

function sceneSvg() {
  const bots = BOTS.map(({ name, colour, ground, spot, delay }, i) =>
    `<g transform="translate(${spot} ${ON_CLOUD})"><g class="bot" style="--c:${colour};--dx:${ground - spot}px;--dy:${GROUND - BOT_SIZE - ON_CLOUD}px;--delay:${delay}ms;--blink:${(3.7 + i * 0.9).toFixed(1)}s">`
    + `${sprite(name, BOT_CELL)}</g></g>`).join("");
  return `<svg class="scene" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true">`
    + `<rect class="sky1" width="${W}" height="120"/><rect class="sky2" y="120" width="${W}" height="48"/>`
    + `<rect class="sky3" y="168" width="${W}" height="40"/><rect class="sky4" y="208" width="${W}" height="${GROUND - 208}"/>`
    + `<g class="stars">${starsSvg()}</g>`
    + `<g class="puff" transform="translate(0 150)"><g class="drift">${puffSvg()}</g></g>`
    + `<g class="hills">${hillsSvg({ bottom: GROUND })}</g>`
    + `<g class="meadow">${meadowSvg({ top: GROUND })}</g>`
    + `<g class="flowers">${flowersSvg({ top: GROUND })}</g>`
    + `<g class="raft"><g transform="translate(${CLOUD.x} ${CLOUD.y})">${cloudSvg()}</g>${bots}</g>`
    + `<g transform="translate(${KIT.x} ${GROUND - 16 * KIT.cell})"><g class="kit">${sprite("kit", KIT.cell, "var(--kit-eye)")}</g></g>`
    + `</svg>`;
}

export function startupScreenHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Dusk Bot</title><style>
  :root{--ease-out:cubic-bezier(.23,1,.32,1);--ease-in-out:cubic-bezier(.77,0,.175,1);--line:220ms;
    --ink:#0f2a3d;--ink-2:#2c4a5f;--focus:#286ef9;--eye:#ffffff;--kit:#d0cefb;--kit-eye:#241f45;
    --sky-1:#c2ecfc;--sky-2:#cdf0fd;--sky-3:#dbf3fd;--sky-4:#eaf6fd;--hill:#a9e2f7;--grass:#c9f63f;--speck:#b6e52e;
    --cloud-top:#fffdf3;--cloud-under:#fff3a0;--puff-top:#fff8fb;--puff-under:#ffc4dd;
    --pink:#ffc4dd;--lemon:#fff3a0;--petal:#fffdf5;--lilac:#d0cefb;--pink-deep:#f47fb4;--lemon-deep:#f2cf2c;--stem:#8fc21c}
  @media(prefers-color-scheme:dark){:root{--sky-1:#bdb8f5;--sky-2:#d0cefb;--sky-3:#f1cbe6;--sky-4:#ffd9e6;--hill:#a3c6f3;
    --grass:#c2ef3a;--speck:#a9d827;--puff-top:#fffbea;--puff-under:#fff3a0;--ink-2:#2b3f5c}}
  *{box-sizing:border-box}
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:var(--ink);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  main{position:relative;width:100%;height:100%;overflow:hidden;border-radius:20px;background:var(--sky-1);-webkit-app-region:drag}
  .scene{position:absolute;left:0;top:0}
  .sky1{fill:var(--sky-1)}.sky2{fill:var(--sky-2)}.sky3{fill:var(--sky-3)}.sky4{fill:var(--sky-4)}
  .hills{fill:var(--hill)}.meadow .grass{fill:var(--grass)}.meadow .speck{fill:var(--speck)}
  .stars{fill:#fffdf5;opacity:0}
  @media(prefers-color-scheme:dark){.stars{opacity:1}.star{animation:twinkle 2.8s steps(1,end) var(--d) infinite}}
  @keyframes twinkle{0%,70%{opacity:1}71%,85%{opacity:.35}}
  .drift{animation:drift 40s linear -14s infinite}
  @keyframes drift{from{transform:translateX(-60px)}to{transform:translateX(${W + 10}px)}}
  .bot .body{fill:var(--c)}.kit .body{fill:var(--kit)}
  .bot,.kit,.flower{transform-box:fill-box;transform-origin:50% 100%}
  .bot{animation:hop 900ms var(--delay) both}
  .bot .eyes,.kit .eyes{transform-box:fill-box;transform-origin:50% 100%;animation:blink var(--blink,4.4s) steps(1,end) infinite}
  @keyframes hop{
    0%{transform:translate(var(--dx),var(--dy));animation-timing-function:var(--ease-out)}
    10%{transform:translate(var(--dx),var(--dy)) scale(1.14,.82);animation-timing-function:var(--ease-out)}
    48%{transform:translate(calc(var(--dx)*.32),-58px) scale(.92,1.1);animation-timing-function:cubic-bezier(.5,0,.75,.4)}
    76%{transform:translate(0,0) scale(1.14,.84);animation-timing-function:var(--ease-out)}
    100%{transform:none}}
  @keyframes blink{0%,93%{transform:scaleY(1)}94%,97%{transform:scaleY(.25)}}
  .raft{animation:bob 2.4s var(--ease-in-out) 3s infinite alternate}
  @keyframes bob{from{transform:translateY(0)}to{transform:translateY(-4px)}}
  .kit{animation:wake 1600ms var(--ease-in-out) 200ms both}
  .kit .eyes{animation:open 1800ms steps(1,end) both,blink 4.4s steps(1,end) 1.8s infinite}
  @keyframes wake{0%,30%{transform:scale(1.08,.84)}55%{transform:translateX(-6px) scale(1.22,.8)}78%{transform:scale(.95,1.06)}100%{transform:none}}
  @keyframes open{0%,62%{transform:scaleY(.25)}100%{transform:none}}
  .flower{opacity:0;transform:translateY(4px) scale(.6);transition:opacity 240ms var(--ease-out),transform 320ms var(--ease-out)}
  .flower.on{opacity:1;transform:none}
  .done .raft{animation:cheer 420ms var(--ease-out)}
  @keyframes cheer{40%{transform:translateY(-12px)}100%{transform:none}}
  .failed .bot,.failed .raft,.failed .drift,.stuck .raft{animation:none}
  .failed .kit{animation:none;transform:scale(1.08,.84)}.failed .kit .eyes{animation:none;transform:scaleY(.25)}
  @media(prefers-reduced-motion:reduce){
    .bot,.raft,.drift,.kit,.kit .eyes,.bot .eyes,.star,.done .raft{animation:none!important}
    .flower,.flower.on{transform:none}}
  header{position:absolute;left:24px;top:22px;display:flex;align-items:center;gap:11px}
  .logo{display:block;flex:none}
  h1{margin:0;font-size:17px;line-height:1.2;font-weight:700;letter-spacing:-.2px}
  .talk{position:absolute;left:24px;top:72px;width:226px;-webkit-app-region:no-drag}
  .line{margin:0;font-size:14.5px;line-height:1.4;font-weight:600;color:var(--ink-2);min-height:2.8em;transition:opacity var(--line) ease,transform var(--line) var(--ease-out)}
  .line.out{opacity:0;transform:translateY(-4px)}
  .trouble{display:none}
  .stuck .trouble,.failed .trouble{display:block}.stuck .line,.failed .line{display:none}
  h2{margin:0 0 6px;font-size:16px;line-height:1.3;font-weight:700}
  .why{margin:0;font-size:13px;line-height:1.45;font-weight:560;color:var(--ink-2)}
  .detail{margin:8px 0 0;font:500 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-user-select:text;user-select:text}
  .detail:empty{display:none}
  .actions{display:flex;gap:8px;margin-top:16px}
  button{font:inherit;cursor:pointer;border:0;-webkit-app-region:no-drag}
  .actions button{height:38px;padding:0 16px;border-radius:10px;font-size:13.5px;font-weight:650;transition:background-color 150ms ease,transform 120ms var(--ease-out)}
  .actions .go{background:var(--ink);color:#f6fbff}.actions .stop{background:#0f2a3d14;color:var(--ink)}
  @media(hover:hover) and (pointer:fine){.actions .go:hover{background:#1f4460}.actions .stop:hover{background:#0f2a3d24}.close:hover{background:#0f2a3d14;color:var(--ink)}}
  .actions button:active{transform:scale(.97)}
  button:disabled{cursor:default;opacity:.6}
  button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .close{position:absolute;right:14px;top:14px;width:32px;height:32px;display:grid;place-items:center;padding:0;border-radius:9px;background:transparent;color:var(--ink-2);transition:background-color 150ms ease,color 150ms ease}
  .close svg{pointer-events:none}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  </style></head><body><main>${sceneSvg()}
  <header>${logoSvg()}<h1>dusk bot</h1></header>
  <button class="close" aria-label="Close" data-act="close"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
  <section class="talk"><p class="line" aria-hidden="true">${STATUS_LINES[0]}</p><p class="sr status" role="status">opening dusk bot</p>
  <div class="trouble" role="alert"><h2></h2><p class="why"></p><p class="detail"></p><div class="actions"><button class="go" data-act="retry">try again</button><button class="stop" data-act="quit">quit</button></div></div></section>
  </main><script>${PAGE_SCRIPT}</script></body></html>`;
}

// the meadow creeps on its own so it never stalls and never passes 94% until main says the app is ready
const PAGE_SCRIPT = `(() => {
  const body = document.body, flowers = [...document.querySelectorAll('.flower')], line = document.querySelector('.line');
  const status = document.querySelector('.status'), trouble = document.querySelector('.trouble');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, start = performance.now();
  const lines = ${JSON.stringify(STATUS_LINES)}, slow = ${JSON.stringify(SLOW_LINES)};
  let shown = 0, goal = 0, finished = null, finish = null, pool = lines, at = 0, pinned = false, over = false;
  const frame = now => {
    if (finish) shown += (1 - shown) * 0.16;
    else shown += Math.max(0, Math.min(0.94, Math.max(goal, 0.9 * (1 - Math.exp(-(now - start) / 2600)))) - shown) * 0.06;
    if (finish && 1 - shown < 0.004) shown = 1;
    flowers.forEach((f, i) => { if (shown >= (i + 1) / (flowers.length + 1)) f.classList.add('on'); });
    if (shown === 1) { flowers.forEach(f => f.classList.add('on')); body.classList.add('done'); setTimeout(finish, reduce ? 120 : 420); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const write = text => {
    if (line.textContent === text) return;
    line.classList.add('out');
    setTimeout(() => { line.textContent = text; line.classList.remove('out'); }, 220);
  };
  const rotate = setInterval(() => { if (!pinned && !over) write(pool[at = (at + 1) % pool.length]); }, 2400);
  const slowly = setTimeout(() => { if (over) return; pool = slow; at = 0; if (!pinned) write(slow[0]); }, ${SLOW_AFTER_MS});
  const trouble_ = (kind, title, why, detail = '') => {
    if (over) return;
    over = kind === 'failed'; clearInterval(rotate); clearTimeout(slowly);
    trouble.querySelector('h2').textContent = title;
    trouble.querySelector('.why').textContent = why;
    trouble.querySelector('.detail').textContent = detail;
    trouble.querySelector('.detail').title = detail;
    body.classList.remove('stuck'); body.classList.add(kind);
    status.textContent = title;
    trouble.querySelector('.go').focus();
  };
  const stuck = setTimeout(() => { if (!finish) trouble_('stuck', 'this is taking longer than usual', 'you can keep waiting, or start dusk bot again.'); }, ${STUCK_AFTER_MS});
  document.addEventListener('click', event => {
    const act = event.target.closest?.('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'retry') { event.target.disabled = true; event.target.textContent = 'starting again…'; }
    window.startupScreen?.[act]?.();
  });
  window.meadow = {
    to: value => { goal = Math.max(goal, value); },
    done: () => finished ??= new Promise(resolve => { clearTimeout(stuck); finish = resolve; }),
    say: text => { pinned = true; status.textContent = text; write(text); },
    fail: detail => trouble_('failed', "dusk bot couldn't open", 'something stopped it while it was starting. try again, or restart your computer if it keeps happening.', detail || ''),
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
    title: "Dusk Bot", autoHideMenuBar: true,
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
    if (said !== null) void page(`window.meadow?.say(${JSON.stringify(said)})`);
    if (failure !== null) void page(`window.meadow?.fail(${JSON.stringify(failure)})`);
  };
  splash.webContents.on("did-finish-load", tell);
  const startupFallback = setTimeout(resolveReady, 10_000);
  startupFallback.unref?.();
  void splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(startupScreenHtml()))
    .catch(resolveReady);
  const attach = (win, { maximized = false } = {}) => {
    void page("window.meadow?.to(0.55)");
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
        else if (canFade(win) && splash.isVisible?.()) { void bloomThenFade(win); return; }
        else { win.show(); win.focus(); }
      }
      dispose();
    };
    const bloomThenFade = async (win) => {
      await Promise.race([page("window.meadow?.done()"), wait(RING_CLOSE_LIMIT_MS)]);
      if (win.isDestroyed() || isQuitting()) { dispose(); return; }
      win.setOpacity(0); win.show(); win.focus();
      await crossfade(win, splash);
      if (!win.isDestroyed()) win.setOpacity(1);
      dispose();
    };
    win.webContents.on("did-finish-load", () => {
      void page("window.meadow?.to(0.8)");
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
