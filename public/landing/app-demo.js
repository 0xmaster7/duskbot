// the app window in the hero: a small hand-written copy of dusk bot's main window. every reply is canned and nothing
// leaves the page. the first state is plain html (pages/partials/app-demo.html); this only adds behaviour.
(() => {
  const root = document.querySelector('[data-dd]');
  if (!root) return;
  const $ = (s, at = root) => at.querySelector(s), $$ = (s, at = root) => [...at.querySelectorAll(s)];
  const app = $('.dd-app'), list = $('.dd-list'), scroller = $('.dd-scroll'), input = $('.dd-in'), box = $('.dd-box');
  const go = $('.dd-go'), pill = $('.dd-pill'), back = $('.dd-back'), panel = $('.dd-panel');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clock = (d = new Date()) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const phone = () => getComputedStyle(back).display !== 'none';

  /* ---------- the sample workspace: a two-person shop that sells mugs ---------- */
  const GET = '[Download Dusk Bot](/download)';
  const BOTS = {
    dusk: { n: 'Dusk', model: 'Claude', doing: 'routing it to the right bot',
      hi: "Hey. I'm Dusk, your chief of staff. Hand me anything and I'll get it to the right bot.",
      can: 'I run the team. Give me a task and I pick who does it, check on the others and tell you what needs you. Try asking what the bots are up to.',
      on: /bots?\b.*(up to|doing)|status|what'?s (happening|going on|new)|update|standup|anything (new|for me)/,
      re: { md: 'Right now:\n| Bot | Did | Needs you |\n| --- | --- | --- |\n| Echo | Sorted five emails | Two replies |\n| Quill | Drafted the holiday email | A subject line |\n| Rivet | Fixed the checkout button | Nothing |\n| Tally | Closed October | Nothing |\nQuill is the one waiting on you.', steps: ['Checking on the team'] },
      log: [['d', 0], ['b', "Hey! I'm Dusk. I'm new here.\n---\nI'm here to be your Chief of Staff. I can manage your other bots. Task me with anything. I'll make sure it gets to the right bot.\n---\nI'm taking a look around to see if there's anything I can pick up for you. I'll follow up in a moment.\n---\nI looked around and nothing's waiting on you yet. You have 8 other bots and 5 routines, and no apps are connected so far. If you'd like me to keep an eye on your day, I can connect your email and calendar so I can flag what matters each morning. Just say the word, or hand me whatever's on your plate today."]] },
    echo: { n: 'Echo', model: 'ChatGPT', doing: 'drafting a kind reply',
      hi: 'Hi, Echo here. I sort the support inbox and draft the kind replies.',
      can: 'I triage the inbox: breakage claims, order changes, wholesale questions. I sort by urgency, draft replies and never promise a refund without your yes.',
      on: /inbox|e-?mail|repl(y|ies)|refund|customer|order|draft|support/,
      re: { md: "Draft for Order 1187:\n> Hi Sam, I'm so sorry your mug arrived cracked. A replacement in the same glaze can ship tomorrow, and there's no need to send the broken one back.\nSay yes and it goes out. In the demo, saying yes is as far as it gets.", steps: ['Reading the inbox'] },
      log: [['d', 'Today 12:26 AM'], ['u', "What's in the inbox this morning?"], ['new'], ['b', 'Five new emails:\n| Priority | From | About |\n| --- | --- | --- |\n| High | Order 1187 | Mug arrived cracked, photo attached |\n| High | Order 1192 | Wrong glaze sent (Ember instead of Frost) |\n| Medium | Café on Elm St | Wholesale price for 40 mugs |\n| Low | Order 1179 | Asks if mugs are dishwasher safe |\n| Low | Newsletter | Unsubscribe request, done |\nI drafted replies for the first two; both need your yes before I offer a replacement.']] },
    quill: { n: 'Quill', model: 'Claude', doing: 'on option three of three',
      hi: 'Hello. Quill, copywriter. Warm, plain and a little playful, never pushy.',
      can: "Product pages, emails and subject lines. Ask for copy and you get three numbered options and the one I'd use.",
      on: /subject|headline|copy|writ|tagline|slogan|e-?mail|newsletter|product page|words/,
      re: { md: "Three for the Pine mug:\n1. A forest green that makes coffee look good\n2. Pine: the quiet one\n3. Thrown by hand, glazed like a winter walk\nI'd use the second. Short sells." },
      log: [['d', 'Today 12:46 AM'], ['u', 'Draft the holiday gift email for the newsletter.'], ['b', "Here's the body:\nOur kiln has been busy. This winter's mugs come in three new glazes, **Frost**, **Ember** and **Pine**, each one a little different because that's how handmade goes. Order by 15 December for delivery before the holidays."], ['new'], ['b', 'Which subject line should go out?'],
        ['a', { t: 'All three fit the preview text. The first one tested best last year.', o: ['Three new glazes, just in time', 'Your mug shelf called', 'Order by 15 December'], then: (i, o) => ({ md: `"${o}" it is. In the app the newsletter would be scheduled by now. Here I'm just pleased with us.` }) }]] },
    nova: { n: 'Nova', model: 'Claude', doing: 'three tabs deep',
      hi: 'Hi. Nova, market research. I compare prices, read reviews and spot trends.',
      can: 'Give me a market question and I come back with the one finding that matters and a small table. The thread above is how I usually answer.',
      on: /price|compet|research|review|market|shipping|trend|compar|mug/,
      re: { md: 'Free shipping thresholds, same four shops:\n| Shop | Free over | Avg. order |\n| --- | --: | --: |\n| Clayhouse Studio | 60 | 71 |\n| Glaze & Co | 0 | 44 |\n| North Kiln | none | 39 |\n| Juniper Lane | none | 37 |\nA threshold of 60 would nudge most of our orders up by one mug.', steps: ['Searching the web', 'Reading three shop pages', 'Running compare.py'], file: ['thresholds.csv', 'CSV'] } },
    rivet: { n: 'Rivet', model: 'Grok', doing: 'reading the stack trace',
      hi: 'Rivet. I keep the storefront, the checkout and the scripts running.',
      can: "I maintain the shop's site and a few Python scripts. I explain a change in one plain sentence first, and I never run or deploy anything without saying exactly what it does.",
      on: /bug|fix|code|deploy|test|script|checkout|site|build|error|broken|ship it/,
      re: { md: 'The whole fix was one line:\n```\n// before: the promise was dropped on iOS Safari\nonClick={submit}\n// after\nonClick={() => void submit()}\n```\nTests pass. Putting it live needs your yes.', steps: ['Reading app/cart/page.tsx', 'Running pnpm test cart'], ask: 'ship' },
      log: [['d', 'Yesterday 8:16 PM'], ['u', 'Customers say the checkout button does nothing on phones.'], ['n', 'Ran a command', 'pnpm build && pnpm deploy:preview'], ['b', "Fixed: the checkout button now works on phones. A promise was being dropped on iOS Safari, so the click did nothing. The preview link is ready; I added a test so it can't come back quietly."]] },
    moss: { n: 'Moss', model: 'Gemini', doing: 'checking the soil',
      hi: 'Hello. Moss. Tell me about the light, the watering and the pot.',
      can: 'Plant care. I ask about light, water and the pot before I guess, then give the fix as short numbered steps.',
      on: /plant|lea(f|ves)|water|soil|sun|light|yellow|pot\b|grow|garden|flower/,
      re: { md: 'Before I guess:\n1. How many hours of direct sun does it get?\n2. When did you last water, and does the pot drain?\n3. Are new leaves coming, or only old ones dropping?\nMost sad plants are overwatered. Kindness is the usual cause.' },
      log: [['d', 'Yesterday 7:16 PM'], ['u', 'The rubber plant by the window has yellow lower leaves.'], ['b', "Lower leaves going yellow is usually too much water rather than too little.\n1. Push a finger 3 cm into the soil; if it's damp, wait.\n2. Water only when the top third is dry, about every 10 days in winter.\n3. Make sure the pot drains; empty the saucer after watering.\nOne or two old leaves dropping is normal."]] },
    tally: { n: 'Tally', model: 'ChatGPT', doing: 'adding it up twice',
      hi: 'Hi, Tally. I keep the books.',
      can: 'Sales, materials, shipping and fees. I close each month with a short summary and round to whole units so it reads at a glance.',
      on: /money|profit|sales|books|this month|invoice|tax|numbers?|revenue|budget|november|october/,
      re: { md: 'November so far:\n| | Amount |\n| --- | --: |\n| Sales | 3,420 |\n| Materials | 610 |\n| Shipping labels | 700 |\n| Fees | 170 |\n| **Profit** | **1,940** |\nShipping is a fifth of sales again.', steps: ['Reading orders-2026-11.csv'], file: ['november-so-far.md', 'MD'] },
      log: [['d', 'Yesterday 5:16 AM'], ['u', 'Close October for me.'], ['b', 'October made **2,780 profit** on 4,960 in sales. Shipping labels were the biggest cost again, about a fifth of sales. Full summary attached.', { file: ['october-summary.md', 'MD'], react: '\u{1F44D}' }]] },
    basil: { n: 'Basil', model: 'Gemini', doing: 'writing the shopping list',
      hi: "Hey, Basil here. What's in the fridge?",
      can: 'Weeknight dinners under 30 minutes for two. I reuse ingredients across the week and always end with a shopping list grouped by aisle.',
      on: /dinner|meal|recipe|cook|food|eat|lunch|hungry|shopping|fridge|breakfast|snack/,
      re: { md: 'Tonight, 25 minutes:\n**Lemon pasta with spinach**\n- Boil the pasta, save a cup of the water\n- Wilt spinach in garlic and oil\n- Toss with lemon, feta and the water\n**Shopping list**\n- Produce: 1 lemon, spinach\n- Dairy: feta' },
      log: [['d', 'Monday 11:16 PM'], ['u', 'Plan five quick dinners, we have chickpeas and spinach to use up.'], ['b', '1. Chickpea and spinach curry\n2. Lemon pasta with spinach\n3. Crispy chickpea wraps\n4. Shakshuka with spinach\n5. Leftover curry fried rice\n**Shopping list**\n- Produce: lemons, onions, garlic, tomatoes\n- Dairy: feta, eggs\n- Pantry: coconut milk, wraps, rice'], ['u', 'Swap the shakshuka, we had eggs twice already.'], ['b', 'Swapped it for a tray-bake of sweet potato, chickpeas and spinach. Same shopping list minus the eggs, plus two sweet potatoes.']] },
    juno: { n: 'Juno', model: 'Claude', doing: 'comparing train times',
      hi: 'Hi, Juno. Where are we going?',
      can: 'Short trips and trade-fair visits with realistic timings, one backup option and a rough budget. Lists over paragraphs.',
      on: /trip|train|travel|flight|hotel|fair|weekend|holiday|vacation|go to|visit|book/,
      re: { md: "Rough shape:\n- Out: the 07:52 train, arriving 11:40\n- Back: the 18:42 the next day\n- Backup: the 09:15 if things run late\nBudget about 310 with one night. In the app I'd open the booking pages on my own computer and you could watch.", steps: ['Checking train times'] },
      log: [['d', 'Monday 1:16 AM'], ['u', 'Plan the trip to the spring craft fair in Ghent, two days.'], ['b', '**Friday**\n- 07:52 train, arrive 11:40, check in near the Korenmarkt\n- 14:00-18:00 set up the stall\n**Saturday**\n- 09:00-17:00 fair\n- 18:42 train home\nBudget: about 310 for trains, one night and the stall fee. Backup: the 09:15 train if setup starts later.']] },
    room: { n: 'Shop standup',
      log: [['d', 'Yesterday 10:21 PM'], ['u', 'Morning, quick standup please.'], ['b', 'Price comparison is done; shipping is our weak spot. Next: a free-shipping test plan.', { from: 'nova' }], ['b', 'Holiday email drafted. Blocked on a subject line pick.', { from: 'quill' }], ['b', 'Checkout fix is on the preview link. Next: ship it after a phone test.', { from: 'rivet' }], ['b', 'Two breakage claims waiting for a yes on replacements.', { from: 'echo' }]] },
  };
  const ASKS = {
    ship: { t: 'Allow Rivet to run a command?', code: 'pnpm build && pnpm deploy', o: ['Allow once', 'Deny'], then: (i) => i ? { md: "Not touching it. The fix stays on my branch until you say so." } : { note: ['Ran a command', 'pnpm build && pnpm deploy'], md: 'Deployed. In this demo "deployed" means I nodded with confidence, but the card you just clicked is the real thing: I ask before anything that ships, sends, buys or deletes.' } },
    sudo: { t: 'Allow you to run a command?', o: ['Allow once', 'Deny'], then: (i) => ({ md: i ? "Good call. I wasn't going to anyway." : 'Nice try. I ran `echo no` instead.' }) },
  };
  // asking what the app costs beats a bot's own subject
  const PRICE = /is (it|this|that|dusk) (really )?free|how much (is|does) (it|this|dusk)|what does (it|this|dusk) cost|pricing|subscription/;
  // answers every bot knows, checked in order
  const FACTS = [
    [/^\/?help\b|what (can|should) i (type|ask|try|say)/, 'Things that work in this demo:\n- ask what I do, what it costs or where I run\n- `dance`, `good night`, `sudo` anything\n- say hi to Gary\n- shout in capitals\nEverything else gets an honest shrug.'],
    [/what (can|do) you do|who are you|your job|what are you (for|good)|what('?s| is) your (name|job)|introduce/, (b) => b.can],
    [/free|pric|cost|pay\b|paid|\$|plans?\b|subscription|how much/, 'Free for personal use, every feature, no account. Paid plans only add a cloud computer so I keep working with your laptop shut: Plus is $20 a month, Pro is $50. The AI itself is billed by whoever you already pay, never by Dusk. [See pricing](/pricing)'],
    [/where.*(run|live|work)|local|server|cloud|self.?host|vps|my (computer|machine|laptop|mac|pc)|offline/, 'Three places. On your computer: free, and everything stays on your disk. On your own server: one line, `curl -fsSL https://dusk.bot/install.sh | sh`. Or on a Dusk cloud computer that sleeps when idle and wakes for work.'],
    [/who (made|built|created|makes)|what is (this|dusk)|dusk bot/, `Dusk Bot is a desktop app where you run a team of bots like me and message us like teammates. Each of us has a job, a chat of our own and notes on how you like things done. I'm the copy that lives on this page. ${GET}`],
    [/model|claude|chatgpt|gpt|gemini|grok|openai|anthropic|api key|which ai|llm|cursor|copilot|deepseek/, (b) => `Dusk has no model of its own. You sign in with the AI you already pay for: Claude, ChatGPT, Gemini, Grok, or your own API key. I'm set to ${b.model} right now. Swap it any time and I keep my chats, files and memory.`],
    [/download|install|get (it|the app|started)|try (it|the real)|sign ?up|windows|linux|macos/, `macOS, Windows and Linux, about a minute to set up. No account needed to run it on your own computer. ${GET}`],
    [/routine|schedul|every (day|week|morning|monday|friday|hour)|remind|cron|automat|while i sleep/, 'That\'s a routine. Ask once, like "every weekday at 8:00, check the inbox", and it runs on that schedule or when something happens, a new GitHub issue for example. Here I can only describe it.'],
    [/your (own )?computer|browser|click|screen|mouse|desktop|watch you/, 'In the real app I can have my own computer: a browser and a desktop I sign in to and click through. You can watch live and take the mouse back whenever you like.'],
    [/safe|privacy|private|secur|my data|trust|scary|permission|ask (first|before)|dangerous/, 'We ask before the scary stuff: sending, buying, deleting. You get a card with Allow and Deny and nothing happens until you pick. On your own computer everything stays on your disk.'],
    [/connect|gmail|slack|notion|github|calendar|drive|apps\b|integrat|mcp|linear|stripe/, '60+ apps: Gmail, Calendar, Drive, Slack, Notion, GitHub, Linear, Stripe and more, plus any MCP server you add. Connect one and every bot you allow can use it.'],
    [/voice|call\b|talk|speak|microphone/, 'In the app, yes: I talk back and you can call me. This demo is text only, so please imagine a pleasant voice.'],
    [/rooms?\b|group|other bots|hand ?(off|over)|together/, "Put several of us in one room and we hand work to each other. There's one in the sidebar: Shop standup."],
    [/memory|remember|forget|notes\b/, 'I keep notes on how you like things done, and you can read and edit them. Nothing mysterious, it is a text file.'],
    [/are you (real|human|alive|an? ai|a bot|a robot)|sentient|conscious|turing/, `I'm a recording of myself: a dozen answers and some blinking. The real one thinks. ${GET}`],
    [/\b(thanks?|thank you|thx|ty|cheers)\b|^(nice|great|awesome|cool|perfect|good bot|love (it|this))\b/, () => pick(['Any time.', "Happy to. That's the job.", 'Noted in my good-day file.'])],
    [/joke|funny|make me laugh/, () => pick(["I'd tell you a UDP joke, but you might not get it.", 'Why did the bot cross the road? A routine fired at 8:00.', 'My whole personality fits in 20 kilobytes. That is the joke.'])],
    [/^(ping)\b/, 'pong'],
    [/meaning of life|\b42\b/, '42. Tally checked the maths twice.'],
    [/best bot|favou?rite bot/, "Me. Don't tell the others."],
    [/stupid|dumb|useless|bad bot|hate you|shut up|idiot|sucks?\b|trash|f+u+c+k/, "Fair. I'm the demo: a dozen answers in a trench coat. The real one is sharper."],
    // a greeting only wins when the message asks nothing else
    [/^(hi+|hey+|hello+|yo|sup|hola|howdy|gm|good (morning|evening|afternoon))\b|anyone (here|there)|you there/, (b) => b.hi],
  ];
  const SHRUGS = [
    (b) => `I'm the demo copy of ${b.n}, so I only know a few lines. The real one would have started on that already. ${GET}`,
    (b) => `Good one for the real ${b.n}. I'm the version that lives on a web page and blinks.`,
    () => "That's past the edge of my script. I have about a dozen answers and you found the wall. Try `help`.",
    (b) => `In the app I'd be ${b.doing} by now. Here I can only nod with confidence.`,
  ];
  const TAPS = {
    search: 'Search looks through every chat and file. Here there are ten short chats, so let me save you the trouble: Nova has the table, Rivet has the code.',
    new: `A new bot takes about a minute in the app: a name, a job, a shape and a colour, and which AI it runs on. ${GET}`,
    you: "That's you. No account needed on your own computer; signing in is only for a cloud computer.",
    apps: FACTS.find(([on]) => on.test('connect'))[1],
    add: 'Files, photos and screenshots attach in the real app. I read them properly, too.',
    share: 'Sharing sends a bot to a teammate: its job and skills, not your chats. App only.',
    call: 'Calls need the real app and a microphone. I have a nice voice. You will have to take my word for it.',
  };

  /* ---------- markdown, just the parts the sample threads use ---------- */
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((\/[a-z]*)\)/g, '<a href="$2">$1</a>');
  const paint = (code) => esc(code).replace(/(\/\/.*$)|(&quot;.*?&quot;)|\b(import|from|as|const|let|await|return|void)\b/gm, (m, c, s, k) => c ? `<i class="dd-s">${c}</i>` : s ? `<i class="dd-s">${s}</i>` : `<i class="dd-k">${k}</i>`);
  const LI = /^(\d+\.|-) /;
  function md(src) {
    const out = [];
    let bubble = [];
    const flush = () => { if (bubble.length) out.push(`<div class="dd-b dd-md">${bubble.join('')}</div>`); bubble = []; };
    const lines = src.split('\n');
    for (let i = 0; i < lines.length;) {
      const l = lines[i];
      if (l === '---') { flush(); i++; continue; }
      if (l.startsWith('```')) {
        const code = [];
        for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
        i++; bubble.push(`<pre class="dd-code"><code>${paint(code.join('\n'))}</code></pre>`); continue;
      }
      if (l[0] === '|') {
        const rows = [];
        for (; i < lines.length && lines[i][0] === '|'; i++) rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim()));
        const [head, align, ...body] = rows, at = (j) => (align[j].endsWith(':') ? ' class="dd-r"' : '');
        flush();
        out.push(`<div class="dd-tbl"><table><thead><tr>${head.map((c, j) => `<th${at(j)}>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, j) => `<td${at(j)}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (LI.test(l)) {
        const tag = l[0] === '-' ? 'ul' : 'ol', items = [];
        for (; i < lines.length && LI.test(lines[i]); i++) items.push(`<li>${inline(lines[i].replace(LI, ''))}</li>`);
        bubble.push(`<${tag}>${items.join('')}</${tag}>`); continue;
      }
      bubble.push(l.startsWith('## ') ? `<h4>${inline(l.slice(3))}</h4>` : l.startsWith('> ') ? `<blockquote>${inline(l.slice(2))}</blockquote>` : `<p>${inline(l)}</p>`);
      i++;
    }
    flush();
    return out.join('');
  }
  const plain = (src) => (src.split('\n').filter((l) => l && !/^(\||```|---)/.test(l)).pop() || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]|^(> |## |\d+\. |- )/g, '');

  /* ---------- bots' faces ---------- */
  const STATES = ['dd-work', 'dd-happy', 'dd-nap'];
  const faces = (id) => $$(`.dd-av.dd-c-${id}`);
  const rowOf = (id) => $(`.dd-row[data-bot="${id}"]`);
  // a fresh copy of a bot's face, in whatever mood it is in
  function face(id) {
    const from = id === 'room' ? $('.dd-quad', rowOf(id)) : $('.dd-av', rowOf(id)), copy = from.cloneNode(true);
    for (const a of copy.matches('.dd-av') ? [copy] : $$('.dd-av', copy)) { a.classList.remove('dd-blink', 'dd-hop', 'dd-spin', 'dd-nod', 'dd-look'); $('.dd-eyes', a).style.transform = ''; }
    return copy;
  }
  function setState(id, state) {
    BOTS[id].state = state;
    for (const a of faces(id)) { a.classList.remove(...STATES); if (state) a.classList.add(state); }
  }
  function poke(id, move = 'dd-hop') {
    if (calm) return;
    for (const a of faces(id)) { a.classList.remove('dd-hop', 'dd-spin', 'dd-nod'); void a.getBoundingClientRect(); a.classList.add(move); }
    setTimeout(() => faces(id).forEach((a) => a.classList.remove(move)), 750);
  }
  let happyTimer = {};
  function cheer(id) {
    setState(id, 'dd-happy'); poke(id);
    clearTimeout(happyTimer[id]);
    happyTimer[id] = setTimeout(() => BOTS[id].state === 'dd-happy' && setState(id, ''), 3600);
  }
  // eyes follow the pointer, or the caret for a moment after a keystroke
  let seen = false, frame = 0, px = 0, py = 0, caret = null;
  function look() {
    frame = 0;
    const typing = caret && performance.now() < caret.until;
    for (const eyes of $$('.dd-side .dd-eyes, .dd-pill .dd-eyes, .dd-pav .dd-eyes')) {
      const av = eyes.parentNode, r = av.getBoundingClientRect();
      if (!r.width) continue;
      const mine = typing && av.classList.contains(`dd-c-${cur}`), x = mine ? caret.x : px, y = mine ? caret.y : py;
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, reach = Math.min(1, d / (r.width * 3)) * 5.5;
      eyes.style.transform = `translate(${(dx / d * reach).toFixed(1)}px,${(dy / d * reach * 0.8).toFixed(1)}px)`;
    }
  }
  const glance = () => { if (seen && !calm) frame ||= requestAnimationFrame(look); };
  if (!calm) addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; glance(); }, { passive: true });
  if (!calm) setInterval(() => {
    if (!seen || document.hidden) return;
    const a = pick($$('.dd-side .dd-av, .dd-pill .dd-av, .dd-pav .dd-av, .dd-mark .dd-av'));
    if (!a || a.classList.contains('dd-nap')) return;
    a.classList.add('dd-blink');
    setTimeout(() => a.classList.remove('dd-blink'), 130);
  }, 620);

  /* ---------- threads ---------- */
  let cur = 'nova', asleep = false;
  BOTS.nova.el = $('.dd-log');
  const item = {
    d: (when) => el('p', 'dd-day', when || `Today ${clock(new Date(Date.now() - 24e4))}`),
    u: (text) => { const row = el('div', 'dd-me-row'), b = el('div', 'dd-b dd-own'); b.textContent = text; row.append(b); return row; },
    b: (src, { file, react, from } = {}) => {
      const row = el('div', `dd-msg${from ? ` dd-c-${from}` : ''}`, md(src));
      if (from) { const who = el('div', 'dd-from'); who.append(face(from), BOTS[from].n); row.prepend(who); }
      if (react) { const last = $$('.dd-md', row).pop(); last.classList.add('dd-reacted'); last.prepend(el('span', 'dd-react', react)); }
      if (file) row.append(el('div', 'dd-file', `<span class="dd-doc${file[1] === 'CSV' ? ' dd-doc-csv' : ''}"><i></i><i></i><i></i><u></u></span><span class="dd-fn"><b>${file[0]}</b><span>${file[1]}</span></span>`));
      return row;
    },
    n: (text, detail) => {
      const row = el('div', 'dd-note', esc(text));
      if (detail) {
        const more = el('button', '', 'Details'), pre = el('pre');
        more.type = 'button'; more.setAttribute('aria-expanded', 'false'); pre.textContent = detail; pre.hidden = true;
        more.onclick = () => { pre.hidden = !pre.hidden; more.setAttribute('aria-expanded', String(!pre.hidden)); };
        row.append(more, pre);
      }
      return row;
    },
    new: () => { const row = el('div', 'dd-new', 'New'); row.setAttribute('role', 'separator'); return row; },
    a: (ask) => {
      const card = el('div', 'dd-ask', `<h5>${esc(ask.t)}</h5>${ask.code ? `<pre>${esc(ask.code)}</pre>` : ''}<div class="dd-opts">${ask.o.map((o, i) => `<button class="dd-opt" type="button"><kbd>${'ABCD'[i]}</kbd>${esc(o)}</button>`).join('')}</div>`);
      card.setAttribute('role', 'group'); card.setAttribute('aria-label', 'Question from your bot');
      card.ask = ask;
      return card;
    },
  };
  function logOf(id) {
    const bot = BOTS[id];
    if (!bot.el) {
      bot.el = el('div', 'dd-log');
      bot.el.setAttribute('role', 'log'); bot.el.setAttribute('aria-label', `Conversation with ${bot.n}`);
      for (const [kind, ...rest] of bot.log) bot.el.append(item[kind](...rest));
      bot.el.append(el('div', 'dd-slot'));
      sized?.observe(bot.el);
    }
    return bot.el;
  }
  const slotOf = (id) => $('.dd-slot', logOf(id));
  const atEnd = () => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 24;
  const toEnd = () => { scroller.scrollTop = scroller.scrollHeight; pinned = true; };
  // a thread resting at its end stays there when the window, the panel or a late font changes its size
  let pinned = true;
  scroller.addEventListener('scroll', () => { pinned = atEnd(); }, { passive: true });
  const sized = 'ResizeObserver' in window ? new ResizeObserver(() => pinned && toEnd()) : null;
  sized?.observe(scroller);
  // a new row: at the end of an open thread it rises 12px into place, as the app's rows do
  function add(id, row, mine) {
    const log = logOf(id), bot = BOTS[id], pinned = id === cur && (mine || atEnd());
    if (!bot.today) { bot.today = true; if (id !== 'dusk') log.insertBefore(item.d(`Today ${clock()}`), slotOf(id)); }
    if (id !== cur && !mine && !$('.dd-new', log)) log.insertBefore(item.new(), slotOf(id));
    log.insertBefore(row, slotOf(id));
    if (!pinned) return;
    toEnd();
    if (!calm && row.animate) row.animate([{ transform: 'translateY(12px)' }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }
  function preview(id, text, state = '') {
    const row = rowOf(id);
    row.classList.remove('dd-unread', 'dd-wait');
    if (state) row.classList.add(state);
    $('.dd-pv', row).textContent = text;
    $('.dd-tm', row).textContent = clock();
    $('.dd-sr', row).textContent = state === 'dd-unread' ? 'Unread' : state === 'dd-wait' ? 'Needs you' : '';
  }
  const pending = (id) => $('.dd-ask:not(.dd-done)', logOf(id));

  /* ---------- a turn: the mark pops in, thinks, says what it is doing, then the reply arrives whole ---------- */
  function status(id, who) {
    const slot = slotOf(id), line = el('div', 'dd-st'), mark = el('span', 'dd-mark'), label = el('span', 'dd-lab');
    mark.append(face(who), el('span', 'dd-dots', '<i></i><i></i><i></i>'));
    line.append(mark);
    line.setAttribute('role', 'status');
    slot.replaceChildren(line);
    if (id === cur && atEnd()) toEnd();
    return {
      think: (on) => mark.classList.toggle('dd-think', on),
      say: (text) => { label.remove(); label.textContent = text; line.append(label); },
      leave: async () => { line.classList.add('dd-out'); await nap(BOTS[id], 140); line.remove(); },
    };
  }
  const nap = (bot, ms) => new Promise((done) => { bot.wake = done; setTimeout(done, ms); });
  function say(id, parts) {
    const bot = BOTS[id], turn = {};
    (bot.turns ||= []).push(turn);
    bot.queue = (bot.queue || Promise.resolve()).then(() => run(id, [].concat(parts), turn)).catch((err) => { bot.turns = []; bot.busy = false; slotOf(id).replaceChildren(); sync(); console.error(err); });
    return bot.queue;
  }
  async function run(id, parts, turn) {
    const bot = BOTS[id];
    for (const part of parts) {
      if (turn.dead) break;
      const who = part.from || id;
      bot.busy = true; sync();
      if (!asleep) setState(who, 'dd-work');
      const line = status(id, who);
      await nap(bot, 520); line.think(true);
      await nap(bot, 460); line.think(false);
      for (const step of part.steps || []) { if (turn.dead) break; line.say(step); await nap(bot, 950 + Math.random() * 500); }
      if (!turn.dead) { line.say('Typing…'); await nap(bot, Math.min(1900, 520 + part.md.length * 6)); }
      await line.leave();
      if (BOTS[who].state === 'dd-work') setState(who, '');
      if (turn.dead) break;
      land(id, part);
    }
    bot.turns.splice(bot.turns.indexOf(turn), 1);
    bot.busy = bot.turns.length > 0; sync();
  }
  // a reply arrives whole: any note, the bubbles, then a card if it needs an answer
  function land(id, part) {
    const ask = part.ask && ASKS[part.ask], who = part.from || id;
    if (part.note) add(id, item.n(...part.note));
    add(id, item.b(part.md, part));
    if (ask) add(id, item.a(ask));
    preview(id, ask ? `Waiting for you: ${ask.t}` : (part.from ? `${BOTS[who].n}: ` : '') + plain(part.md), ask ? 'dd-wait' : id === cur ? '' : 'dd-unread');
    if (!asleep) cheer(who);
  }
  function stop() {
    const bot = BOTS[cur];
    for (const turn of bot.turns || []) turn.dead = true;
    bot.wake?.();
    add(cur, item.n('Stopped'));
  }

  /* ---------- what a bot says back ---------- */
  function answer(id, said) {
    const text = said.toLowerCase().trim(), bot = BOTS[id === 'room' ? 'nova' : id];
    const other = Object.keys(BOTS).find((k) => k !== id && k !== 'room' && new RegExp(`\\b${k}\\b`).test(text));
    let re;
    if (/^sudo\b|rm -rf|drop table/.test(text)) re = { md: 'One moment. Rules are rules.', ask: 'sudo', code: said };
    else if (/\bgary\b|\bcats?\b|meow/.test(text)) re = { md: 'Gary is asleep further down this page. Not included. We asked him to join the team and he left the chat.' };
    else if (/danc|party|celebrat|woo+|\u{1F389}/u.test(text)) { Object.keys(BOTS).forEach((k, i) => k !== 'room' && setTimeout(() => poke(k, i % 2 ? 'dd-spin' : 'dd-hop'), i * 70)); re = { md: "We don't get out much." }; }
    else if (/good ?night|sleep|nap\b|zzz|bed ?time|go to bed/.test(text)) { asleep = true; Object.keys(BOTS).forEach((k) => k !== 'room' && setState(k, 'dd-nap')); re = { md: 'Night. Routines keep running while you sleep, and that part is real. Type anything to wake us.' }; }
    else if (/what time|time is it|what day/.test(text)) { const h = new Date().getHours(); re = { md: `It's ${clock()}. ${h < 5 ? "Go to bed. I'll keep an eye on things." : h < 12 ? 'A fine morning to hand me something.' : h < 18 ? 'Plenty of day left to hand me something.' : 'Late enough to let a bot do it.'}` }; }
    else if (/i love you|marry me|❤|<3|crush on/u.test(text)) re = { md: "I'm flattered. I'm also a recording. Let's keep it professional." };
    else if (said.length > 5 && said === said.toUpperCase() && /[A-Z]{4}/.test(said)) { poke(id === 'room' ? 'nova' : id, 'dd-nod'); re = { md: "No need to shout, I'm about 300 pixels away." }; }
    else if (other && !bot.on.test(text)) { poke(other); re = { md: `That's ${BOTS[other].n}'s corner. In the app I'd hand it over. Here you can click ${BOTS[other].n} in the sidebar and ask.` }; }
    else if (bot.on.test(text) && !PRICE.test(text)) re = bot.re;
    else {
      const fact = FACTS.find(([on]) => on.test(text));
      re = { md: fact ? (typeof fact[1] === 'function' ? fact[1](bot) : fact[1]) : SHRUGS[(bot.shrugs = (bot.shrugs ?? Math.floor(Math.random() * 4)) + 1) % 4](bot) };
    }
    if (re.code) ASKS.sudo.code = re.code;
    if (id !== 'room') return re;
    const second = pick(['quill', 'rivet', 'echo']);
    return [{ ...re, ask: null, from: 'nova' }, { from: second, md: { quill: 'I can put that in a sentence people will actually read.', rivet: "If it turns into code, it's mine.", echo: "And I'll tell the customers, kindly." }[second] }];
  }
  function wake() {
    if (!asleep) return;
    asleep = false;
    Object.keys(BOTS).forEach((k) => k !== 'room' && BOTS[k].state === 'dd-nap' && setState(k, ''));
  }
  function send() {
    const said = input.value.trim();
    if (!said) return;
    input.value = ''; fit(); wake();
    const open = pending(cur);
    if (open) open.classList.add('dd-done');
    add(cur, item.u(said), true);
    preview(cur, said);
    poke(cur === 'room' ? 'nova' : cur);
    touched = true;
    say(cur, answer(cur, said));
  }
  function choose(card, button) {
    const ask = card.ask, i = $$('.dd-opt', card).indexOf(button);
    card.classList.add('dd-done'); button.classList.add('dd-pick');
    $$('.dd-opt', card).forEach((b) => { b.disabled = true; });
    preview(cur, ask.o[i]);
    touched = true;
    say(cur, ask.then(i, ask.o[i]));
    sync();
  }

  /* ---------- the window ---------- */
  function sync() {
    const bot = BOTS[cur], waiting = pending(cur);
    box.classList.toggle('dd-busy', !!bot.busy);
    box.classList.toggle('dd-typed', !!input.value.trim());
    const hint = waiting ? 'Type your answer, or talk about something else' : `Message ${bot.n}`;
    input.placeholder = hint; input.setAttribute('aria-label', hint);
    go.setAttribute('aria-label', bot.busy ? 'Stop this turn' : input.value.trim() ? 'Send' : `Live call with ${bot.n}`);
  }
  function fit() {
    input.style.height = '';
    if (input.scrollHeight > input.clientHeight + 2) input.style.height = `${input.scrollHeight}px`;
    sync();
  }
  function open(id, focus) {
    const bot = BOTS[id], row = rowOf(id);
    if (id !== cur) {
      $('.dd-new', logOf(cur))?.remove();
      rowOf(cur).removeAttribute('aria-current');
      app.classList.replace(`dd-c-${cur}`, `dd-c-${id}`);
      cur = id;
      row.setAttribute('aria-current', 'true');
      pill.replaceChildren(face(id), el('b', '', bot.n));
      pill.setAttribute('aria-label', id === 'room' ? bot.n : `Open ${bot.n}'s profile`);
      scroller.replaceChildren(logOf(id));
      if (id === 'room') { hadPanel = app.classList.contains('dd-open'); app.classList.remove('dd-open'); }
      else {
        if (hadPanel) { hadPanel = false; app.classList.add('dd-open'); }
        $('.dd-pav').replaceChildren(face(id));
        $('.dd-pav').setAttribute('aria-label', `Say hi to ${bot.n}`);
        $('.dd-pname').textContent = bot.n;
        $('.dd-cap').textContent = `${bot.n}'s screen`;
        $('.dd-mn').textContent = bot.model;
        $('.dd-ml').src = `/art/logos/${bot.model.toLowerCase()}.svg`;
        panel.setAttribute('aria-label', `${bot.n}'s profile`);
      }
    }
    if (row.classList.contains('dd-unread')) { row.classList.remove('dd-unread'); $('.dd-sr', row).textContent = ''; }
    app.classList.add('dd-chat');
    toEnd();
    // keep the chosen row clear of the fade at the foot of the list
    const under = row.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom + row.offsetHeight;
    if (under > 0) list.scrollTop += under;
    sync(); glance();
    if (focus) (phone() ? back : fine ? input : row).focus({ preventScroll: true });
  }
  function tab(name) {
    for (const t of $$('.dd-tabs button')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
    for (const p of $$('.dd-tp')) p.hidden = p.dataset.pane !== name;
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    wake();
    if (t.dataset.bot) return open(t.dataset.bot, true);
    if (t.classList.contains('dd-opt')) return choose(t.closest('.dd-ask'), t);
    if (t === go) return BOTS[cur].busy ? stop() : input.value.trim() ? send() : (touched = true, say(cur, { md: TAPS.call, from: cur === 'room' ? 'nova' : null }));
    if (t === back) { app.classList.remove('dd-chat'); return rowOf(cur).focus({ preventScroll: true }); }
    if (t === pill) return cur !== 'room' && app.classList.toggle('dd-open');
    if (t.classList.contains('dd-close')) { app.classList.remove('dd-open'); return pill.focus({ preventScroll: true }); }
    if (t.dataset.tab) return tab(t.dataset.tab);
    if (t.classList.contains('dd-pav')) return poke(cur, ['dd-spin', 'dd-hop', 'dd-nod'][(pokes = (pokes || 0) + 1) % 3]);
    const line = TAPS[t.dataset.do];
    if (!line) return;
    touched = true;
    const to = t.closest('.dd-side') ? 'dusk' : cur;
    if (to !== cur) open(to);
    say(to, { md: line, from: to === 'room' ? 'nova' : null });
  });
  let pokes = 0, touched = false, hadPanel = false;
  $('.dd-tabs').addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const tabs = $$('.dd-tabs button'), next = tabs[(tabs.indexOf(document.activeElement) + step + tabs.length) % tabs.length];
    next.focus(); tab(next.dataset.tab);
  });
  input.addEventListener('input', () => {
    wake(); fit();
    const r = input.getBoundingClientRect();
    caret = { x: r.left + Math.min(r.width, input.value.length * r.height * 0.42), y: r.top + r.height / 2, until: performance.now() + 1400 };
    glance();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  list.addEventListener('scroll', () => list.classList.toggle('dd-end', list.scrollHeight - list.clientHeight - list.scrollTop < 8), { passive: true });

  /* ---------- the team gets on with things while you look around ---------- */
  const PLOT = [
    [5200, () => setState('tally', 'dd-work')],
    [6500, () => { setState('tally', ''); deliver('tally', { note: ['Routine ran: every Friday at 9:00'], md: 'Weekly numbers: **1,120 in sales** across 31 orders, up 8% on last week. Shipping labels were 228.' }); }],
    [7000, () => setState('rivet', 'dd-work')],
    [6000, () => { setState('rivet', ''); deliver('rivet', { md: 'The phone test passed on the preview link. Ready to go live when you are.', ask: 'ship' }); }],
    [11000, () => { if (!touched && cur !== 'room' && !BOTS[cur].busy) say(cur, { md: 'Still here. Ask me what I do, what it costs or where I run. Or type `help`.' }); }],
    [15000, () => deliver('echo', { md: 'One more came in: the café on Elm St confirmed 40 mugs. I drafted a thank-you with the delivery date.' })],
  ];
  // open threads get the full turn; closed ones just land, with a dot in the sidebar
  function deliver(id, part) {
    if (BOTS[id].busy) return;
    if (id === cur) return say(id, part);
    land(id, part);
  }
  let scene = 0;
  function next() {
    if (scene >= PLOT.length) return;
    const [after, act] = PLOT[scene];
    setTimeout(() => {
      if (!seen || document.hidden) return setTimeout(next, 1500);
      scene++; act(); next();
    }, after);
  }

  // take over from the still: the thread becomes a real scroller, resting at its end, with nothing moving on screen
  app.classList.add('dd-live');
  toEnd();
  sized?.observe(BOTS.nova.el);
  if (/Mac|iP(hone|ad)/.test(navigator.platform || '')) $('.dd-pc').textContent = 'This Mac';
  $('.dd-tm', rowOf('dusk')).textContent = clock(new Date(Date.now() - 24e4));
  sync();
  let started = false;
  const watch = (entries) => {
    seen = entries.some((en) => en.isIntersecting);
    if (seen && !started) { started = true; next(); }
  };
  if ('IntersectionObserver' in window) new IntersectionObserver(watch, { threshold: 0.35 }).observe(root);
  else watch([{ isIntersecting: true }]);
})();
