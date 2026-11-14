// Speech-to-text requests to the services in voice-catalog.mjs. Pure (fetch, no Node builtins), so the desktop app's
// main process and the phone's web view share it.
import type { VoiceProvider } from "./voice-catalog.mjs";

export interface ClipRequest {
  provider: VoiceProvider;
  /** A 16 kHz mono 16-bit WAV file. */
  wav: Uint8Array;
  key?: string;
  model?: string;
  /** A BCP 47 tag; unset lets the service detect it. */
  language?: string;
  /** OpenAI-compatible only. */
  baseUrl?: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

export type VoiceProviderFailure = "bad-key" | "rate-limited" | "network" | "service" | "not-set-up";

export declare class VoiceProviderError extends Error {
  readonly reason: VoiceProviderFailure;
  readonly status?: number;
  constructor(reason: VoiceProviderFailure, message: string, status?: number);
}

/** One clip's words through one service's batch endpoint. Not whisper.cpp, which runs a program (voice-input-main.mjs). */
export declare function transcribeClip(request: ClipRequest): Promise<string>;

export interface PieceSession {
  /** 16 kHz mono 16-bit PCM as it arrives. */
  push(pcm: Int16Array): void;
  /** Hear the rest, then call onText(all, false) once and resolve. */
  finish(): Promise<void>;
  /** Drop everything, no more callbacks. */
  stop(): void;
}

/** Batch services heard while the person talks: each pause ends a piece that is sent at once, and the words so far are
 * reported in order as pieces come back, so the preview moves without waiting for the end. */
export declare function createPieceSession(options: {
  transcribe(wav: Uint8Array, signal: AbortSignal): Promise<string>;
  /** Everything heard so far, in order. */
  onText(text: string, partial: boolean): void;
  onError(error: unknown): void;
  sampleRate?: number;
  /** Quiet this long after speech ends a piece. */
  pauseMs?: number;
}): PieceSession;

export declare function encodeWav16(pcm: Int16Array, sampleRate?: number): Uint8Array;
