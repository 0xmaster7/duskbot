// pulls sections straight out of the landing page (apps/site/public/landing/index.html), so the README shows the
// site's real markup with the site's real css. a page calls take(".many") and gets a fresh copy of that section.
const theme = new URLSearchParams(location.search).get("theme");
if (theme === "dark") document.documentElement.classList.add("dark");

let landing;
export async function take(selector) {
  landing ??= new DOMParser().parseFromString(await (await fetch("/index.html")).text(), "text/html");
  const found = landing.querySelector(selector);
  if (!found) throw new Error(`the landing has no ${selector}`);
  const copy = document.importNode(found, true);
  copy.querySelectorAll("[data-mk-reveal]").forEach((el) => el.removeAttribute("data-mk-reveal"));
  copy.querySelectorAll("img[loading]").forEach((img) => img.removeAttribute("loading"));
  return copy;
}

/** tells render.mjs the page is drawn: fonts loaded and every image decoded */
export async function done() {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  document.body.dataset.ready = "1";
}

/** one of the landing's pixel bots, by its shape (data-px) and colour class */
export async function bot(shape, color) {
  landing ??= new DOMParser().parseFromString(await (await fetch("/index.html")).text(), "text/html");
  const found = landing.querySelector(`svg.bot[data-px="${shape}"]`) ?? landing.querySelector("svg.bot");
  const copy = document.importNode(found, true);
  copy.setAttribute("class", `bot c-${color}`);
  return copy;
}
