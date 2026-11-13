// checks the waitlist api end to end: starts server.js on a free port and signs up, once with the jsonl file store and,
// when a mongod binary is around (WAITLIST_TEST_MONGOD or mongod on PATH), once more against a throwaway mongod.
//   node test-waitlist.mjs           (the mongo run needs `npm install` for the driver)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); } catch (err) { results.push(`FAIL ${name}: ${err.message}`); process.exitCode = 1; }
}

async function startServer(env) {
  const port = await freePort();
  const server = spawn(process.execPath, ['server.js', 'landing'], {
    cwd: here, env: { ...process.env, MONGODB_URI: '', DUSK_WAITLIST_FILE: '', ...env, PORT: String(port), BREVO_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const s = { server, port, logs: '' };
  server.stdout.on('data', (c) => { s.logs += c; });
  await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('server did not start')), 5000); server.stdout.on('data', () => { if (s.logs.includes('on 127.0.0.1')) { clearTimeout(t); ok(); } }); });
  return s;
}

// the shared checks; saved() returns what the store kept as [{ email, source, at }] in signup order
async function suite(label, { port, logs }, saved) {
  const url = `http://127.0.0.1:${port}/api/waitlist`;
  const post = (body, ip, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, data: await r.json() }));
  const t = (name, fn) => check(`[${label}] ${name}`, fn);

  await t('valid signup', async () => {
    const r = await post({ email: '  Ada@Lovelace.dev ', source: 'test' }, '10.0.0.1');
    assert.equal(r.status, 201); assert.equal(r.data.ok, true); assert.equal(r.data.position, 1);
    const [first] = await saved();
    assert.equal(first.email, 'ada@lovelace.dev'); assert.equal(first.source, 'test'); assert.ok(first.at);
    const second = await post({ email: 'grace@hopper.dev' }, '10.0.0.1');
    assert.equal(second.status, 201); assert.equal(second.data.position, 2);
  });
  await t('duplicate returns the same position', async () => {
    const r = await post({ email: 'ADA@lovelace.dev' }, '10.0.0.2');
    assert.equal(r.status, 200); assert.equal(r.data.position, 1); assert.equal(r.data.already, true);
    assert.equal((await saved()).length, 2);
  });
  await t('bad email is a 400', async () => {
    for (const email of ['nope', 'a@b', 'x@mailinator.com', `${'a'.repeat(250)}@b.co`]) {
      const r = await post({ email }, '10.0.0.3');
      assert.equal(r.status, 400, email); assert.equal(r.data.ok, false); assert.ok(r.data.message);
    }
    assert.equal((await saved()).length, 2);
  });
  await t('honeypot is ignored', async () => {
    const r = await post({ email: 'robot@spam.dev', website: 'http://spam' }, '10.0.0.4');
    assert.equal(r.status, 200); assert.equal(r.data.ok, true);
    assert.ok(!(await saved()).some((x) => x.email.startsWith('robot@')));
  });
  await t('rate limit is a 429', async () => {
    const statuses = [];
    for (let i = 0; i < 21; i++) statuses.push((await post({ email: `r${i}@rate.dev` }, '10.0.0.5')).status);
    assert.deepEqual(statuses, [...Array(20).fill(201), 429]);
  });
  await t('oversized body is a 413', async () => {
    const r = await post({ email: 'big@body.dev', source: 'x'.repeat(4000) }, '10.0.0.6');
    assert.equal(r.status, 413);
  });
  await t('count', async () => {
    const r = await fetch(`${url}/count`).then((x) => x.json());
    assert.equal(r.count, 22);
  });
  await t('parallel signups get distinct positions', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => post({ email: `p${i}@par.dev` }, `10.0.1.${i}`)));
    const same = await Promise.all(Array.from({ length: 3 }, (_, i) => post({ email: 'same@par.dev' }, `10.0.2.${i}`)));
    assert.deepEqual(rs.map((r) => r.status), [201, 201, 201, 201, 201]);
    assert.equal(new Set(rs.map((r) => r.data.position)).size, 5);
    assert.equal(new Set(same.map((r) => r.data.position)).size, 1, 'one email, one position');
    assert.equal((await saved()).filter((x) => x.email === 'same@par.dev').length, 1);
  });
  await t('no full email in the log', async () => {
    assert.ok(!/@/.test(logs()), 'an email reached stdout');
  });
}

