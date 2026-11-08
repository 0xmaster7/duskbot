const frames = document.querySelectorAll<HTMLIFrameElement>("iframe");
const row = document.querySelector<HTMLDivElement>("#frames")!;
const stage = document.querySelector<HTMLDivElement>("#stage")!;
const preview = document.querySelector<HTMLElement>(".preview")!;
const dark = document.querySelector<HTMLButtonElement>("#dark")!;
const pair = document.querySelector<HTMLButtonElement>("#pair")!;

function reload() {
  for (const frame of frames) {
    const query = new URLSearchParams({ frame: "1", w: frame.dataset.width! });
    if (dark.getAttribute("aria-pressed") === "true") query.set("scheme", "dark");
    if (pair.getAttribute("aria-pressed") === "true") query.set("pair", "1");
    frame.src = `/?${query}`;
  }
}

document.querySelector<HTMLButtonElement>("#reload")!.addEventListener("click", reload);
for (const toggle of [dark, pair]) {
  toggle.addEventListener("click", () => {
    toggle.setAttribute("aria-pressed", String(toggle.getAttribute("aria-pressed") !== "true"));
    reload();
  });
}

/** Both phones always fit the window whole, by width and by height, so nothing on their screens is cut at the edge. */
function fit() {
  const room = window.innerHeight - preview.getBoundingClientRect().top - 24;
  const scale = Math.min(1, preview.clientWidth / row.offsetWidth, room > 200 ? room / row.offsetHeight : 1);
  row.style.transform = `scale(${scale})`;
  stage.style.width = `${row.offsetWidth * scale}px`;
  stage.style.height = `${row.offsetHeight * scale}px`;
}

new ResizeObserver(fit).observe(preview);
window.addEventListener("resize", fit);
fit();

export {};
