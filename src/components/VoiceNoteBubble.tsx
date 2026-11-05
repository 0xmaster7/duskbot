// No playback during a Live call: the call's microphone would pick the note up.
import { useEffect, useMemo, useRef, useState } from "react";

import { attachmentAudioUrl } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { isLiveCallRunning, useLiveMedia } from "@/lib/live-call-media";
import { speaker } from "@/lib/tts";
import { cn } from "@/lib/cn";
import { GrokIcon } from "./GrokIcon";

export interface VoiceNoteAttachment {
  kind: "audio";
  path: string;
  mime: string;
  durationMs?: number;
  /** The words the note speaks; shown behind a collapsed Transcript, never as message body. */
  text?: string;
}

const SPEEDS = [1, 1.5, 2] as const;
const BAR_COUNT = 56;

/** A steady pattern of bar heights for one note, the same each time it draws: decoration, not the audio's own levels. */
function waveform(seed: string): string[] {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    hash = Math.imul(hash ^ (index + 1), 16777619);
    const level = ((hash >>> 0) % 1000) / 1000;
    return `${Math.round(4 + level * level * 20)}px`;
  });
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function VoiceNoteBubble({
  attachment,
  className,
}: {
  attachment: VoiceNoteAttachment;
  className?: string;
}) {
  const url = attachmentAudioUrl(attachment.path);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(
    typeof attachment.durationMs === "number" && attachment.durationMs > 0
      ? attachment.durationMs / 1000
      : null,
  );
  const [time, setTime] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const bars = useMemo(() => waveform(attachment.path), [attachment.path]);
  const transcript = attachment.text?.trim() ?? "";
  const onLiveCall = isLiveCallRunning(useLiveMedia().phase);

  useEffect(() => () => releaseRef.current?.(), []);

  if (!url) return null;

  const giveBackVoice = (release?: () => void) => {
    if (release && releaseRef.current !== release) return;
    releaseRef.current?.();
    releaseRef.current = null;
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    // The element's paused state, not the flag: play events are queued, so a second click before onPlay must still
    // pause.
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (onLiveCall) return;
    // Claim before play: the Speaker's stop() silences call mode and any other note first.
    releaseRef.current?.();
    const release = speaker.claimExternalVoice(() => audio.pause());
    releaseRef.current = release;
    // A refused play() never fires pause, so the claim comes back here, if this attempt's claim is still the active
    // one.
    void audio.play().catch(() => giveBackVoice(release));
  };

  const seek = (next: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(next)) audio.currentTime = next;
    setTime(next);
  };

  const progress = duration ? Math.min(1, time / duration) : 0;
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };
  const playLabel = playing ? t("chat.voiceNote.pause") : onLiveCall ? t("chat.voiceNote.onLiveCall") : t("chat.voiceNote.play");

  return (
    <div
      className={cn("flex w-[400px] max-w-full flex-col overflow-hidden rounded-[26px] bg-ink/[0.06]", className)}
      data-test-voice-note=""
    >
      <div className="flex h-12 w-full items-center gap-3 px-2">
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const loaded = event.currentTarget.duration;
            if (Number.isFinite(loaded) && loaded > 0) setDuration(loaded);
            event.currentTarget.playbackRate = speed;
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={(event) => {
            // A queued pause can land after playback already resumed.
            if (!event.currentTarget.paused) return;
            setPlaying(false);
            giveBackVoice();
          }}
          onEnded={() => {
            setPlaying(false);
            giveBackVoice();
          }}
        />
        <div className="flex h-8 shrink-0 items-center rounded-full bg-ink/[0.08] shadow-[0_0_0_0.5px_rgb(28_28_28/0.06)]">
          <button
            type="button"
            onClick={toggle}
            disabled={onLiveCall && !playing}
            aria-label={playLabel}
            className="ms-1.5 me-1 flex size-6 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:text-ink disabled:opacity-40"
          >
            <GrokIcon name={playing ? "pause" : "play"} variant="filled" size={14} />
          </button>
          <span aria-hidden="true" className="h-8 w-[0.5px] bg-ink/[0.06]" />
          <button type="button" onClick={cycleSpeed} aria-label={t("chat.voiceNote.speed", { speed: String(speed) })}
            className="h-8 w-[34px] pe-0.5 text-[14px] font-medium leading-5 text-ink-secondary transition-colors hover:text-ink">
            {speed}×
          </button>
        </div>
        <div className="relative flex h-8 min-w-0 flex-1 items-center">
          <span aria-hidden="true" className="flex h-full w-full items-center justify-between gap-px">
            {bars.map((height, index) => (
              <span key={index} className={cn("w-[1.5px] rounded-full", index / bars.length < progress ? "bg-ink/[0.56]" : "bg-ink/[0.2]")} style={{ height }} />
            ))}
          </span>
          <input
            type="range"
            aria-label={t("chat.voiceNote.seek")}
            min={0}
            max={duration ?? 0}
            step={0.1}
            value={Math.min(time, duration ?? time)}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            disabled={!duration}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </div>
        <span className="shrink-0 text-[13px] leading-[18px] tabular-nums text-ink-secondary">
          {clock(playing || time > 0 ? time : duration ?? 0)}
        </span>
        {transcript ? (
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            data-test-voice-note-transcript=""
            aria-expanded={transcriptOpen}
            aria-label={t("chat.voiceNote.transcript")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink/[0.66] transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            <GrokIcon name="chevrons-up-down" size={14} />
          </button>
        ) : <span aria-hidden="true" className="w-1" />}
      </div>
      {transcript && transcriptOpen && (
        <>
          <span aria-hidden="true" className="h-px w-full bg-ink/[0.08]" />
          <p className="whitespace-pre-wrap px-3 py-1 pb-2.5 text-[14px] leading-5 text-ink/[0.48]">{transcript}</p>
        </>
      )}
    </div>
  );
}
