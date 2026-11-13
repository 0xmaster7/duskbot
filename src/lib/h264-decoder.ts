// The bot browser's H.264 (server/browser/viewers/h264-encoder.ts): Annex B access units decoded with WebCodecs into
// frames the panel draws as it draws a JPEG. A decoder that loses its place skips to the next keyframe and asks for one.

/** The codec the client asks support for before it asks the server for video: constrained baseline, level 4. */
export const H264_PROBE_CODEC = "avc1.42E028";

let support: boolean | Promise<boolean> | null = null;

/** Whether this app decodes the server's H.264: a boolean once known, a promise the first time it is asked. */
export function h264Support(): boolean | Promise<boolean> {
  if (support !== null) return support;
  if (typeof VideoDecoder === "undefined" || typeof VideoDecoder.isConfigSupported !== "function") return (support = false);
  support = VideoDecoder.isConfigSupported({ codec: H264_PROBE_CODEC, optimizeForLatency: true })
    .then((result) => (support = result.supported === true), () => (support = false));
  return support;
}

/** Test seam: forget the answer. */
export function resetH264Support(value: boolean | null = null): void {
  support = value;
}

/** Whether an access unit holds an IDR picture: its NAL types are read up to the first slice. */
export function isKeyUnit(data: Uint8Array): boolean {
  for (let at = 0; at + 3 < data.length; at++) {
    if (data[at] !== 0 || data[at + 1] !== 0 || data[at + 2] !== 1) continue;
    const type = data[at + 3]! & 0x1f;
    if (type === 5) return true;
    if (type === 1) return false;
    at += 3;
  }
  return false;
}

export interface H264Config {
  readonly codec: string;
  readonly width: number;
  readonly height: number;
}

export interface H264Decoder {
  /** A new stream from the server: a keyframe comes next. */
  readonly configure: (config: H264Config) => void;
  readonly decode: (unit: ArrayBuffer) => void;
  readonly close: () => void;
}

/** Units a decoder may hold undecoded before it is reset rather than fall further behind. */
const QUEUE_LIMIT = 30;

/** `onFrame` owns each frame and must close it; `onLost` asks the server for a keyframe. */
export function createH264Decoder({ onFrame, onLost }: { onFrame: (frame: VideoFrame) => void; onLost: () => void }): H264Decoder {
  let decoder: VideoDecoder | null = null;
  let config: H264Config | null = null;
  let waitKey = true;
  let closed = false;
  let timestamp = 0;

  const open = () => {
    const created = new VideoDecoder({
      output: (frame) => {
        if (closed || decoder !== created) frame.close();
        else onFrame(frame);
      },
      error: () => {
        if (decoder !== created) return;
        decoder = null;
        lost();
      },
    });
    created.configure({ codec: config!.codec, codedWidth: config!.width, codedHeight: config!.height, optimizeForLatency: true });
    decoder = created;
  };
  const drop = () => {
    const old = decoder;
    decoder = null;
    if (old && old.state !== "closed") try { old.close(); } catch {}
  };
  const lost = () => {
    drop();
    if (closed) return;
    waitKey = true;
    onLost();
  };

  return {
    configure: (next) => {
      if (closed) return;
      drop();
      config = next;
      waitKey = true;
    },
    decode: (unit) => {
      if (closed || !config) return;
      const key = isKeyUnit(new Uint8Array(unit));
      if (waitKey && !key) return;
      try {
        if (!decoder) open();
        if (decoder!.decodeQueueSize > QUEUE_LIMIT) {
          lost();
          return;
        }
        decoder!.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: (timestamp += 1000), data: unit }));
        waitKey = false;
      } catch {
        lost();
      }
    },
    close: () => {
      closed = true;
      drop();
    },
  };
}
