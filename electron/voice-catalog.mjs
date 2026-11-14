// The speech-to-text services voice input can use besides the device's own recognizer. Pure data: read by the renderer
// (Settings > Voice, the engine choice), by electron/voice-providers.mjs (the requests) and by the phone.

/** Services in the order Settings lists them. */
export const VOICE_PROVIDERS = ["elevenlabs", "openai", "groq", "deepgram", "assemblyai", "whisper-cpp", "openai-compatible"];

export const VOICE_PROVIDER_INFO = {
  elevenlabs: {
    name: "ElevenLabs",
    models: ["scribe_v1"],
    realtimeModel: "scribe_v2_realtime",
    realtime: true,
    key: "required",
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
    placeholder: "sk_…",
  },
  openai: {
    name: "OpenAI",
    models: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
    realtime: false,
    key: "required",
    keyUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  groq: {
    name: "Groq",
    models: ["whisper-large-v3-turbo", "whisper-large-v3"],
    realtime: false,
    key: "required",
    keyUrl: "https://console.groq.com/keys",
    placeholder: "gsk_…",
  },
  deepgram: {
    name: "Deepgram",
    models: ["nova-3", "nova-2"],
    realtime: false,
    key: "required",
    keyUrl: "https://console.deepgram.com/",
    placeholder: "",
  },
  assemblyai: {
    name: "AssemblyAI",
    models: ["universal", "slam-1"],
    realtime: false,
    key: "required",
    keyUrl: "https://www.assemblyai.com/app/api-keys",
    placeholder: "",
  },
  "whisper-cpp": {
    name: "whisper.cpp",
    models: [],
    realtime: false,
    key: "none",
    keyUrl: "https://github.com/ggml-org/whisper.cpp",
    placeholder: "",
    desktopOnly: true,
  },
  "openai-compatible": {
    name: "OpenAI-compatible",
    models: ["whisper-1"],
    realtime: false,
    key: "optional",
    keyUrl: "",
    placeholder: "",
  },
};

export function isVoiceProvider(value) {
  return typeof value === "string" && Object.hasOwn(VOICE_PROVIDER_INFO, value);
}

/** The model a request uses: the chosen one when it is set, else the service's first. */
export function voiceProviderModel(provider, chosen) {
  const picked = typeof chosen === "string" ? chosen.trim() : "";
  return picked || VOICE_PROVIDER_INFO[provider]?.models[0] || "";
}
