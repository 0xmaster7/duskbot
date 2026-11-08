// Slack files to and from the app's attachment store. Security: a file out is read only from directly inside the
// attachment store (a bot message's own attachment), never by a path that could reach the data folder or a workspace.
import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { ATTACHMENTS_DIR, extensionForFileMime, extensionForMime, IMAGE_MAX_BYTES, readAttachment, saveFile, saveImage } from "../attachments.ts";

const MAX_OUT_BYTES = 1024 * 1024 * 1024;

async function* once(bytes: Buffer): AsyncIterable<Uint8Array> {
  yield bytes;
}

/** A downloaded Slack file as a chat attachment: a picture the bot can see, a document it can open, or null. */
export async function saveSlackAttachment(bytes: Buffer, name: string, mime: string): Promise<{ path: string; kind: "image" | "file"; name: string } | null> {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  try {
    if (extensionForMime(type) && bytes.byteLength <= IMAGE_MAX_BYTES) return { path: saveImage(bytes, type).path, kind: "image", name };
    if (!extensionForFileMime(type)) return null;
    const saved = await saveFile(once(bytes), name, type, { expectedBytes: bytes.byteLength });
    return { path: saved.path, kind: "file", name: saved.name };
  } catch {
    return null;
  }
}

export function readSlackAttachment(path: string): { bytes: Buffer; mime: string; name: string } | null {
  const full = resolve(path);
  if (dirname(full) !== resolve(ATTACHMENTS_DIR)) return null;
  try {
    const info = lstatSync(full);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_OUT_BYTES) return null;
    return { bytes: readFileSync(full), mime: "application/octet-stream", name: basename(full) };
  } catch {
    return null;
  }
}

/** The bot's own picture for its Slack app icon; a drawn mascot has no picture file, so it has none. */
export function slackBotIcon(avatarUrl: string | undefined): { bytes: Uint8Array; mime: "image/png" | "image/jpeg"; name: string } | null {
  const name = avatarUrl?.startsWith("/api/attachments/") ? avatarUrl.slice("/api/attachments/".length) : "";
  const file = name ? readAttachment(name) : null;
  if (!file || (file.mime !== "image/png" && file.mime !== "image/jpeg")) return null;
  return { bytes: file.bytes, mime: file.mime, name };
}
