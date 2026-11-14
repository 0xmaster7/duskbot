// Reads what a page says about itself (Open Graph, Twitter cards, oEmbed, plain <title>/<meta>) as plain text.
// Nothing here is ever rendered as markup: tags are stripped and entities decoded, then the client renders text.

export interface PageMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: { url: string; width: number | null; height: number | null } | null;
  video: boolean;
  /** A JSON oEmbed endpoint the page links to, absolute. */
  oembed: string | null;
}

export const EMPTY_META: PageMeta = { title: null, description: null, siteName: null, image: null, video: false, oembed: null };

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 500;
const SITE_MAX = 80;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", bull: "\u2022", trade: "\u2122", euro: "\u20ac",
  zwj: "\u200d", zwnj: "\u200c",
};
// the Latin-1 names, U+00A1 to U+00FF in order
"iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml"
  .split(" ").forEach((name, index) => { NAMED[name] = String.fromCharCode(0xa1 + index); });

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});?/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(NAMED, body) ? NAMED[body]! : whole;
  });
}

/** Plain text of a fragment of markup, one line, at most `max` characters; empty means nothing worth showing. */
export function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = decodeEntities(raw.replace(/<[^>]*>/g, " "))
    // control, bidi-override and zero-width characters can disguise a title as something else; ZWJ joins emoji
    .replace(/(?!\u200d)[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** An http(s) address resolved against the page, or null. */
export function absoluteUrl(raw: string | null | undefined, base: URL): string | null {
  const value = decodeEntities(String(raw ?? "").trim());
  if (!value || value.startsWith("data:")) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Markup that is never the page's own metadata: scripts, styles, comments, templates. */
function withoutInertBlocks(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " ");
}

export function tagAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const body = tag.replace(/^<[a-z]+/i, "").replace(/\/?>$/, "");
  for (const match of body.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function positiveInt(raw: string | undefined): number | null {
  const value = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(value) && value > 0 && value < 100_000 ? value : null;
}

/** The charset a page's own <meta> declares, read from its first bytes as latin1. */
export function declaredCharset(head: string): string | null {
  const direct = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head)?.[1];
  return direct ? direct.toLowerCase() : null;
}

export function parsePageMeta(html: string, page: URL): PageMeta {
  const doc = withoutInertBlocks(html);
  const meta = new Map<string, string>();
  const put = (key: string, value: string) => { if (!meta.has(key) && value.trim()) meta.set(key, value); };
  const images: Array<{ url: string; width: number | null; height: number | null }> = [];
  let oembed: string | null = null;
  let canonicalBase = page;

  for (const [tag] of doc.matchAll(/<(?:meta|link|base)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = tagAttributes(tag);
    const kind = tag.slice(1, 5).toLowerCase();
    if (kind === "base") {
      const href = absoluteUrl(attrs.get("href"), page);
      if (href) canonicalBase = new URL(href);
      continue;
    }
    if (kind === "link") {
      const rel = (attrs.get("rel") ?? "").toLowerCase();
      const type = (attrs.get("type") ?? "").toLowerCase();
      if (!oembed && /\balternate\b/.test(rel) && type === "application/json+oembed") oembed = absoluteUrl(attrs.get("href"), canonicalBase);
      continue;
    }
    const key = (attrs.get("property") ?? attrs.get("name") ?? attrs.get("itemprop") ?? "").trim().toLowerCase();
    const content = attrs.get("content");
    if (!key || content === undefined) continue;
    if (key === "og:image" || key === "og:image:url" || key === "og:image:secure_url" || key === "twitter:image" || key === "twitter:image:src" || key === "image") {
      const url = absoluteUrl(content, canonicalBase);
      if (url && !images.some((image) => image.url === url)) images.push({ url, width: null, height: null });
      continue;
    }
    if ((key === "og:image:width" || key === "og:image:height") && images.length) {
      const last = images[images.length - 1]!;
      const axis = key.endsWith("width") ? "width" : "height";
      if (last[axis] === null) last[axis] = positiveInt(content);
      continue;
    }
    put(key, content);
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(doc)?.[1];
  const title = cleanText(meta.get("og:title") ?? meta.get("twitter:title") ?? meta.get("title") ?? titleTag, TITLE_MAX);
  const description = cleanText(meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"), DESCRIPTION_MAX);
  const siteName = cleanText(meta.get("og:site_name") ?? meta.get("application-name") ?? meta.get("apple-mobile-web-app-title"), SITE_MAX);
  const type = (meta.get("og:type") ?? "").toLowerCase();
  const card = (meta.get("twitter:card") ?? "").toLowerCase();
  const video = type.startsWith("video") || card === "player"
    || ["og:video", "og:video:url", "og:video:secure_url", "twitter:player"].some((key) => meta.has(key));
  return { title, description, siteName, image: images[0] ?? null, video, oembed };
}

/** An oEmbed JSON answer; its `html` is never used. */
export function parseOembed(raw: unknown, base: URL): PageMeta {
  if (!raw || typeof raw !== "object") return EMPTY_META;
  const data = raw as Record<string, unknown>;
  const thumbnail = typeof data.thumbnail_url === "string" ? absoluteUrl(data.thumbnail_url, base) : null;
  const photo = data.type === "photo" && typeof data.url === "string" ? absoluteUrl(data.url, base) : null;
  const imageUrl = thumbnail ?? photo;
  const width = thumbnail ? positiveInt(String(data.thumbnail_width ?? "")) : positiveInt(String(data.width ?? ""));
  const height = thumbnail ? positiveInt(String(data.thumbnail_height ?? "")) : positiveInt(String(data.height ?? ""));
  return {
    title: cleanText(data.title, TITLE_MAX),
    description: null,
    siteName: cleanText(data.provider_name, SITE_MAX),
    image: imageUrl ? { url: imageUrl, width, height } : null,
    video: data.type === "video",
    oembed: null,
  };
}

/** Fields from `first` win; `second` fills what it lacks. */
export function mergeMeta(first: PageMeta, second: PageMeta): PageMeta {
  return {
    title: first.title ?? second.title,
    description: first.description ?? second.description,
    siteName: first.siteName ?? second.siteName,
    image: first.image ?? second.image,
    video: first.video || second.video,
    oembed: first.oembed ?? second.oembed,
  };
}

/** A page that says nothing a card could show beyond its address. */
export function isThin(meta: PageMeta): boolean {
  return !meta.title || (!meta.image && !meta.description);
}

const TITLE_SUFFIXES: ReadonlyArray<readonly [host: RegExp, suffix: RegExp]> = [
  [/(^|\.)github\.com$/, /\s+·\s+GitHub$/],
  [/(^|\.)youtube\.com$/, /\s+-\s+YouTube$/],
  [/(^|\.)reddit\.com$/, /\s+:\s+r\/\w+$/],
];

/** The site's name in its own title is already on the card's footer. */
export function tidyTitle(title: string | null, host: string): string | null {
  if (!title) return title;
  const rule = TITLE_SUFFIXES.find(([pattern]) => pattern.test(host));
  return rule ? title.replace(rule[1], "") || title : title;
}

export const LIMITS = { TITLE_MAX, DESCRIPTION_MAX, SITE_MAX } as const;
