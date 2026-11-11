// where waitlist signups live. server.js only talks to openStore(); swap this file's insides for another backing store
// (a database, say) and keep the same two calls:
//   add(email, meta) -> Promise<{ position, existing }>   email is already trimmed, lowercased and valid
//   count()          -> Promise<number>
// the default is an append-only jsonl file, one signup per line, in signup order. zero deps.
import fs from 'node:fs';
import path from 'node:path';

export function openStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // email -> position, read once at start; the file is the record, this is the index
  const seen = new Map();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const { email } = JSON.parse(line); if (email && !seen.has(email)) seen.set(email, seen.size + 1); } catch {}
    }
  }
  // appends run one after another, so lines land in position order
  let tail = Promise.resolve();
  return {
    async add(email, { source = null, ref = null, ua = null } = {}) {
      if (seen.has(email)) return { position: seen.get(email), existing: true };
      const position = seen.size + 1;
      seen.set(email, position);
      const line = JSON.stringify({ email, ts: new Date().toISOString(), source, ref, ua }) + '\n';
      const write = tail.then(() => fs.promises.appendFile(file, line, { mode: 0o600 }));
      tail = write.catch(() => {});
      try { await write; } catch (err) { seen.delete(email); throw err; }
      return { position, existing: false };
    },
    async count() { return seen.size; },
  };
}
