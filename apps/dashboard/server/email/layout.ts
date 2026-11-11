// every value from data is escaped in this file; templates pass raw strings

export interface EmailConfig {
  /** where the email art lives, no trailing slash (DUSK_EMAIL_ASSET_BASE) */
  assets: string;
  /** the marketing site: download, docs, privacy */
  site: string;
  /** the account page (publicUrl plus page base): billing, cloud, devices */
  app: string;
  x: string;
  /** the postal address legal wants in marketing mail; null leaves the line out */
  address: string | null;
}

export type Tone = "info" | "warn" | "alert";
export type Block =
  | { t: "h1"; text: string }
  | { t: "h2"; text: string }
  | { t: "p"; text: string; small?: boolean }
  | { t: "button"; label: string; href: string }
  | { t: "link"; label: string; href: string; before?: string }
  | { t: "code"; code: string }
  | { t: "facts"; rows: Array<[label: string, value: string, mark?: "ok" | "warn" | "off"]> }
  | { t: "steps"; items: Array<{ title: string; text: string }> }
  | { t: "list"; items: string[] }
  | { t: "tips"; items: Array<{ image: string; alt: string; title: string; text: string }> }
  | { t: "note"; text: string; tone?: Tone }
  | { t: "cloud"; eyebrow: string; title: string; text: string; points: string[]; price: string; fine: string; cta: { label: string; href: string }; image: string; alt: string }
  | { t: "feature"; image: string | null; alt: string; title: string; text: string };

export interface Email {
  subject: string;
  /** the line inbox lists show after the subject */
  preheader: string;
  /** the small mono label beside the logo: what kind of email this is */
  tag: string;
  hero: { image: string; alt: string; height: number } | null;
  blocks: Block[];
  /** why this arrived; promo mail also carries an unsubscribe link */
  reason: string;
  unsubscribe?: string;
  /** billing mail: one plain "your plan" link in the footer, never a button */
  plan?: string;
}
export interface Rendered { subject: string; html: string; text: string }

const C = {
  canvas: "#eaf6fd", card: "#fdfdfd", edge: "#d6eaf6", under: "#d0cefb", ink: "#1b1b1f", body: "#4a4a54", muted: "#83838e", line: "#ebebef",
  box: "#f2f8fc", lemon: "#fff3a0", pink: "#ffc4dd", sky: "#c2ecfc", lime: "#c9f63f", green: "#10a760", amber: "#c27c00", red: "#d6336c",
};
const SANS = "'General Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'Geist Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace";

export const esc = (value: string) => value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]!);
/** **bold** is the only markup prose may carry */
const prose = (value: string) => esc(value).replace(/\*\*(.+?)\*\*/g, "<b style=\"font-weight:600;color:" + C.ink + "\" class=\"ink\">$1</b>");
const plain = (value: string) => value.replace(/\*\*(.+?)\*\*/g, "$1");
const img = (cfg: EmailConfig, name: string) => /^https?:\/\//.test(name) ? name : `${cfg.assets}/${name}`;

const cut = (cls: string, colour: string, width?: number) =>
  `<td${width ? ` width="${width}"` : ""} class="${cls}" bgcolor="${colour}" height="5" style="height:5px;${width ? `width:${width}px;` : ""}background:${colour};font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td>`;
/** the waitlist's pixel corner: a 5px block cut from each corner, with a tinted underside along the bottom */
function stepped(inner: string, o: { fill: string; fillCls: string; under: string; underCls?: string; pad: string; align?: "center" | "left"; margin?: string; width?: "100%" | "auto" }) {
  return `<table role="presentation" ${o.width === "auto" ? "" : 'width="100%" '}cellpadding="0" cellspacing="0" border="0" style="margin:${o.margin ?? "0"}">
<tr>${cut("card", C.card, 5)}${cut(o.fillCls, o.fill)}${cut("card", C.card, 5)}</tr>
<tr><td colspan="3" class="${o.fillCls}" bgcolor="${o.fill}" align="${o.align ?? "left"}" style="background:${o.fill};padding:${o.pad}">${inner}</td></tr>
<tr>${cut("card", C.card, 5)}${cut(o.underCls ?? o.fillCls, o.under)}${cut("card", C.card, 5)}</tr>
</table>`;
}
function button(label: string, href: string) {
  return stepped(`<a class="btn-a" href="${esc(href)}" target="_blank" style="display:block;padding:9px 26px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;letter-spacing:-0.01em;color:#fdfdfd;text-decoration:none;text-align:center">${esc(label)}</a>`,
    { fill: C.ink, fillCls: "btn", under: C.ink, underCls: "btn", pad: "0", width: "auto" });
}

