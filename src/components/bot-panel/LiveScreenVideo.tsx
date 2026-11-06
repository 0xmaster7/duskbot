import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

/** This computer's live screen, painted by the browser as frames arrive. */
export function LiveScreenVideo({ stream, playing = true, onRatio, label, className }: {
  stream: MediaStream;
  playing?: boolean;
  onRatio?: (ratio: number) => void;
  label?: string;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const ratio = useRef(onRatio);
  ratio.current = onRatio;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    const measure = () => {
      if (element.videoWidth && element.videoHeight) ratio.current?.(element.videoWidth / element.videoHeight);
    };
    element.addEventListener("loadedmetadata", measure);
    element.addEventListener("resize", measure);
    measure();
    return () => {
      element.removeEventListener("loadedmetadata", measure);
      element.removeEventListener("resize", measure);
    };
  }, [stream]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (playing) void element.play().catch(() => {});
    else element.pause();
  }, [playing, stream]);

  useEffect(() => {
    const element = video.current;
    return () => {
      if (element) element.srcObject = null;
    };
  }, []);

  return (
    <video
      ref={video}
      data-live-screen=""
      muted
      playsInline
      autoPlay
      disablePictureInPicture
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("pointer-events-none select-none", className)}
    />
  );
}
