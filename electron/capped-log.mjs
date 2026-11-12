// An append-only log that never outgrows its cap: past `maxBytes` the file becomes `<file>.1` (replacing the last one)
// and a fresh file starts, so at most about twice the cap stays on disk however long the app runs.
import nodeFs from "node:fs";
import path from "node:path";

export const SERVER_LOG_MAX_BYTES = 10 * 1024 * 1024;

/** @param {{ file: string, maxBytes?: number, fs?: typeof nodeFs }} options */
export function createCappedLog({ file, maxBytes = SERVER_LOG_MAX_BYTES, fs = nodeFs }) {
  let stream = null;
  let size = 0;

  function rotate() {
    try { fs.renameSync(file, `${file}.1`); } catch {}
    size = 0;
  }

  function open() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { size = fs.statSync(file).size; } catch { size = 0; }
    if (size >= maxBytes) rotate();
    // opened now, not on the stream's next tick, so a rename that follows lands its pending writes in the old file
    stream = fs.createWriteStream(file, { fd: fs.openSync(file, "a") });
    stream.on("error", () => { stream = null; });
  }

  return {
    write(text) {
      const bytes = Buffer.byteLength(text);
      if (!stream) open();
      else if (size > 0 && size + bytes > maxBytes) {
        stream.end();
        rotate();
        open();
      }
      stream?.write(text);
      size += bytes;
    },
    close() {
      stream?.end();
      stream = null;
    },
  };
}
