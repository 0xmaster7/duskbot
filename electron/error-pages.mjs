import path from "node:path";
import { pathToFileURL } from "node:url";

import { handoffPage } from "./pixel-page.mjs";

const dataUrl = (html) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The page the main window shows when the background server never came up. */
export function buildErrorPage({ allPortsOccupied, logDir }) {
  const serverLogPath = path.join(logDir, "server.log");
  const serverLogHref = pathToFileURL(serverLogPath).href;
  const reason = allPortsOccupied
    ? "Every dusk bot port answered health checks from another process, likely a second copy of the app, or another program on ports 8799–28799. Quit that program, then quit and reopen dusk bot."
    : "The background server didn't come up in time. This is usually slow startup, not a port conflict. Quit and reopen dusk bot.";
  return dataUrl(handoffPage({
    title: "dusk bot couldn't start",
    mood: "oops",
    content: `<h1>the bot server didn't wake up</h1><p>${escapeHtml(reason)} If it keeps happening, check <a target="_blank" rel="noopener" href="${serverLogHref}">${escapeHtml(serverLogPath)}</a>.</p>`,
  }));
}

/** The page the live-desktop viewer shows when it cannot open. */
export function desktopViewerErrorPage(message, retryUrl) {
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return dataUrl(handoffPage({
    title: "Desktop unavailable",
    mood: "oops",
    content: `<h1>couldn't open the live desktop</h1><p>${escape(message)}</p><p class="go"><a href="${escape(retryUrl)}" target="_blank" rel="noreferrer">Open in browser</a></p>`,
  }));
}

/** Electron's render-process-gone reasons that mean the page died, not that it was closed or killed on purpose. */
export const RENDERER_CRASHES = new Set(["crashed", "oom", "launch-failed", "integrity-failure", "abnormal-exit"]);

/** The page the main window shows after its renderer crashes; the bots run in the server, so they are unaffected. */
export function windowCrashedPage(reopenUrl) {
  const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return dataUrl(handoffPage({
    title: "dusk bot",
    mood: "oops",
    content: `<h1>this window tripped</h1><p>the window stopped drawing, but your bots kept running. reopen it to pick up right where you were.</p><p class="go"><a href="${escape(reopenUrl)}">reopen window</a></p>`,
  }));
}
