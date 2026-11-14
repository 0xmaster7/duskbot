import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./resources/windows-speech.ps1", import.meta.url));
const script = readFileSync(scriptPath, "utf8");
const speech = readFileSync(fileURLToPath(new URL("./speech.mjs", import.meta.url)), "utf8");
const builder = readFileSync(fileURLToPath(new URL("../build/electron-builder.yml", import.meta.url)), "utf8");

test("the script stays ASCII, since Windows PowerShell 5.1 reads a BOM-less file in the ANSI code page", () => {
  const plain = (code) => code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
  assert.equal([...script].every((char) => plain(char.charCodeAt(0))), true);
});

test("the script takes exactly the parameters speech.mjs passes", () => {
  const declared = [...script.match(/param\(([\s\S]*?)\n\)/)[1].matchAll(/\$(\w+)/g)].map(m => m[1]).sort();
  const passed = [...speech.matchAll(/"-(EndpointMs|Locale|StopFile|FinishFile)"/g)].map(m => m[1]).sort();
  assert.deepEqual(declared, ["EndpointMs", "FinishFile", "Locale", "StopFile"]);
  assert.deepEqual([...new Set(passed)], declared);
});

test("the script reports only the documented error codes", () => {
  const codes = new Set([...script.matchAll(/Fail "([a-z-]+)"/g)].map(m => m[1]));
  assert.deepEqual([...codes].sort(), ["mic-failed", "recognition-error", "recognizer-unavailable"]);
});

test("the Windows build carries the script outside app.asar, and the other builds leave it out", () => {
  assert.match(builder, /- "!electron\/resources\/windows-speech\.ps1"/);
  const win = builder.slice(builder.indexOf("\nwin:"), builder.indexOf("\nnsis:"));
  assert.match(win, /- from: electron\/resources\/windows-speech\.ps1\n\s+to: windows-speech\.ps1/);
  assert.match(speech, /path\.join\(process\.resourcesPath, WINDOWS_SCRIPT\)/);
});

const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" }).status === 0;

test("the script parses without syntax errors", { skip: !pwsh && "needs pwsh" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "windows-speech-parse-"));
  try {
    const check = join(dir, "check.ps1");
    writeFileSync(check, "param([string]$Path)\n$tokens = $null; $errors = $null\n[void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)\n$errors | ForEach-Object { $_.Message }\nexit $errors.Count\n");
    const run = spawnSync("pwsh", ["-NoProfile", "-File", check, scriptPath], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
