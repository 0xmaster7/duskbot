// how each kind of seo page is laid out. every page shares one frame (the docs' three columns: its hub's pages on the
// left, the article, "on this page" on the right) and gets, in this order: the answer, its picture, what its kind is
// built around (an action table, a comparison, a routine to copy ...), the record's own sections, questions, sources, one
// gentle call to action, related pages and a note on how the page was made. parts that every page of a kind shares are
// marked seo-boiler, so the quality gate counts only what is this page's own.
import fs from 'node:fs';
import path from 'node:path';
import { seoDir, HUBS } from './records.mjs';
import { sceneId } from './art/scene.mjs';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const day = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const connectorFacts = new Map();
export function connector(toolkit) {
  if (!connectorFacts.has(toolkit)) {
    const file = path.join(seoDir, 'facts', 'connectors', `${toolkit}.json`);
    if (!fs.existsSync(file)) throw new Error(`no facts for the ${toolkit} toolkit: run node seo/scripts/fetch-composio.mjs ${toolkit}`);
    connectorFacts.set(toolkit, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return connectorFacts.get(toolkit);
}

export function templates(ctx) {
  const { markdown, esc, icon, bot, records, byPath, config, cta, preview } = ctx;
  const linkable = (at) => { const r = byPath.get(at); return !r || r.built; };
  // a link to a seo page that is not out yet stays as words, so no page ever links to something that is not there
  const guard = (html) => html.replace(/<a href="(\/[^"#?]*)([^"]*)">([\s\S]*?)<\/a>/g, (all, at, rest, words) => (linkable(at.replace(/\/$/, '') || '/') ? all : words));
  const sup = (html) => html.replace(/\[\^(\d+)\]/g, (_, n) => `<sup><a href="#src-${n}" aria-label="source ${n}">${n}</a></sup>`);
  const md = (s) => guard(sup(markdown(String(s || ''))));
  const inline = (s) => md(s).replace(/^<p>([\s\S]*)<\/p>$/, '$1');
  const slug = (s) => s.toLowerCase().replace(/<[^>]+>|&\w+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const copyBox = (message, label) => `<div class="code seo-copy">${label ? `<p class="code-label">${esc(label)}</p>` : ''}<pre><code>${esc(message)}</code></pre><button class="copy" type="button" data-copy>copy</button></div>`;
  const hero = (r, eager = true) => `<figure class="seo-hero"><img src="/art/seo/${sceneId(r.path)}.webp" srcset="/art/seo/${sceneId(r.path)}-660.webp 660w, /art/seo/${sceneId(r.path)}.webp 1320w" sizes="(max-width: 760px) 100vw, 660px" alt="${esc(r.alt)}" width="1320" height="528"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></figure>`;
  const section = (h, body, cls = '') => `<section class="seo-sec${cls ? ' ' + cls : ''}" aria-labelledby="${slug(h)}"><h2 id="${slug(h)}">${esc(h)}</h2>\n${body}\n</section>`;
  const list = (items) => `<ul>${items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
  const sections = (r) => (r.sections || []).map((s) => section(s.h, md(s.md))).join('\n');
  const table = (head, rows) => `<div class="table"><table><thead><tr>${head.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
  const srcRefs = (src) => (src || []).map((n) => `<sup><a href="#src-${n}" aria-label="source ${n}">${n}</a></sup>`).join('');

  // the related pages: those named in the record first, then the closest by shared apps, tags and kind, other kinds first
  function related(r) {
    const score = (o) => (r.related || []).includes(o.path) * 100 + (o.connectors || []).filter((c) => (r.connectors || []).includes(c)).length * 4
      + (o.tags || []).filter((t) => (r.tags || []).includes(t)).length * 3 + (o.type !== r.type) * 2 + (o.hub === r.hub);
    return records.filter((o) => o !== r && o.built && (preview || o.indexable || !r.indexable)).map((o) => [score(o), o]).filter(([s]) => s > 2)
      .sort((a, b) => b[0] - a[0] || a[1].path.localeCompare(b[1].path)).slice(0, config.related_count).map(([, o]) => o);
  }
  const card = (o, lazy = true) => `<li><a href="${o.path}"><img src="/art/seo/${sceneId(o.path)}-660.webp" alt="" width="660" height="264"${lazy ? ' loading="lazy"' : ''} decoding="async"><b>${esc(o.nav || o.h1)}</b><span>${esc(o.description)}</span></a></li>`;
  const ctaBlock = (r) => `<aside class="seo-cta seo-boiler" aria-label="get dusk bot">${bot('kit', 'violet')}<div><p>${esc(r.cta_line || cta.line)}</p><a class="btn dark" href="${cta.href}${cta.href === '/waitlist' ? `?source=${encodeURIComponent(`seo:${r.path}`)}` : ''}">${esc(cta.button)}</a></div></aside>`;
  const faq = (r) => (r.faq?.length ? section('questions', r.faq.map((q) => `<h3 id="${slug(q.q)}">${esc(q.q)}</h3>\n${md(q.a)}`).join('\n'), 'seo-faq') : '');
  const sources = (r) => (r.sources?.length ? `<section class="seo-sources" aria-labelledby="sources"><h2 id="sources">sources</h2><ol>${r.sources.map((s, i) => `<li id="src-${i + 1}">${s.url.startsWith('/') ? `<a href="${s.url}">${esc(s.label)}</a>` : `<a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.label)}</a>`}${s.checked ? `, checked ${day(s.checked)}` : ''}</li>`).join('')}</ol></section>` : '');

  // the body each kind of page is built around
  const BODY = {
    guide: (r) => `${r.table ? section(r.table.h, `${r.table.intro ? md(r.table.intro) : ''}${table(r.table.cols.map(esc), r.table.rows.map((row) => [inline(row.label), ...row.cells.map((c) => inline(c) || '')].map((c, i, all) => (i === all.length - 1 ? c + srcRefs(row.src) : c))))}`) : ''}${sections(r)}${r.steps ? section(r.steps.h, `<ol class="seo-steps">${r.steps.items.map((s) => `<li>${inline(s)}</li>`).join('')}</ol>`) : ''}`,

    compare: (r) => {
      const name = r.competitor?.name || r.compare.cols[0];
      const verdict = `<div class="seo-verdict"><div><h3>pick ${esc(r.verdict.them_title || name)} if</h3>${list(r.verdict.them)}</div><div><h3>pick ${esc(r.verdict.dusk_title || 'dusk bot')} if</h3>${list(r.verdict.dusk)}</div></div>`;
      const rows = r.compare.rows.map((row) => [inline(row.label), ...row.cells.map((c, i) => inline(c) + (i === row.cells.length - 1 ? srcRefs(row.src) : ''))]);
      return `${section('the short version', verdict)}\n${section(r.compare.h || 'side by side', `${r.compare.intro ? md(r.compare.intro) : ''}${table(['', ...r.compare.cols.map(esc)], rows)}`)}\n${sections(r)}\n${section('how we checked', md(r.method))}`;
    },

    integration: (r) => {
      const app = r.app, f = app.toolkit ? connector(app.toolkit) : null;
      let can = '';
      if (f) {
        const reads = f.tools.filter((t) => t.kind === 'read').length, sends = f.tools.filter((t) => t.kind === 'send').length;
        const rows = app.highlight.map((h) => { const t = f.tools.find((x) => x.slug === h.slug); if (!t) throw new Error(`${r.file}: ${h.slug} is not a ${app.toolkit} action in seo/facts/connectors/${app.toolkit}.json`); return [esc(t.name), { read: 'read', write: 'change', send: 'send: asks first' }[t.kind], inline(h.use)]; });
        can = section(`what a bot can do in ${app.name}`, `${md(app.intro)}${table(['action', 'dusk bot treats it as', 'what you would use it for'], rows)}<p class="seo-fact">composio, the connection service dusk bot uses for apps, lists <b>${f.tools_count} ${esc(f.name)} actions</b> (catalog version ${esc(f.version)}, read ${day(f.fetched_at)}${srcRefs([r.sources.findIndex((s) => s.url === f.source) + 1])}). dusk bot treats ${reads} of them as reads, ${sends} as sends and the other ${f.tools_count - reads - sends} as changes. an action counts as a read only when its name starts with a read word like get, list or search, so a bot you allow only to read can never call the rest. a send is anything that reaches a person outside the app or moves money${sends ? ', like ' + esc(f.tools.find((t) => t.kind === 'send').name.toLowerCase()) : ''}: it waits for your <b>Allow</b> unless you've given that bot a daily amount it may send alone.</p>${f.managed_sign_in ? '' : `<p class="callout careful">composio has no ready-made sign-in for ${esc(app.name)}. connecting it needs your own composio project key and an auth config of your own, added under <b>Settings</b>, <b>API keys</b>. on dusk cloud, ask us first.</p>`}`);
      } else can = section(`what a bot can do with ${app.name}`, md(app.intro));
      const steps = app.toolkit ? `<ol class="seo-steps seo-boiler"><li>open <b>Connected apps</b> in the sidebar.</li><li>pick ${esc(app.name)} and sign in on ${esc(app.name)}'s own page, so your password goes to them and never to a bot.</li><li>choose which bots may use it, and whether each may only read or may also change things. your bookkeeper doesn't need your ${esc(app.name)}.</li><li>ask in plain words. reading and drafting happen freely; sending asks you first.</li></ol>` : '';
      const routines = r.routines.map((x) => `<div class="seo-routine"><h3>${esc(x.name)}</h3>${copyBox(x.message)}<p class="seo-runs"><span>${esc(x.when)}</span>${x.output ? ` · ${inline(x.output)}` : ''}</p></div>`).join('');
      return `${can}\n${section(`connect ${app.name}`, `${steps}${app.setup ? md(app.setup) : ''}`)}\n${section('routines to copy', `${r.routines_intro ? md(r.routines_intro) : ''}${routines}`)}\n${section('what it asks you first', md(r.asks))}\n${section('what it cannot do', list(r.cannot))}\n${sections(r)}`;
    },

    usecase: (r) => `${section('the routine', `${r.routine.intro ? md(r.routine.intro) : ''}${copyBox(r.routine.message, 'paste this into a chat with your bot')}<dl class="seo-specs"><div><dt>when</dt><dd>${inline(r.routine.when)}</dd></div><div><dt>needs</dt><dd>${inline(r.routine.needs)}</dd></div></dl>${r.routine.output ? `<p class="code-label">what comes back looks like this (an example, not a real inbox)</p><div class="code plain seo-sample"><pre><code>${esc(r.routine.output)}</code></pre></div>` : ''}`)}\n${sections(r)}\n${section('the guard rails', list(r.safeguards))}`,

    role: (r) => `${section(r.day_h || 'a day with bots', table(['when', 'what a bot does'], r.day.map((d) => [esc(d.when), inline(d.what)])))}\n${section('the routines', r.pack.map((p) => `<div class="seo-routine"><h3>${esc(p.name)}</h3>${copyBox(p.message)}${p.note ? `<p class="seo-runs">${inline(p.note)}</p>` : ''}</div>`).join(''))}\n${sections(r)}`,

    routine: (r) => `${section('the message', `${copyBox(r.routine.message, 'paste this into a chat with your bot')}<dl class="seo-specs"><div><dt>when</dt><dd>${inline(r.routine.when)}</dd></div><div><dt>needs</dt><dd>${inline(r.routine.needs)}</dd></div></dl>`)}\n${r.routine.output ? section('what comes back', `<p class="code-label">an example, not a real run</p><div class="code plain seo-sample"><pre><code>${esc(r.routine.output)}</code></pre></div>`) : ''}\n${section('make it yours', list(r.knobs))}\n${section('when it goes wrong', list(r.fails))}\n${sections(r)}`,

    glossary: (r) => `${section('in one line', `<p class="seo-def">${inline(r.definition)}</p>`)}\n${section('an example', md(r.example))}\n${sections(r)}`,

    tool: (r) => {
      const file = path.join(seoDir, 'tools', `${r.tool}.html`);
      return `<div class="seo-tool">${fs.readFileSync(file, 'utf8')}</div>\n${section('how it works out the numbers', md(r.method))}\n${sections(r)}`;
    },
  };

  function sidebar(r, hub) {
    const sibs = records.filter((o) => o.hub === r.hub && o.built && (preview || o.indexable || !r.indexable));
    const near = related(r).map((o) => o.path);
    const shown = sibs.length > config.sidebar_max ? sibs.filter((o) => o === r || near.includes(o.path)).concat(sibs.filter((o) => o !== r && !near.includes(o.path))).slice(0, config.sidebar_max) : sibs;
    const groups = hub.groups.map((g) => [g, shown.filter((o) => g.types.includes(o.type))]).filter(([, l]) => l.length);
    return groups.map(([g, l]) => `<div role="group" aria-label="${esc(g.title)}"><p class="nh" aria-hidden="true">${esc(g.title)}</p><ul>${l.map((o) => `<li><a href="${o.path}"${o === r ? ' aria-current="page"' : ''}>${esc(o.nav || o.h1)}</a></li>`).join('')}</ul></div>`).join('')
      + `<p class="seo-all"><a href="${hub.at}">every page in ${esc(hub.nav)}</a></p>`;
  }

  function page(r) {
    const hub = HUBS[r.hub];
    const main = BODY[r.kind](r);
    const heads = [...main.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)];
    const rel = related(r);
    const toc = `<aside class="doc-toc"><nav aria-label="on this page"><h2>on this page</h2><ol>${heads.map((m) => `<li><a href="#${m[1]}">${m[2]}</a></li>`).join('')}${r.faq?.length ? '<li><a href="#questions">questions</a></li>' : ''}${r.sources?.length ? '<li><a href="#sources">sources</a></li>' : ''}</ol></nav></aside>`;
    const updated = r.updated || r.verified;
    const body = `<div class="docs wrap seo">
<aside class="docs-side"><nav class="docs-nav" aria-label="${esc(hub.nav)}">${sidebar(r, hub)}</nav></aside>
<details class="docs-jump"><summary><span>${esc(hub.nav)}</span><b>${esc(r.nav || r.h1)}</b>${icon('chevron-down')}</summary><nav class="docs-nav" aria-label="${esc(hub.nav)}, every page">${sidebar(r, hub)}</nav></details>
<article class="doc prose seo-page">
<p class="crumb"><a href="/">dusk bot</a><span aria-hidden="true">/</span><a href="${hub.at}">${esc(hub.nav)}</a></p>
<header class="seo-top"><h1>${esc(r.h1)}</h1>
<p class="lede seo-answer">${inline(r.answer)}</p>
<p class="seo-meta seo-boiler">by <a href="${config.author_url}">${esc(config.byline)}</a> · checked <time datetime="${updated}">${day(updated)}</time> · <a href="#how-made">how we made this</a></p></header>
${hero(r)}
${main}
${faq(r)}
${ctaBlock(r)}
${sources(r)}
${rel.length ? `<section class="seo-related seo-boiler" aria-labelledby="related"><h2 id="related">read next</h2><ul class="seo-cards">${rel.map((o) => card(o)).join('')}</ul></section>` : ''}
<p class="seo-made seo-boiler" id="how-made">${esc(config.made)}</p>
</article>
${toc}
</div>`;
    return { body, related: rel };
  }

  function hubPage(hub) {
    const pages = records.filter((o) => o.hub === hub.id && o.built && (preview || o.indexable));
    const groups = hub.groups.map((g) => [g, pages.filter((o) => g.types.includes(o.type))]).filter(([, l]) => l.length);
    const others = Object.entries(HUBS).filter(([id]) => id !== hub.id && ctx.hubs.some((h) => h.id === id));
    const body = `<header class="phead wrap"><p class="crumb"><a href="/">dusk bot</a><span aria-hidden="true">/</span>${esc(hub.nav)}</p><h1>${esc(hub.h1)}</h1><p class="lede">${esc(hub.lede)}</p></header>
<figure class="wrap seo-hub-hero"><img src="/art/seo/${sceneId(hub.at)}.webp" srcset="/art/seo/${sceneId(hub.at)}-660.webp 660w, /art/seo/${sceneId(hub.at)}.webp 1320w" sizes="(max-width: 760px) 100vw, 1160px" alt="${esc(HUBS[hub.id].alt)}" width="1320" height="528" fetchpriority="high" decoding="async"></figure>
${groups.map(([g, l], i) => `<section class="wrap seo-hub" aria-labelledby="${g.id}"><h2 id="${g.id}">${esc(g.title)}</h2><ul class="seo-cards">${l.map((o) => card(o, i > 0 || l.indexOf(o) > 2)).join('')}</ul></section>`).join('\n')}
${others.length ? `<nav class="wrap seo-hubs" aria-label="more"><h2>more to read</h2><ul>${others.map(([, h]) => `<li><a href="${h.at}">${esc(h.nav)}</a></li>`).join('')}<li><a href="/docs">the docs</a></li></ul></nav>` : ''}`;
    return { body, pages };
  }

  return { page, hubPage, related };
}
