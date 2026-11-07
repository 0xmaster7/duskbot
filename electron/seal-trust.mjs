// whether a page may seal a secret for the key its server handed it: this computer's own page needs no pin (it talks
// to its own server over loopback), a linked server's page only for the identity pinned in its link record. main names
// the server from the page that asks, never from anything the page says.
import { SEAL_IDENTITY } from "./vps-link.mjs";

/**
 * @param {{
 *   ipcMain: any,
 *   isLocal(event: any): boolean,
 *   pageOrigin(event: any): string | null,
 *   links(): { sealTrust(origin: string, identity: string): { ok: boolean, pinned: boolean } | null } | null,
 * }} deps
 */
export function installSealTrust({ ipcMain, isLocal, pageOrigin, links }) {
  ipcMain.handle("seal-trust:check", (event, identity) => sealTrustAnswer(event, identity, { isLocal, pageOrigin, links }));
}

export function sealTrustAnswer(event, identity, { isLocal, pageOrigin, links }) {
  if (typeof identity !== "string" || !SEAL_IDENTITY.test(identity)) return { ok: false, pinned: false };
  if (isLocal(event)) return { ok: true, pinned: false };
  const origin = pageOrigin(event);
  if (!origin) return { ok: false, pinned: false };
  return links()?.sealTrust(origin, identity) ?? { ok: true, pinned: false };
}
