// checks the waitlist api end to end: starts server.js on a free port with a throwaway file, then signs up. zero deps.
//   node test-waitlist.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-waitlist-'));
const file = path.join(dir, 'waitlist.jsonl');
const port = await new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const server = spawn(process.execPath, ['server.js', 'landing'], { cwd: here, env: { ...process.env, PORT: String(port), DUSK_WAITLIST_FILE: file, BREVO_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
let logs = '';
server.stdout.on('data', (c) => { logs += c; });
await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('server did not start')), 5000); server.stdout.on('data', () => { if (logs.includes('on 127.0.0.1')) { clearTimeout(t); ok(); } }); });

const url = `http://127.0.0.1:${port}/api/waitlist`;
const post = (body, ip, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, data: await r.json() }));
const lines = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []);

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); } catch (err) { results.push(`FAIL ${name}: ${err.message}`); process.exitCode = 1; }
}
try {
  await check('valid signup', async () => {
    const r = await post({ email: '  Ada@Lovelace.dev ', source: 'test' }, '10.0.0.1');
    assert.equal(r.status, 201); assert.equal(r.data.ok, true); assert.equal(r.data.position, 1);
    const saved = JSON.parse(lines()[0]);
    assert.equal(saved.email, 'ada@lovelace.dev'); assert.equal(saved.source, 'test'); assert.ok(saved.ts);
    const second = await post({ email: 'grace@hopper.dev' }, '10.0.0.1');
    assert.equal(second.status, 201); assert.equal(second.data.position, 2);
  });
  await check('duplicate returns the same position', async () => {
    const r = await post({ email: 'ADA@lovelace.dev' }, '10.0.0.2');
    assert.equal(r.status, 200); assert.equal(r.data.position, 1); assert.equal(r.data.already, true);
    assert.equal(lines().length, 2);
  });
  await check('bad email is a 400', async () => {
    for (const email of ['nope', 'a@b', 'x@mailinator.com', `${'a'.repeat(250)}@b.co`]) {
      const r = await post({ email }, '10.0.0.3');
      assert.equal(r.status, 400, email); assert.equal(r.data.ok, false); assert.ok(r.data.message);
    }
    assert.equal(lines().length, 2);
  });
  await check('honeypot is ignored', async () => {
    const r = await post({ email: 'robot@spam.dev', website: 'http://spam' }, '10.0.0.4');
    assert.equal(r.status, 200); assert.equal(r.data.ok, true);
    assert.equal(lines().length, 2); assert.ok(!fs.readFileSync(file, 'utf8').includes('robot@'));
  });
  await check('rate limit is a 429', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await post({ email: `r${i}@rate.dev` }, '10.0.0.5')).status);
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
  });
  await check('oversized body is a 413', async () => {
    const r = await post({ email: 'big@body.dev', source: 'x'.repeat(4000) }, '10.0.0.6');
    assert.equal(r.status, 413);
  });
  await check('count', async () => {
    const r = await fetch(`${url}/count`).then((x) => x.json());
    assert.equal(r.count, 7);
  });
  await check('no full email in the log', async () => {
    assert.ok(!/@/.test(logs), 'an email reached stdout');
  });
} finally {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(results.join('\n'));
