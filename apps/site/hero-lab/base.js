// fills <span class="b" data-b="kit violet"> with a real pixel bot, and draws the shared bar
document.querySelectorAll('[data-b]').forEach((el) => { const [n, c] = el.dataset.b.split(' '); el.innerHTML = bot(n, c); });
const bar = document.querySelector('[data-bar]');
if (bar) bar.outerHTML = `<header class="bar"><a class="brand" href="#"><img src="/art/logo-96.webp" alt="" width="28" height="28">dusk bot</a><nav aria-label="main"><a href="#">download</a><a href="#">docs</a><a href="#">pricing</a><a class="cta" href="#">sign in</a></nav></header>`;
