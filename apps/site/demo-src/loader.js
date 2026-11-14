// the hero demo's first script, right after its markup: fits the 1180 by 680 window to the hero's width (phones get the
// app's phone layout at real size), and fetches the demo itself once the window is near the screen
(function start() {
  const win = document.querySelector('[data-ad]');
  const host = win && win.querySelector('[data-ad-host]');
  if (!host) return;
  // browsers without declarative shadow roots get the same first frame from the template
  if (!host.shadowRoot && host.attachShadow) {
    const t = host.querySelector('template[shadowrootmode]');
    if (t) { host.attachShadow({ mode: 'open' }).appendChild(t.content); t.remove(); }
  }
  const PHONE = 760;
  const fit = () => {
    const w = win.clientWidth;
    host.style.setProperty('--ad-scale', w >= PHONE ? String(w / 1180) : '1');
    win.toggleAttribute('data-ad-phone', w < PHONE);
  };
  fit();
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(win);
  let asked = false;
  const load = () => {
    if (asked) return;
    asked = true;
    const s = document.createElement('script');
    s.src = host.dataset.app;
    s.async = true;
    document.head.appendChild(s);
  };
  if (!('IntersectionObserver' in window)) return load();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '400px 0px' });
  io.observe(win);
})();
