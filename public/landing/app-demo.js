// the app window in the hero. it opens as a still of dusk bot's main window; the moment someone reaches for it (the
// pointer comes over it, a tap, or keyboard focus) the app itself loads in a frame over the still (/demo/: the app
// built with sample bots and canned replies, nothing leaves the page) and takes over once it has drawn. a click made
// while it loads is passed on to the same spot in the app. without script the still stays.
(() => {
  const box = document.querySelector('[data-ad]');
  const start = box && box.querySelector('[data-ad-start]');
  if (!box || !start || !('ResizeObserver' in window)) return;
  const phone = matchMedia('(max-width: 700px)');
  let frame = null, live = false, pending = null;

  // the real window is 1180 by 680; a phone gets the app's phone layout at the size it is shown
  const scale = () => (phone.matches ? 1 : box.clientWidth / 1180);
  const fit = () => {
    if (!frame || !box.clientWidth) return;
    if (phone.matches) {
      frame.style.width = `${box.clientWidth}px`;
      frame.style.height = `${box.clientHeight}px`;
      frame.style.transform = 'none';
    } else {
      frame.style.width = '1180px';
      frame.style.height = '680px';
      frame.style.transform = `scale(${scale()})`;
    }
  };

  // a press on the still, replayed on whatever the app draws at that point
  const replay = () => {
    if (!pending) return;
    const { x, y } = pending;
    pending = null;
    const doc = frame.contentDocument;
    const target = doc && doc.elementFromPoint(x / scale(), y / scale());
    if (!target) return;
    const at = { bubbles: true, cancelable: true, composed: true, clientX: x / scale(), clientY: y / scale(), button: 0, view: frame.contentWindow };
    const win = frame.contentWindow;
    target.dispatchEvent(new win.PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new win.MouseEvent('mousedown', at));
    target.dispatchEvent(new win.PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new win.MouseEvent('mouseup', at));
    if (target.matches('textarea, input')) target.focus();
    else target.dispatchEvent(new win.MouseEvent('click', at));
  };

  const load = () => {
    if (frame) return;
    box.classList.add('ad-busy');
    frame = document.createElement('iframe');
    frame.className = 'ad-frame';
    frame.title = 'Dusk Bot, a live demo with sample bots';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.src = '/demo/';
    fit();
    box.append(frame);
  };

  addEventListener('message', (event) => {
    if (!frame || live || event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.duskDemo !== 'ready') return;
    live = true;
    box.classList.remove('ad-busy');
    box.classList.add('ad-live');
    frame.removeAttribute('tabindex');
    frame.removeAttribute('aria-hidden');
    const keyboard = document.activeElement === start;
    start.hidden = true;
    if (keyboard) frame.focus();
    replay();
  });

  for (const type of ['pointerenter', 'focusin', 'touchstart']) start.addEventListener(type, load, { once: true, passive: true });
  start.addEventListener('click', (event) => {
    const rect = box.getBoundingClientRect();
    if (event.detail) pending = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    load();
  });
  new ResizeObserver(fit).observe(box);
  phone.addEventListener('change', () => { fit(); if (frame) frame.contentWindow?.location.reload(); });
})();
