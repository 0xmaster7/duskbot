// plans the per-action pages (/integrations/<app>/<action>): every action of every app that has an integration page,
// from its composio facts, that is not deprecated and that composio describes properly. actions composio marks
// "important" come first; each app's list mixes reads, changes and sends. writes seo/action-candidates.json (the
// queue the drafting batches take from) and adds the addresses to seo/planned.json, so pages may link to each other.
//   node seo/scripts/plan-actions.mjs            write the plan and print the counts
//   node seo/scripts/plan-actions.mjs --batch=12  also print the next 12 undrafted candidates per app, as a batch
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecords, seoDir } from '../records.mjs';

const slugify = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');

export function plan() {
  const records = loadRecords();
  const have = new Set(records.map((r) => r.path));
  const apps = records.filter((r) => r.kind === 'integration' && r.app?.toolkit);
  const out = [];
  for (const app of apps) {
    const facts = JSON.parse(fs.readFileSync(path.join(seoDir, 'facts', 'connectors', `${app.app.toolkit}.json`), 'utf8'));
    const ok = facts.tools.filter((t) => !t.deprecated && (t.description || '').length >= 60);
    const rank = (t) => (t.tags || []).includes('important') ? 0 : 1;
    // important first, then interleave read, write, send so a batch is never all one kind
    const byKind = { read: [], write: [], send: [] };
    for (const t of [...ok].sort((a, b) => rank(a) - rank(b))) byKind[t.kind].push(t);
    const mixed = [];
    while (byKind.read.length || byKind.write.length || byKind.send.length) for (const k of ['read', 'write', 'send', 'read']) if (byKind[k].length) mixed.push(byKind[k].shift());
    const seen = new Set();
    for (const t of mixed.sort((a, b) => rank(a) - rank(b))) {
      let p = `${app.path}/${slugify(t.name)}`;
      if (seen.has(p)) p = `${p}-${slugify(t.slug.slice(app.app.toolkit.length + 1)).slice(0, 20)}`;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push({ path: p, toolkit: app.app.toolkit, app: app.app.name, slug: t.slug, name: t.name, kind: t.kind, important: rank(t) === 0, drafted: have.has(p) });
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = plan();
  fs.writeFileSync(path.join(seoDir, 'action-candidates.json'), JSON.stringify(list, null, 1) + '\n');
  const plannedFile = path.join(seoDir, 'planned.json'), planned = JSON.parse(fs.readFileSync(plannedFile, 'utf8'));
  planned.paths = [...new Set([...planned.paths, ...list.map((c) => c.path)])];
  fs.writeFileSync(plannedFile, JSON.stringify(planned, null, 1) + '\n');
  const by = {};
  for (const c of list) { by[c.toolkit] ||= { all: 0, important: 0, drafted: 0 }; by[c.toolkit].all++; by[c.toolkit].important += c.important; by[c.toolkit].drafted += c.drafted; }
  console.log(`${list.length} action pages possible across ${Object.keys(by).length} apps; ${list.filter((c) => c.important).length} composio marks important; ${list.filter((c) => c.drafted).length} drafted`);
  for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v.all} (${v.important} important, ${v.drafted} drafted)`);
  const n = Number(process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] || 0);
  if (n) {
    const batch = Object.keys(by).flatMap((k) => list.filter((c) => c.toolkit === k && !c.drafted).slice(0, n));
    fs.writeFileSync(path.join(seoDir, 'action-batch.json'), JSON.stringify(batch, null, 1) + '\n');
    console.log(`batch of ${batch.length} in seo/action-batch.json`);
  }
}
