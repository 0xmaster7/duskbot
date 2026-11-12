// the always-on cost calculator (/tools/always-on-cost): what a month of keeping bots running costs in each place,
// from the numbers typed into the form. all in the page; nothing is sent anywhere
{
const form = document.querySelector('[data-calc="always-on"]');
if (form) {
  const num = (name) => { const v = Number(form.elements[name].value); return Number.isFinite(v) && v >= 0 ? v : 0; };
  const money = (v) => `$${v < 10 ? v.toFixed(2) : Math.round(v)}`;
  const set = (key, text) => { const el = form.querySelector(`[data-out="${key}"]`); if (el) el.textContent = text; };
  const why = (key, text) => { const el = form.querySelector(`[data-why="${key}"]`); if (el) el.textContent = text; };
  const run = () => {
    const hours = Math.min(24, Math.max(1, num('hours'))), care = num('care') * num('rate');
    const power = num('watts') / 1000 * hours * 30.4 * num('kwh');
    set('spare', money(power + care));
    why('spare', `${money(power)} of electricity${care ? ` and ${money(care)} of your time` : ''}`);
    set('server', money(num('server') + care));
    why('server', `${money(num('server'))} to the hosting company${care ? ` and ${money(care)} of your time` : ''}`);
  };
  form.addEventListener('input', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  run();
}
}