async function fileRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-waitlist-'));
  const file = path.join(dir, 'waitlist.jsonl');
  const s = await startServer({ DUSK_WAITLIST_FILE: file });
  try {
    await suite('file', { port: s.port, logs: () => s.logs }, async () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [])
      .map((l) => JSON.parse(l)).map((x) => ({ email: x.email, source: x.source, at: x.ts })));
  } finally { s.server.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}

// the day's cap per network, on a server of its own with a small cap
async function capRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-waitlist-cap-'));
  const s = await startServer({ DUSK_WAITLIST_FILE: path.join(dir, 'waitlist.jsonl'), DUSK_WAITLIST_PER_IP_DAY: '3' });
  const post = (email, ip) => fetch(`http://127.0.0.1:${s.port}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ email }) })
    .then(async (r) => ({ status: r.status, data: await r.json() }));
  try {
    await check('[cap] new joins per network are capped for the day', async () => {
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await post(`d${i}@day.dev`, '10.9.0.1')).status);
      assert.deepEqual(statuses, [201, 201, 201, 429]);
      const capped = await post('d9@day.dev', '10.9.0.1');
      assert.equal(capped.data.error, 'too_many_today'); assert.ok(capped.data.message);
      assert.equal((await post('d4@day.dev', '10.9.0.2')).status, 201, 'another network still joins');
    });
    await check('[cap] an ipv6 network counts by its /64', async () => {
      const statuses = [];
      for (const [i, ip] of ['2001:db8:1:2::1', '2001:db8:1:2:aaaa::9', '2001:0db8:0001:0002:ffff:ffff:ffff:1', '2001:db8:1:2::77'].entries()) statuses.push((await post(`v${i}@six.dev`, ip)).status);
      assert.deepEqual(statuses, [201, 201, 201, 429]);
      assert.equal((await post('v9@six.dev', '2001:db8:1:3::1')).status, 201);
    });
  } finally { s.server.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function findMongod() {
  const bin = process.env.WAITLIST_TEST_MONGOD || 'mongod';
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0 ? bin : null;
}

async function mongoRun(bin) {
  let MongoClient;
  try { ({ MongoClient } = await import('mongodb')); } catch { results.push('skip [mongo] the mongodb driver is not installed (npm install)'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusk-waitlist-mongod-'));
  const mport = await freePort();
  const mongod = spawn(bin, ['--dbpath', dir, '--port', String(mport), '--bind_ip', '127.0.0.1', '--quiet', '--logpath', path.join(dir, 'log')], { stdio: 'ignore' });
  const uri = `mongodb://127.0.0.1:${mport}`;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  let s;
  try {
    await client.connect();
    const db = client.db('dusk_test');
    s = await startServer({ MONGODB_URI: uri, MONGODB_DB: 'dusk_test' });
    await suite('mongo', { port: s.port, logs: () => s.logs }, async () => (await db.collection('waitlist').find().sort({ position: 1 }).toArray())
      .map((x) => ({ email: x.email, source: x.source, at: x.createdAt })));
    await check('[mongo] unique indexes on email and position', async () => {
      const names = (await db.collection('waitlist').indexes()).map((i) => i.name);
      assert.ok(names.includes('email_unique') && names.includes('position_unique'), names.join(','));
    });
    await check('[mongo] database down: the site still serves, the waitlist answers 500', async () => {
      s.server.kill();
      const down = await startServer({ MONGODB_URI: `mongodb://127.0.0.1:${await freePort()}/?serverSelectionTimeoutMS=500`, MONGODB_DB: 'dusk_test' });
      try {
        const home = await fetch(`http://127.0.0.1:${down.port}/`);
        assert.equal(home.status, 200);
        const r = await fetch(`http://127.0.0.1:${down.port}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '10.9.9.9' }, body: JSON.stringify({ email: 'down@db.dev' }) });
        assert.equal(r.status, 500);
      } finally { down.server.kill(); }
    });
  } finally {
    s?.server.kill();
    await client.close().catch(() => {});
    mongod.kill();
    await new Promise((ok) => (mongod.exitCode !== null ? ok() : mongod.once('exit', ok)));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

await fileRun();
await capRun();
const bin = findMongod();
if (bin) await mongoRun(bin);
else results.push('skip [mongo] no mongod binary (set WAITLIST_TEST_MONGOD or put mongod on PATH)');
console.log(results.join('\n'));
