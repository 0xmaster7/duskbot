// The page's own microphone, for services the page streams to and for the waveform where the recognizer cannot say how
// loud the voice is. 16 kHz mono, small frames so the waveform keeps up with the voice.
export const MIC_SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 512;

export interface MicCapture {
  close(): void;
}

export class MicError extends Error {
  constructor(readonly reason: "microphone-blocked" | "microphone-missing" | "microphone-failed") {
    super(reason);
  }
}

export function micFailureReason(error: unknown): MicError["reason"] {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "microphone-blocked";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "microphone-missing";
  return "microphone-failed";
}

export async function openMic(onFrame: (frame: Float32Array) => void): Promise<MicCapture> {
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(FRAME_SAMPLES, 1, 1);
    let open = true;
    processor.onaudioprocess = (event) => {
      if (open) onFrame(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(context.destination);
    void context.resume().catch(() => {});
    const tracks = stream.getTracks();
    return {
      close() {
        if (!open) return;
        open = false;
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        for (const track of tracks) track.stop();
        void context.close().catch(() => {});
      },
    };
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    throw new MicError(micFailureReason(error));
  }
}

/** 16-bit little-endian PCM, what the services take. */
export function toPcm16(frame: Float32Array): Int16Array {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, frame[i]!));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}
