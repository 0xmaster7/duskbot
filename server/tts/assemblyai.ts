// AssemblyAI only listens; the transcription itself goes through electron/voice-providers.mjs. DUSK_ASSEMBLYAI_API overrides the base URL in tests.
import { verifyWith, type VerifyResult } from "./http-audio.ts";

const api = () => (process.env.DUSK_ASSEMBLYAI_API || "https://api.assemblyai.com/v2").replace(/\/+$/, "");

export function verifyKey(key: string): Promise<VerifyResult> {
  return verifyWith("AssemblyAI", `${api()}/transcript?limit=1`, { authorization: key });
}
