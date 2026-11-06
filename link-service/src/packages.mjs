// our private server build and the bot desktop kit (deploy/bot-desktop as a tgz), handed only to a claimed install
// session (never at a public url). each is <dir>/<sha256>.tgz; <dir>/current.json
// {"sha256","version","desktop":{"sha256","image"}} names the ones new installs get;
// scripts/build-vps-package.mjs --publish <data dir> writes both. older tgz files keep serving installs already
// under way, so publishing never breaks one mid-download.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HEX64 = /^[0-9a-f]{64}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const IMAGE = /^[a-z0-9][a-z0-9._/-]{0,150}(:[A-Za-z0-9._-]{1,64})?$/;

/** @param {string | null} dir */
export function createPackages(dir) {
  let cached = null;

  /** the build (and desktop kit, when published) to hand out now, or null when none is published */
  function current() {
    if (!dir) return null;
    let mtime;
    try { mtime = statSync(join(dir, "current.json")).mtimeMs; } catch { return null; }
    if (!cached || cached.mtime !== mtime) {
      let value = null;
      try {
        const manifest = JSON.parse(readFileSync(join(dir, "current.json"), "utf8"));
        if (HEX64.test(manifest?.sha256 ?? "")) {
          const desktop = manifest.desktop;
          value = {
            sha256: manifest.sha256, version: VERSION.test(manifest.version ?? "") ? manifest.version : "",
            desktop: HEX64.test(desktop?.sha256 ?? "") && IMAGE.test(desktop?.image ?? "") ? { sha256: desktop.sha256, image: desktop.image } : null,
          };
        }
      } catch {
        value = null;
      }
      cached = { mtime, value };
    }
    if (!cached.value) return null;
    const file = find(cached.value.sha256);
    if (!file) return null;
    const kit = cached.value.desktop ? find(cached.value.desktop.sha256) : null;
    return { ...cached.value, size: file.size, desktop: kit ? { ...cached.value.desktop, size: kit.size } : null };
  }

  /** a published tgz by its sha256 */
  function find(sha) {
    if (!dir || !HEX64.test(sha)) return null;
    const path = join(dir, `${sha}.tgz`);
    try {
      const stat = statSync(path);
      return stat.isFile() ? { path, size: stat.size } : null;
    } catch {
      return null;
    }
  }

  return { current, find };
}
