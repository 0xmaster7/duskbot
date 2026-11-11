import { FILE_KIND_SVG, type FileKind } from "./file-kind-glyphs";

const EXTENSION_KIND: Record<string, FileKind> = {};
const kinds: Array<[FileKind, string]> = [
  ["media", "png jpg jpeg gif webp avif heic heif bmp tif tiff svg ico"],
  ["video", "mp4 mov m4v webm mkv avi"],
  ["audio", "mp3 wav m4a aac ogg oga flac opus"],
  ["pdf", "pdf"],
  ["spreadsheet", "csv tsv xls xlsx numbers ods"],
  ["docx", "doc docx odt pages rtf"],
  ["ppt", "ppt pptx odp"],
  ["keynote", "key"],
  ["json", "json jsonl ndjson geojson"],
  ["zip", "zip tar gz tgz bz2 xz zst 7z rar"],
  ["generic", "txt md markdown log html htm xml yml yaml toml ini css scss js jsx mjs cjs ts tsx py rb go rs java kt swift c h cc cpp hpp cs php sh zsh bash sql lua r"],
];
for (const [kind, list] of kinds) for (const extension of list.split(" ")) EXTENSION_KIND[extension] = kind;

/** The kind of page drawn for a file name: its extension, or "unknown" when it has none we know. */
export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  return (dot > 0 && EXTENSION_KIND[name.slice(dot + 1).toLowerCase()]) || "unknown";
}

/** The 24px file glyph: a folded page with the file's coloured tag (red PDF, green sheet, blue document...). */
export function FileKindIcon({ name }: { name: string }) {
  const kind = fileKind(name);
  const glyph = FILE_KIND_SVG[kind];
  return (
    <svg
      aria-hidden="true"
      data-file-kind-icon={kind}
      width="24"
      height="24"
      viewBox={glyph.viewBox}
      className="shrink-0"
      dangerouslySetInnerHTML={{ __html: glyph.body }}
    />
  );
}
