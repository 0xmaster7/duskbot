// where waitlist signups live. server.js only talks to openStore(); swap this file's insides for another backing store
// (a database, say) and keep the same two calls:
//   add(email, meta) -> Promise<{ position, existing }>   email is already trimmed, lowercased and valid
//   count()          -> Promise<number>
//   unsubscribe(email) -> Promise<{ found }>   marks the entry, never removes it
// the default is an append-only jsonl file, one signup per line, in signup order. zero deps.
import fs from 'node:fs';
import path from 'node:path';

export function openStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // email -> position, read once at start; the file is the record, this is the index
  const seen = new Map();
  const unsubscribed = new Set();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const { email, unsubscribedAt } = JSON.parse(line);
        if (email && unsubscribedAt) unsubscribed.add(email);
        else if (email && !seen.has(email)) seen.set(email, seen.size + 1);
      } catch {}
    }
  }
  // appends run one after another, so lines land in position order
  let tail = Promise.resolve();
  const append = async (line) => {
    const write = tail.then(() => fs.promises.appendFile(file, line, { mode: 0o600 }));
    tail = write.catch(() => {});
    await write;
  };
  return {
    async add(email, { source = null, ref = null, ua = null } = {}) {
      if (seen.has(email)) return { position: seen.get(email), existing: true };
      const position = seen.size + 1;
      seen.set(email, position);
      const line = JSON.stringify({ email, ts: new Date().toISOString(), source, ref, ua }) + '\n';
      try { await append(line); } catch (err) { seen.delete(email); throw err; }
      return { position, existing: false };
    },
    async count() { return seen.size; },
    async unsubscribe(email) {
      if (!seen.has(email)) return { found: false };
      if (!unsubscribed.has(email)) {
        await append(JSON.stringify({ email, unsubscribedAt: new Date().toISOString() }) + '\n');
        unsubscribed.add(email);
      }
      return { found: true };
    },
  };
}
