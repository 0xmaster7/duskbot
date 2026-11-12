// collects the crowd.js shapes without the animated engine, plus three shapes only the logo set used
(function () {
  const DEFS = (window.LOGO_DEFS = Object.create(null));
  window.DuskPixel = window.DuskPixel || { define: (name, d) => (DEFS[name] = d) };
  window.LOGO_EXTRA = [
    ['squircle', '#286ef9', { eyes: { w: 2, h: 4, gap: 5, y: 7.5 }, parts: [['s', 8, 10, 6.8, 6, 3.2]] }],
    ['bunny', '#04a2ed', { N: 20, eyes: { w: 2, h: 3, gap: 4, y: 13 }, parts: [['e', 10, 14.6, 7.6, 5.4], ['l', 7.3, 10, 6.4, 2.2, 2.7, { mir: 1 }]] }],
    ['loafcat', '#fb7c01', { eyes: { w: 2, h: 3, gap: 6, y: 9.8 }, parts: [['r', 1, 7, 15, 16, 3.4], ['p', 1.5, 7.6, 2.4, 3.4, 6, 7.6, { mir: 1 }]] }],
  ];
})();
