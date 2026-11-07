// Where a mac_save_from_cloud file comes from: the bot's own folders and this conversation's attachments, read with the
// same confinement as a file link in the chat, or its cloud computer's home, read inside that container.
import { posix } from "node:path";
import { Readable } from "node:stream";

import { BOT_DESKTOP_HOME } from "../../shared/bot-desktop.ts";
import { openMessageFile } from "../message-file.ts";
import type { MacDownload } from "./jobs.ts";

/** base64 grows a file by a third and the docker runner keeps 16 M characters of output */
export const COMPUTER_FILE_MAX_BYTES = 11 * 1024 * 1024;

const buffered = (name: string, bytes: Buffer): MacDownload => ({ name, bytes: bytes.length, open: () => Readable.from([bytes]) });

export async function botFile(input: { roots: readonly string[]; attachmentsDir: string; attachmentInThread(path: string): boolean }, source: string): Promise<MacDownload> {
  const own = input.roots.filter((root) => root !== input.attachmentsDir);
  let opened;
  try { opened = await openMessageFile(source, own); }
  catch (error) {
    if (!input.attachmentInThread(source)) throw error;
    opened = await openMessageFile(source, [input.attachmentsDir]);
  }
  try {
    const bytes = Buffer.alloc(opened.bytes);
    await opened.handle.read(bytes, 0, opened.bytes, 0);
    return buffered(opened.name, bytes);
  } finally { await opened.handle.close(); }
}

/** Runs as the desktop user inside the bot's computer: the file's bytes as base64, or a one-line refusal. */
const READ_SCRIPT = [
  "import base64, os, sys",
  "path = os.path.join(sys.argv[1], os.path.expanduser(sys.argv[2]))",
  "if not os.path.isfile(path): sys.stderr.write('missing'); sys.exit(3)",
  "if os.path.getsize(path) > int(sys.argv[3]): sys.stderr.write('too-large'); sys.exit(4)",
  "with open(path, 'rb') as f: sys.stdout.write(base64.b64encode(f.read()).decode())",
].join("\n");

export function computerFileArgs(container: string, source: string): string[] {
  return ["exec", "-u", "1000:1000", container, "python3", "-c", READ_SCRIPT, BOT_DESKTOP_HOME, source, String(COMPUTER_FILE_MAX_BYTES)];
}

export async function computerFile(run: (args: string[]) => Promise<{ stdout: string }>, container: string, source: string): Promise<MacDownload> {
  let stdout: string;
  try { ({ stdout } = await run(computerFileArgs(container, source))); }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/\bmissing\b/.test(text)) throw new Error("there is no such file on your cloud computer");
    if (/too-large/.test(text)) throw new Error(`it is over ${COMPUTER_FILE_MAX_BYTES / 1024 / 1024} MB; save it to your own files and send it from there`);
    if (/no such container|is not running/i.test(text)) throw new Error("your cloud computer is not running; start it first");
    throw new Error("your cloud computer did not answer");
  }
  return buffered(posix.basename(source) || "file", Buffer.from(stdout.trim(), "base64"));
}
