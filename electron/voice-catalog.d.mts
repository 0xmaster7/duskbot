export type VoiceProvider = "elevenlabs" | "openai" | "groq" | "deepgram" | "assemblyai" | "whisper-cpp" | "openai-compatible";

export interface VoiceProviderInfo {
  name: string;
  /** The service's transcription models, the default first. Empty: the person points at a model file (whisper.cpp). */
  models: string[];
  /** Streams words while the person talks; the others hear each pause-separated piece once it ends. */
  realtime: boolean;
  realtimeModel?: string;
  key: "required" | "optional" | "none";
  keyUrl: string;
  placeholder: string;
  /** Runs a program on this computer, so never on a phone or in a browser. */
  desktopOnly?: boolean;
}

export declare const VOICE_PROVIDERS: readonly VoiceProvider[];
export declare const VOICE_PROVIDER_INFO: Readonly<Record<VoiceProvider, VoiceProviderInfo>>;
export declare function isVoiceProvider(value: unknown): value is VoiceProvider;
export declare function voiceProviderModel(provider: VoiceProvider, chosen?: string): string;
