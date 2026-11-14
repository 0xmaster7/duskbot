import fs from "node:fs";

// electron main (dev only) writes its next argv here before quitting; the dev runner restarts Electron with it
export function takeRelaunchRequest(file) {
  if (!file) return null;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  fs.rmSync(file, { force: true });
  try {
    const args = JSON.parse(text);
    return Array.isArray(args) && args.every((arg) => typeof arg === "string") ? args : null;
  } catch { return null; }
}
