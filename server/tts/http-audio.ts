// Shared by the OpenAI, Deepgram and Cartesia voices: a refusal never echoes the remote body, which can carry the key or the text.
import type { Audio } from "./elevenlabs.ts";

export type VerifyResult = { ok: true } | { ok: false; message: string };

export function voiceRefusal(service: string, status: number, keyHint: string): string {
  if (status === 401 || status === 403) return `${service} rejected the key. ${keyHint}`;
  if (status === 402) return `The ${service} account needs credit to generate speech.`;
  if (status === 429) return `${service} is rate-limiting speech. Wait a moment and try again.`;
  if (status === 400 || status === 404 || status === 422) return `${service} could not use that voice. Pick a voice from the list again.`;
  return `${service} voice failed (HTTP ${status}). Try again later.`;
}

export async function readAudio(response: Response, service: string): Promise<Audio> {
  const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mime && !mime.startsWith("audio/") && mime !== "application/octet-stream") {
    await response.body?.cancel();
    throw new Error(`${service} returned an unexpected audio format. Try again later.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new Error(`${service} audio download was interrupted. Try again.`);
  }
  if (!bytes.byteLength) throw new Error(`${service} returned empty audio. Try again.`);
  return { bytes, mime: "audio/mpeg" };
}

/** A cheap authenticated GET: `rejects` lists the statuses that mean the key itself is wrong, `accepts` the non-2xx ones that prove it genuine. */
export async function verifyWith(
  service: string,
  url: string,
  headers: Record<string, string>,
  rejects: readonly number[] = [401, 403],
  accepts: readonly number[] = [],
): Promise<VerifyResult> {
  let response: Response;
  try {
    response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch {
    return { ok: false, message: `Couldn't reach ${service} to check that key: check your connection.` };
  }
  await response.body?.cancel();
  if (response.ok || accepts.includes(response.status)) return { ok: true };
  if (rejects.includes(response.status)) return { ok: false, message: `${service} rejected that key.` };
  if (response.status === 429) return { ok: false, message: `${service} is rate-limiting this account: wait a moment and try again.` };
  return { ok: false, message: `checking that key failed (${response.status})` };
}
