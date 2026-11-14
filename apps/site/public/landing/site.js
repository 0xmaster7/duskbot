// on every page: the phone menu shuts on escape, on a tap outside it, and when the window grows past phone size
{
document.documentElement.classList.add('js');
const menu = document.querySelector('.menu');
if (menu) {
  const shut = () => { menu.open = false; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { shut(); menu.querySelector('summary').focus(); } });
  // pointerdown, not click: touch browsers send no click for a tap on plain text or empty page
  document.addEventListener('pointerdown', (e) => { if (menu.open && !menu.contains(e.target)) shut(); });
  matchMedia('(min-width: 641px)').addEventListener('change', shut);
}
// a page you point at (or press on a phone) starts loading before the click lands, so the next page is already here
const fetched = new Set([location.pathname]);
const warm = (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a || a.origin !== location.origin || a.target || a.hasAttribute('download') || fetched.has(a.pathname) || /\.[a-z0-9]{1,5}$/i.test(a.pathname)) return;
  fetched.add(a.pathname);
  document.head.append(Object.assign(document.createElement('link'), { rel: 'prefetch', href: a.pathname + a.search }));
};
document.addEventListener('pointerover', warm, { passive: true });
document.addEventListener('touchstart', warm, { passive: true });
// a double or triple click on a bot would select the paragraph around it; a single press still starts a drag selection
document.addEventListener('mousedown', (e) => { if (e.detail > 1 && e.target.closest?.('svg.bot, .sb[data-px], .cat img')) e.preventDefault(); });
}
