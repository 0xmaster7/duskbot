import { useEffect, useLayoutEffect, useRef } from "react";
import { Mascot } from "../../ui/Mascot";
import { clampPhi, decodeDots, equirect, orthographic, wrapLambda, type Rotation } from "./project";

export interface GlobeProps {
  points: Array<{
    id: string;
    lat: number;
    lon: number;
    label: string;
    detail: string;
    avatar: { body: string; colour: string };
    customer?: boolean;
    fresh?: boolean;
  }>;
  mode: "3d" | "2d";
  selected?: string | null;
  onSelect?(id: string | null): void;
  className?: string;
  /** spoken summary for screen readers */
  summary: string;
}

let dotsPromise: Promise<Float32Array> | undefined;
function loadDots() {
  return dotsPromise ??= import("./land-dots.json").then(module => decodeDots(module.default as number[]));
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-[3px]";

export default function Globe(props: GlobeProps) {
  const { points, mode, selected, onSelect, className, summary } = props;
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());
  const latest = useRef(props);
  const view = useRef<{ rotation: Rotation; zoom: number }>({ rotation: { lambda: 0, phi: 0 }, zoom: 1 });
  const controls = useRef<{ invalidate(): void; zoom(delta: number): void } | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    latest.current = props;
    controls.current?.invalidate();
  }, [props]);

  useEffect(() => {
    const host = container.current;
    const surface = canvas.current;
    const ctx = surface?.getContext("2d");
    if (!host || !surface || !ctx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let disposed = false;
    let dots: Float32Array | undefined;
    let width = 0, height = 0, dpr = 1;
    let frame = 0, idleTimer = 0, previousFrame = 0;
    let dirty = true;
    let lastInteraction = performance.now();
    let velocity = { lambda: 0, phi: 0 };
    let drag: { id: number; x: number; y: number; startX: number; startY: number; time: number } | null = null;
    suppressClick.current = false;
    if (mode === "2d") view.current.zoom = 1;

    function draw() {
      if (!ctx || !host || !surface || width <= 0 || height <= 0) return;
      const { rotation, zoom } = view.current;
      const radius = 0.46 * Math.min(width, height) * zoom;
      const cx = width / 2, cy = height / 2;
      const styles = getComputedStyle(host);
      const card = styles.getPropertyValue("--card").trim();
      const line = styles.getPropertyValue("--line-2").trim();
      const ink = styles.getPropertyValue("--ink-4").trim();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = card;
      ctx.save();
      if (mode === "3d") {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.clip();
      } else {
        ctx.fillRect(0, 0, width, height);
      }
      const side = Math.max(1.6, Math.min(4, 2.2 * zoom));
      ctx.fillStyle = ink;
      for (let i = 0; dots && i < dots.length; i += 2) {
        const point = mode === "3d"
          ? orthographic(dots[i], dots[i + 1], rotation, radius, cx, cy)
          : { ...equirect(dots[i], dots[i + 1], width, height), z: 1 };
        if (point.z <= 0) continue;
        ctx.globalAlpha = mode === "3d" ? 0.25 + 0.75 * point.z : 0.8;
        ctx.fillRect(point.x - side / 2, point.y - side / 2, side, side);
      }
      ctx.restore();
      if (mode === "3d") {
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const point of latest.current.points) {
        const marker = markers.current.get(point.id);
        if (!marker) continue;
        const projected = mode === "3d"
          ? orthographic(point.lon, point.lat, rotation, radius, cx, cy)
          : { ...equirect(point.lon, point.lat, width, height), z: 1 };
        marker.style.display = projected.z > 0.05 ? "" : "none";
        marker.style.left = `${projected.x}px`;
        marker.style.top = `${projected.y}px`;
      }
    }

    function schedule() {
      if (!disposed && !document.hidden && !frame) frame = requestAnimationFrame(tick);
    }

    function invalidate() {
      dirty = true;
      schedule();
    }

    function tick(now: number) {
      frame = 0;
      const elapsed = previousFrame ? Math.min(now - previousFrame, 50) : 1000 / 60;
      previousFrame = now;
      const moving = !reduced && !drag && mode === "3d"
        && (Math.abs(velocity.lambda) > 0.005 || Math.abs(velocity.phi) > 0.005);
      const auto = !reduced && !drag && mode === "3d" && now - lastInteraction >= 3000;
      if (moving || auto) {
        const rotation = view.current.rotation;
        const steps = elapsed / (1000 / 60);
        rotation.lambda = wrapLambda(rotation.lambda + (moving ? velocity.lambda * steps : 4 * elapsed / 1000));
        rotation.phi = clampPhi(rotation.phi + (moving ? velocity.phi * steps : 0));
        const decay = Math.pow(0.92, steps);
        velocity.lambda *= decay;
        velocity.phi *= decay;
        dirty = true;
      }
      if (dirty) { draw(); dirty = false; }
      if (moving || auto) schedule();
      else {
        previousFrame = 0;
        window.clearTimeout(idleTimer);
        if (!reduced && !drag && mode === "3d") {
          idleTimer = window.setTimeout(schedule, Math.max(1, 3000 - (now - lastInteraction)));
        }
      }
    }

    function interact() {
      lastInteraction = performance.now();
      velocity = { lambda: 0, phi: 0 };
      window.clearTimeout(idleTimer);
    }

    function zoom(delta: number) {
      if (mode !== "3d") return;
      interact();
      view.current.zoom = Math.max(1, Math.min(3, view.current.zoom + delta));
      invalidate();
    }

    function resize() {
      if (!host || !surface) return;
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = window.devicePixelRatio || 1;
      surface.width = Math.round(width * dpr);
      surface.height = Math.round(height * dpr);
      invalidate();
    }

    function pointerDown(event: PointerEvent) {
      if (mode !== "3d" || drag || event.button !== 0 || (event.target as Element).closest("button")) return;
      interact();
      suppressClick.current = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now() };
      host?.setPointerCapture(event.pointerId);
      invalidate();
    }

    function pointerMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.id) return;
      const now = performance.now();
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) suppressClick.current = true;
      const scale = 0.3 / view.current.zoom;
      const rotation = view.current.rotation;
      rotation.lambda = wrapLambda(rotation.lambda + dx * scale);
      const phi = clampPhi(rotation.phi - dy * scale);
      const steps = Math.max(1, now - drag.time) / (1000 / 60);
      velocity = { lambda: dx * scale / steps, phi: (phi - rotation.phi) / steps };
      rotation.phi = phi;
      drag.x = event.clientX; drag.y = event.clientY; drag.time = now;
      lastInteraction = now;
      invalidate();
    }

    function pointerUp(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.id) return;
      if (reduced || event.type !== "pointerup" || performance.now() - drag.time > 100) velocity = { lambda: 0, phi: 0 };
      drag = null;
      lastInteraction = performance.now();
      if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      invalidate();
    }

    function wheel(event: WheelEvent) {
      if (mode !== "3d") return;
      event.preventDefault();
      zoom(-event.deltaY * (event.deltaMode === 1 ? 0.03 : event.deltaMode === 2 ? 0.3 : 0.001));
    }

    function keyDown(event: KeyboardEvent) {
      if (mode !== "3d" || event.target !== host) return;
      const rotation = view.current.rotation;
      switch (event.key) {
        case "ArrowLeft": rotation.lambda = wrapLambda(rotation.lambda - 10); break;
        case "ArrowRight": rotation.lambda = wrapLambda(rotation.lambda + 10); break;
        case "ArrowUp": rotation.phi = clampPhi(rotation.phi + 10); break;
        case "ArrowDown": rotation.phi = clampPhi(rotation.phi - 10); break;
        case "+": case "=": zoom(0.2); break;
        case "-": zoom(-0.2); break;
        default: return;
      }
      event.preventDefault();
      interact();
      invalidate();
    }

    function motionChange() {
      reduced = motion.matches;
      velocity = { lambda: 0, phi: 0 };
      invalidate();
    }

    function visibilityChange() {
      cancelAnimationFrame(frame);
      window.clearTimeout(idleTimer);
      frame = 0; previousFrame = 0;
      if (!document.hidden) { resize(); invalidate(); }
    }

    controls.current = { invalidate, zoom };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibilityChange);
    motion.addEventListener("change", motionChange);
    host.addEventListener("pointerdown", pointerDown);
    host.addEventListener("pointermove", pointerMove);
    host.addEventListener("pointerup", pointerUp);
    host.addEventListener("pointercancel", pointerUp);
    host.addEventListener("lostpointercapture", pointerUp);
    host.addEventListener("wheel", wheel, { passive: false });
    host.addEventListener("keydown", keyDown);
    void loadDots().then(loaded => {
      if (!disposed) { dots = loaded; invalidate(); }
    }).catch(() => {});
    resize();

    return () => {
      disposed = true;
      controls.current = null;
      cancelAnimationFrame(frame);
      window.clearTimeout(idleTimer);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibilityChange);
      motion.removeEventListener("change", motionChange);
      host.removeEventListener("pointerdown", pointerDown);
      host.removeEventListener("pointermove", pointerMove);
      host.removeEventListener("pointerup", pointerUp);
      host.removeEventListener("pointercancel", pointerUp);
      host.removeEventListener("lostpointercapture", pointerUp);
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("keydown", keyDown);
      if (drag && host.hasPointerCapture(drag.id)) host.releasePointerCapture(drag.id);
    };
  }, [mode]);

  return (
    <div
      ref={container}
      tabIndex={0}
      role="application"
      aria-label={summary}
      aria-roledescription="globe"
      className={`relative w-full overflow-hidden rounded-[24px] ${mode === "3d" ? "mx-auto aspect-square max-h-[640px] max-w-[640px] touch-none" : "aspect-[2/1] bg-card"} ${focusRing} ${className ?? ""}`}
      onClick={event => {
        if (event.target === canvas.current || event.target === event.currentTarget) {
          if (!suppressClick.current) onSelect?.(null);
          suppressClick.current = false;
        }
      }}
    >
      <canvas ref={canvas} aria-hidden="true" className={`absolute inset-0 h-full w-full ${mode === "3d" ? "cursor-grab active:cursor-grabbing" : ""}`} />
      {points.map(point => (
        <button
          key={point.id}
          ref={element => { if (element) markers.current.set(point.id, element); else markers.current.delete(point.id); }}
          type="button"
          aria-label={`${point.label}, ${point.detail}`}
          aria-pressed={selected === point.id}
          onClick={() => onSelect?.(point.id)}
          className={`group absolute grid size-[34px] place-items-center rounded-full bg-pop ${focusRing}`}
          style={{ display: "none", transform: "translate(-50%, -50%)", boxShadow: point.customer ? "0 0 0 2px var(--accent), var(--pop-shadow)" : "var(--pop-shadow)" }}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-[12.5px] text-primary-ink transition-opacity duration-150 motion-reduce:transition-none ${point.fresh || selected === point.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus:opacity-100"}`}
          >{point.detail}</span>
          <Mascot body={point.avatar.body} color={point.avatar.colour} size={24} still />
        </button>
      ))}
      {mode === "3d" && (
        <div className="absolute right-3 bottom-3 flex gap-2">
          {([{ label: "zoom in", text: "+", delta: 0.2 }, { label: "zoom out", text: "-", delta: -0.2 }]).map(button => (
            <button
              key={button.label}
              type="button"
              aria-label={button.label}
              onClick={() => controls.current?.zoom(button.delta)}
              className={`grid size-11 place-items-center rounded-full bg-pop text-xl text-ink-2 ${focusRing}`}
              style={{ boxShadow: "var(--pop-shadow)" }}
            >{button.text}</button>
          ))}
        </div>
      )}
    </div>
  );
}
