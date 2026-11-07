import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("bot desktop image icons", () => {
  it.skipIf(process.platform === "win32")("keeps installed icons, their link chains, folders and mime types while removing unrelated apps", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-desktop-icons-"));
    const icons = join(dir, "icons");
    const applications = join(dir, "applications");
    const apps = join(icons, "Papirus", "48x48", "apps");
    const dark = join(icons, "Papirus-Dark", "48x48", "apps");
    const places = join(icons, "Papirus", "48x48", "places");
    const mimetypes = join(icons, "Papirus", "48x48", "mimetypes");
    mkdirSync(apps, { recursive: true });
    mkdirSync(dark, { recursive: true });
    mkdirSync(places, { recursive: true });
    mkdirSync(mimetypes, { recursive: true });
    mkdirSync(applications);
    writeFileSync(join(applications, "custom.desktop"), "[Desktop Entry]\nIcon=org.example.Custom\n");
    writeFileSync(join(apps, "custom-target.svg"), "<svg/>");
    symlinkSync("custom-target.svg", join(apps, "custom-link.svg"));
    symlinkSync("custom-link.svg", join(apps, "org.example.Custom.svg"));
    symlinkSync("../../../Papirus/48x48/apps/org.example.Custom.svg", join(dark, "org.example.Custom.svg"));
    writeFileSync(join(apps, "uninstalled-game.svg"), "<svg/>");
    writeFileSync(join(apps, "chromium.svg"), "<svg/>");
    writeFileSync(join(apps, "archiver.svg"), "<svg/>");
    symlinkSync("../apps/archiver.svg", join(mimetypes, "application-zip.svg"));
    writeFileSync(join(places, "folder.svg"), "<svg/>");
    try {
      execFileSync("python3", ["-I", fileURLToPath(new URL("../deploy/bot-desktop/trim-icons.py", import.meta.url)), icons, applications]);
      expect(existsSync(join(apps, "uninstalled-game.svg"))).toBe(false);
      expect(existsSync(join(dark, "org.example.Custom.svg"))).toBe(true);
      expect(readlinkSync(join(apps, "org.example.Custom.svg"))).toBe("custom-link.svg");
      expect(existsSync(join(apps, "chromium.svg"))).toBe(true);
      expect(existsSync(join(mimetypes, "application-zip.svg"))).toBe(true);
      expect(existsSync(join(places, "folder.svg"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
