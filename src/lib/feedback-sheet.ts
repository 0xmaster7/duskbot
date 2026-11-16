import { useSyncExternalStore } from "react";

import { api } from "@/state/api";
import { prepareBanner, type BannerProblem } from "./place-banner";

/** POST /api/feedback (server/routes/feedback.ts) */
export const FEEDBACK_PATH = "/api/feedback";
export const FEEDBACK_MAX_IMAGES = 3;
export const FEEDBACK_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

let open = false;
const listeners = new Set<() => void>();
const tell = () => { for (const listener of listeners) listener(); };

export function openFeedback(): void { if (!open) { open = true; tell(); } }
export function closeFeedback(): void { if (open) { open = false; tell(); } }
export function useFeedbackOpen(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => open,
    () => false,
  );
}

export interface FeedbackImage { blob: Blob; url: string }

/** A chosen picture shrunk and drawn afresh as the banner is, so nothing but its pixels is sent. */
export async function feedbackImage(file: Blob): Promise<{ ok: true; image: FeedbackImage } | { ok: false; problem: BannerProblem }> {
  const prepared = await prepareBanner(file);
  return prepared.ok ? { ok: true, image: { blob: prepared.blob, url: URL.createObjectURL(prepared.blob) } } : prepared;
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** The desktop app's signed-in dusk account, sent along on this computer's own page; a session's server knows its own. */
async function signedInEmail(): Promise<string | undefined> {
  const bridge = window.duskDesktop?.remoteClient?.active === true ? undefined : window.duskDesktop?.cloudAccount;
  const state = await bridge?.state().catch(() => null);
  return state?.account?.email || undefined;
}

export async function sendFeedback(text: string, images: readonly FeedbackImage[]): Promise<{ id: string }> {
  const [email, data] = await Promise.all([signedInEmail(), Promise.all(images.map((image) => base64(image.blob)))]);
  return api<{ id: string }>(FEEDBACK_PATH, { method: "POST", timeoutMs: 30_000, body: JSON.stringify({ text, ...(data.length ? { images: data } : {}), ...(email ? { email } : {}) }) });
}
