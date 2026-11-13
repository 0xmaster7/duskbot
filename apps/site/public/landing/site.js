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
}
