import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createCappedLog } from "./capped-log.mjs";

const settle = log => new Promise(resolve => { log.close(); setTimeout(resolve, 50); });

test("the log rolls over to .1 once it passes its cap, so it never grows without bound", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capped-log-"));
  const file = path.join(dir, "server.log");
  const log = createCappedLog({ file, maxBytes: 100 });
  for (let i = 0; i < 30; i += 1) log.write(`line ${String(i).padStart(3, "0")}\n`);
  await settle(log);
  assert.ok(fs.statSync(file).size <= 100);
  assert.ok(fs.statSync(`${file}.1`).size <= 100);
  assert.match(fs.readFileSync(file, "utf8"), /line 029/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a log already over its cap from an earlier run starts fresh", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capped-log-"));
  const file = path.join(dir, "server.log");
  fs.writeFileSync(file, "x".repeat(500));
  const log = createCappedLog({ file, maxBytes: 100 });
  log.write("new\n");
  await settle(log);
  assert.equal(fs.readFileSync(file, "utf8"), "new\n");
  assert.equal(fs.statSync(`${file}.1`).size, 500);
  fs.rmSync(dir, { recursive: true, force: true });
});
