import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { tailFile } from "./speech-output.mjs";

const scratch = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "speech-output-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "stdout.ndjson");
  writeFileSync(file, "");
  return file;
};

const until = async (check, ms) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) return false;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return true;
};

test("a written line arrives on the write, not on the next poll", async (t) => {
  const file = scratch(t);
  let seen = "";
  // a backstop this slow never fires in the test: only the file watcher can deliver
  const tail = tailFile(file, (text) => { seen += text; }, { backstopMs: 60_000 });
  t.after(() => tail.close());
  // the watcher arms on the next turn of the event loop
  await new Promise((resolve) => setTimeout(resolve, 20));
  appendFileSync(file, "{\"partial\":true,\"text\":\"hello\"}\n");
  assert.ok(await until(() => seen.includes("hello"), 1_000), "the partial reached the reader without waiting for a poll");
  const at = performance.now();
  appendFileSync(file, "{\"partial\":true,\"text\":\"hello there\"}\n");
  assert.ok(await until(() => seen.includes("hello there"), 1_000));
  assert.ok(performance.now() - at < 200, `delivered in ${Math.round(performance.now() - at)}ms`);
});

test("reads only what is new and never splits a character", (t) => {
  const file = scratch(t);
  const chunks = [];
  const tail = tailFile(file, (text) => chunks.push(text), { backstopMs: 60_000 });
  t.after(() => tail.close());
  const bytes = Buffer.from("今日は\n");
  appendFileSync(file, bytes.subarray(0, 4));
  tail.flush();
  appendFileSync(file, bytes.subarray(4));
  tail.flush();
  appendFileSync(file, "next\n");
  tail.flush();
  tail.flush();
  assert.equal(chunks.join(""), "今日は\nnext\n");
  assert.ok(chunks.every((chunk) => !chunk.includes("�")));
  assert.equal(chunks.at(-1), "next\n");
});

test("nothing is delivered after close", (t) => {
  const file = scratch(t);
  const chunks = [];
  const tail = tailFile(file, (text) => chunks.push(text), { backstopMs: 60_000 });
  tail.close();
  appendFileSync(file, "late\n");
  tail.flush();
  assert.deepEqual(chunks, []);
});