const tones: Record<Tone, { bg: string; edge: string; cls: string }> = {
  info: { bg: C.box, edge: C.sky, cls: "note-info" }, warn: { bg: "#fffbe2", edge: C.lemon, cls: "note-warn" }, alert: { bg: "#fff3f8", edge: C.pink, cls: "note-alert" },
};
const markColor = { ok: C.green, warn: C.amber, off: C.muted };

function blockHtml(cfg: EmailConfig, block: Block): string {
  const p = (inner: string, style = "") => `<p class="soft" style="margin:0 0 18px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.body};${style}">${inner}</p>`;
  switch (block.t) {
    case "h1": return `<h1 class="ink" style="margin:0 0 12px;font-family:${SANS};font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.025em;color:${C.ink}">${esc(block.text)}</h1>`;
    case "h2": return `<h2 class="ink" style="margin:14px 0 14px;font-family:${SANS};font-size:19px;line-height:26px;font-weight:600;letter-spacing:-0.015em;color:${C.ink}">${esc(block.text)}</h2>`;
    case "p": return block.small ? p(prose(block.text), `font-size:14px;line-height:22px;color:${C.muted}`) : p(prose(block.text));
    case "button": return `<div style="margin:6px 0 26px">${button(block.label, block.href)}</div>`;
    case "link": return p(`${block.before ? `${esc(block.before)} ` : ""}<a class="ink" href="${esc(block.href)}" target="_blank" style="color:${C.ink};font-weight:600;text-decoration:underline;text-underline-offset:3px">${esc(block.label)}</a>`, "font-size:15px;line-height:24px");
    // one string, so copy, paste and one-tap code fill see the whole code; the gap after the fourth digit is padding, not a character
    case "code": return stepped(`<div class="ink" style="font-family:${MONO};font-size:40px;line-height:48px;font-weight:600;letter-spacing:0.14em;color:${C.ink};-webkit-user-select:all;user-select:all">${
      block.code.length === 8 ? `<span style="padding-right:12px">${esc(block.code.slice(0, 4))}</span>${esc(block.code.slice(4))}` : esc(block.code)}</div>`,
      { fill: C.box, fillCls: "box", under: C.lemon, underCls: "", pad: "18px 12px 18px", align: "center", margin: "4px 0 22px" });
    case "facts": return stepped(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${block.rows.map(([label, value, mark], i) => `<tr><td class="line" style="padding:11px 0;${i ? `border-top:1px dashed ${C.line};` : ""}font-family:${MONO};font-size:12.5px;line-height:18px;color:${C.muted};white-space:nowrap">${esc(label)}</td>
<td align="right" class="ink line" style="padding:11px 0 11px 12px;${i ? `border-top:1px dashed ${C.line};` : ""}font-family:${SANS};font-size:15px;line-height:21px;font-weight:500;color:${C.ink}">${mark ? `<span style="color:${markColor[mark]};font-size:13px">&#9679;</span>&nbsp;` : ""}${esc(value)}</td></tr>`).join("\n")}
</table>`, { fill: C.box, fillCls: "box", under: C.sky, underCls: "", pad: "6px 18px", margin: "4px 0 24px" });
    case "steps": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px">
${block.items.map((item, i) => `<tr><td valign="top" width="40" style="padding:0 0 16px"><div class="step" style="width:28px;height:28px;line-height:28px;text-align:center;background:${C.lime};font-family:${MONO};font-size:13px;font-weight:600;color:${C.ink}">${i + 1}</div></td>
<td valign="top" style="padding:3px 0 16px"><div class="ink" style="font-family:${SANS};font-size:16px;line-height:22px;font-weight:600;color:${C.ink}">${esc(item.title)}</div>
<div class="soft" style="font-family:${SANS};font-size:15px;line-height:23px;color:${C.body};padding-top:3px">${prose(item.text)}</div></td></tr>`).join("\n")}
</table>`;
    case "list": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px">
${block.items.map(item => `<tr><td valign="top" width="22" style="padding:8px 0 0"><div style="width:7px;height:7px;background:${C.ink}" class="dot"></div></td><td class="soft" style="font-family:${SANS};font-size:15.5px;line-height:24px;color:${C.body};padding:0 0 6px">${prose(item)}</td></tr>`).join("\n")}
</table>`;
    case "tips": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px">
${block.items.map(item => `<tr><td valign="top" width="88" style="padding:0 0 20px"><img src="${esc(img(cfg, item.image))}" width="72" height="72" alt="${esc(item.alt)}" style="display:block;width:72px;height:72px;border:0"></td>
<td valign="top" style="padding:4px 0 20px"><div class="ink" style="font-family:${SANS};font-size:16.5px;line-height:23px;font-weight:600;letter-spacing:-0.01em;color:${C.ink}">${esc(item.title)}</div>
<div class="soft" style="font-family:${SANS};font-size:15px;line-height:23px;color:${C.body};padding-top:4px">${prose(item.text)}</div></td></tr>`).join("\n")}
</table>`;
    case "note": {
      const tone = tones[block.tone ?? "info"];
      return stepped(`<span class="ink" style="font-family:${SANS};font-size:14.5px;line-height:22px;color:${C.ink}">${prose(block.text)}</span>`,
        { fill: tone.bg, fillCls: tone.cls, under: tone.edge, underCls: "", pad: "13px 18px", margin: "0 0 22px" });
    }
    case "cloud": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 30px">
<tr><td class="line" style="padding:30px 0 0;border-top:2px dashed ${C.edge}"><img src="${esc(img(cfg, block.image))}" width="520" alt="${esc(block.alt)}" style="display:block;width:100%;max-width:520px;height:auto;border:0"></td></tr>
<tr><td style="padding:20px 0 0">
<div style="font-family:${MONO};font-size:12.5px;line-height:18px;letter-spacing:0.04em;color:${C.muted}" class="muted">${esc(block.eyebrow)}</div>
<div style="padding-top:8px;font-family:${SANS};font-size:24px;line-height:30px;font-weight:600;letter-spacing:-0.02em;color:${C.ink}" class="ink">${esc(block.title)}</div>
<div style="padding-top:10px;font-family:${SANS};font-size:15.5px;line-height:24px;color:${C.body}" class="soft">${prose(block.text)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0">
${block.points.map(point => `<tr><td valign="top" width="20" style="padding:8px 0 0"><div class="dot" style="width:7px;height:7px;background:${C.ink}"></div></td><td class="ink" style="font-family:${SANS};font-size:15px;line-height:24px;color:${C.ink};padding:0 0 4px">${esc(point)}</td></tr>`).join("\n")}
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0"><tr>
<td bgcolor="${C.lime}" style="background:${C.lime}"><a href="${esc(block.cta.href)}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;letter-spacing:-0.01em;color:${C.ink};text-decoration:none">${esc(block.cta.label)}</a></td>
<td class="ink" style="padding-left:16px;font-family:${SANS};font-size:15px;line-height:20px;color:${C.ink}"><b style="font-weight:600">${esc(block.price)}</b><br><span class="muted" style="font-size:13px;color:${C.muted}">${esc(block.fine)}</span></td>
</tr></table>
</td></tr>
<tr><td class="line" style="padding:30px 0 0;border-bottom:2px dashed ${C.edge}"></td></tr></table>`;
    case "feature": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">
${block.image ? `<tr><td style="padding:0 0 14px"><img src="${esc(img(cfg, block.image))}" width="520" alt="${esc(block.alt)}" style="display:block;width:100%;max-width:520px;height:auto;border:0"></td></tr>` : ""}
<tr><td><div class="ink" style="font-family:${SANS};font-size:18px;line-height:25px;font-weight:600;letter-spacing:-0.015em;color:${C.ink}">${esc(block.title)}</div>
<div class="soft" style="font-family:${SANS};font-size:15.5px;line-height:24px;color:${C.body};padding-top:5px">${prose(block.text)}</div></td></tr></table>`;
  }
}

function blockText(block: Block): string {
  switch (block.t) {
    case "h1": return block.text;
    case "h2": return block.text;
    case "p": return plain(block.text);
    case "button": return `${block.label}: ${block.href}`;
    case "link": return `${block.before ? `${block.before} ` : ""}${block.label}: ${block.href}`;
    case "code": return `    ${block.code}`;
    case "facts": return block.rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    case "steps": return block.items.map((item, i) => `${i + 1}. ${item.title}\n   ${plain(item.text)}`).join("\n\n");
    case "list": return block.items.map(item => `- ${plain(item)}`).join("\n");
    case "tips": return block.items.map(item => `* ${item.title}\n  ${plain(item.text)}`).join("\n\n");
    case "note": return plain(block.text);
    case "cloud": return [`[ ${block.eyebrow} ]`, block.title, plain(block.text), block.points.map(point => `- ${point}`).join("\n"), `${block.price}, ${block.fine}`, `${block.cta.label}: ${block.cta.href}`].join("\n\n");
    case "feature": return `${block.title}\n${plain(block.text)}`;
  }
}

const darkCss = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .bg { background: #0d1015 !important; }
  .card { background: #15171d !important; border-color: #252833 !important; }
  .ink, .ink a, a.ink { color: #f2f3f6 !important; }
  .soft { color: #c3c5cf !important; }
  .muted, .muted a { color: #8d909c !important; }
  .box { background: #1c1f27 !important; }
  .line { border-color: #2a2d38 !important; }
  .btn { background: #f2f3f6 !important; }
  td.card { background: #15171d !important; }
  .btn-a { color: #15171d !important; }
  .dot { background: #f2f3f6 !important; }
  .note-info { background: #1a2430 !important; }
  .note-warn { background: #2a2615 !important; }
  .note-alert { background: #2c1823 !important; }
}
[data-ogsc] .bg { background: #0d1015 !important; }
[data-ogsc] .card { background: #15171d !important; }
[data-ogsc] .ink { color: #f2f3f6 !important; }
[data-ogsc] .soft { color: #c3c5cf !important; }
[data-ogsc] .box { background: #1c1f27 !important; }
[data-ogsc] .btn { background: #f2f3f6 !important; }
[data-ogsc] .btn-a { color: #15171d !important; }
@media (max-width: 620px) {
  .px { padding-left: 22px !important; padding-right: 22px !important; }
  h1 { font-size: 25px !important; line-height: 31px !important; }
}`;

export function render(cfg: EmailConfig, email: Email): Rendered {
  const fonts = `@font-face { font-family: 'General Sans'; src: url(${cfg.assets}/fonts/general-sans.woff2) format('woff2'); font-weight: 200 700; }
@font-face { font-family: 'Geist Mono'; src: url(${cfg.assets}/fonts/geist-mono.woff2) format('woff2'); font-weight: 100 900; }`;
  const links: Array<[string, string]> = [...(email.plan ? [["your plan", email.plan] as [string, string]] : []), ["help", `${cfg.site}/docs`], ["x", cfg.x], ["privacy", `${cfg.site}/privacy`]];
  if (email.unsubscribe) links.push(["unsubscribe", email.unsubscribe]);
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(email.subject)}</title>
<style>${fonts}
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
table { border-collapse: collapse; }
img { -ms-interpolation-mode: nearest-neighbor; image-rendering: pixelated; }
a { text-decoration-skip-ink: auto; }
${darkCss}</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.canvas}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(email.preheader)}${"&#8199;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${C.canvas}" style="background:${C.canvas}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="padding:0 4px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" width="40"><img src="${esc(img(cfg, "kit-64.png"))}" width="30" height="30" alt="" style="display:block;width:30px;height:30px;border:0"></td>
<td valign="middle" class="ink" style="font-family:${SANS};font-size:18px;line-height:24px;font-weight:600;letter-spacing:-0.02em;color:${C.ink}">dusk bot</td>
<td valign="middle" align="right" class="muted" style="font-family:${MONO};font-size:12px;line-height:18px;letter-spacing:0.02em;color:${C.muted}">${esc(email.tag)}</td>
</tr></table></td></tr>
<tr><td class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.edge};border-bottom:5px solid ${C.under}">
${email.hero ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3cd0fd" style="background:#3cd0fd;font-family:${SANS};font-size:15px;color:#fdfdfd"><img src="${esc(img(cfg, email.hero.image))}" width="598" height="${Math.round(email.hero.height * 598 / 600)}" alt="${esc(email.hero.alt)}" style="display:block;width:100%;max-width:598px;height:auto;border:0;color:#fdfdfd"></td></tr></table>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" style="padding:34px 40px 18px">
${email.blocks.map(block => blockHtml(cfg, block)).join("\n")}
</td></tr></table>
</td></tr>
<tr><td class="muted" style="padding:22px 4px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted}">
<p style="margin:0 0 8px">${links.map(([label, href]) => `<a class="muted" href="${esc(href)}" target="_blank" style="color:${C.muted};text-decoration:underline;text-underline-offset:2px">${esc(label)}</a>`).join("&nbsp;&nbsp;&middot;&nbsp;&nbsp;")}</p>
<p style="margin:0">${esc(email.reason)}</p>
${cfg.address ? `<p style="margin:8px 0 0">${esc(cfg.address)}</p>` : ""}
</td></tr>
</table></td></tr></table>
</body></html>`;
  const footer = [email.reason, ...links.map(([label, href]) => `${label}: ${href}`), ...(cfg.address ? [cfg.address] : [])].join("\n");
  const text = [...email.blocks.map(blockText), "--", `dusk bot\n${footer}`].join("\n\n");
  return { subject: email.subject, html, text };
}
