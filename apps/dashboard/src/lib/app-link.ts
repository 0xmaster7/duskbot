import { toast } from "./toast";
import { DOWNLOAD_URL } from "./usage";

/** the links the desktop app answers (electron/chat-link.mjs, electron/cloud-entry.mjs); the bare scheme only brings the app forward */
export const appLink = {
  app: "duskbot://",
  bot: (id: string) => `duskbot://bot/${encodeURIComponent(id)}`,
  cloud: "duskbot://cloud",
};

const GIVE_UP_MS = 1600;

/** hands a link to the desktop app; when the page still has focus afterwards, nothing took it, so say how to get the app */
export function openApp(link: string, then?: string) {
  let left = false;
  const leave = () => { left = true; };
  window.addEventListener("blur", leave, { once: true });
  document.addEventListener("visibilitychange", leave, { once: true });
  window.location.assign(link);
  if (then) toast(then);
  setTimeout(() => {
    window.removeEventListener("blur", leave);
    document.removeEventListener("visibilitychange", leave);
    if (!left && document.hasFocus()) toast(`dusk bot did not open. get it at ${DOWNLOAD_URL.replace("https://", "")}, then try again.`, "bad");
  }, GIVE_UP_MS);
}
