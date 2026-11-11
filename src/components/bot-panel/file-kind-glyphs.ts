export type FileKind = "audio" | "docx" | "generic" | "json" | "keynote" | "media" | "pdf" | "ppt" | "spreadsheet" | "unknown" | "video" | "zip";

const PAGE =
  '<path d="M7.25 2.75h6.9l5.1 5.1V18.5a2.75 2.75 0 0 1-2.75 2.75h-9.25A2.75 2.75 0 0 1 4.5 18.5v-13A2.75 2.75 0 0 1 7.25 2.75Z" fill="var(--color-composer)" stroke="color-mix(in srgb, var(--color-ink) 18%, transparent)" stroke-width="0.75"/>' +
  '<path d="M14.15 2.75 19.25 7.85h-3.6a1.5 1.5 0 0 1-1.5-1.5Z" fill="color-mix(in srgb, var(--color-ink) 12%, transparent)"/>';

const LINES = '<path d="M7.5 10.5h9M7.5 13.25h9M7.5 16h6" stroke="color-mix(in srgb, var(--color-ink) 26%, transparent)" stroke-width="1.1" stroke-linecap="round"/>';

const tag = (color: string, width: number, inner: string) =>
  `${PAGE}<rect x="2.5" y="12.5" width="${width}" height="6.75" rx="1.75" fill="${color}"/>${inner}`;

const label = (color: string, text: string) => {
  const width = text.length > 3 ? 15 : 12.5;
  return tag(color, width, `<text x="${2.5 + width / 2}" y="16" fill="#fff" text-anchor="middle" dominant-baseline="central" style="font: 700 4.6px var(--font-sans, sans-serif); letter-spacing: 0.1px">${text}</text>`);
};

const VIEW = "0 0 24 24";

/** Our file glyphs: a folded page, and for the kinds people tell apart at a glance a coloured tag on its foot. */
export const FILE_KIND_SVG: Record<FileKind, { viewBox: string; body: string }> = {
  pdf: { viewBox: VIEW, body: label("#d23b45", "PDF") },
  docx: { viewBox: VIEW, body: label("#2c6fdb", "DOC") },
  spreadsheet: { viewBox: VIEW, body: label("#1a8a52", "XLS") },
  ppt: { viewBox: VIEW, body: label("#c9561a", "PPT") },
  keynote: { viewBox: VIEW, body: label("#0b78a6", "KEY") },
  json: { viewBox: VIEW, body: label("#9a6a00", "JSON") },
  zip: { viewBox: VIEW, body: label("#7f5c3a", "ZIP") },
  media: { viewBox: VIEW, body: tag("#0f7f74", 9, '<path d="m4.4 17.9 1.9-2.5 1.3 1.5.9-1 1.6 2Z" fill="#fff"/><circle cx="8.9" cy="14.5" r="0.8" fill="#fff"/>') },
  audio: { viewBox: VIEW, body: tag("#c23b78", 9, '<circle cx="6.2" cy="17.1" r="1.05" fill="#fff"/><path d="M7.2 17.1v-3.4l2.2-.6" stroke="#fff" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>') },
  video: { viewBox: VIEW, body: tag("#7a52c7", 9, '<path d="M5.8 13.8v4.15c0 .3.32.48.58.33l3.3-2.07a.38.38 0 0 0 0-.65l-3.3-2.08a.38.38 0 0 0-.58.32Z" fill="#fff"/>') },
  generic: { viewBox: VIEW, body: PAGE + LINES },
  unknown: { viewBox: VIEW, body: PAGE },
};
