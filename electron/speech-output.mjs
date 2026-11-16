// The speech helper's stdout, which `open -o` sends to a file: new text reaches `onText` as soon as it is written.
import { closeSync, openSync, readSync, unwatchFile, watch, watchFile } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const CHUNK = 64 * 1024;

/** Reads only what was appended since the last read; a character split across two writes is held until it is whole. */
export function tailFile(file, onText, { backstopMs = 50 } = {}) {
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.alloc(CHUNK);
  let offset = 0;
  let closed = false;

  const drain = () => {
    if (closed) return;
    let fd;
    try {
      fd = openSync(file, "r");
    } catch {
      return;
    }
    let text = "";
    try {
      for (;;) {
        const read = readSync(fd, buffer, 0, CHUNK, offset);
        if (read <= 0) break;
        offset += read;
        text += decoder.write(buffer.subarray(0, read));
      }
    } catch {
    } finally {
      closeSync(fd);
    }
    if (text) onText(text);
  };

  // kqueue on macOS reports each write at once; stat polling only catches what the watcher may miss
  let watcher = null;
  try {
    watcher = watch(file, { persistent: false }, drain);
    watcher.on("error", () => {});
  } catch {
  }
  watchFile(file, { interval: backstopMs, persistent: false }, drain);

  return {
    flush: drain,
    close() {
      if (closed) return;
      closed = true;
      watcher?.close();
      unwatchFile(file, drain);
    },
  };
}
