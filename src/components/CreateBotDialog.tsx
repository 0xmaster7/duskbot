import { useEffect, useId, useRef, useState } from "react";
import { GROK_BODIES, type GrokBodyId } from "../../shared/grok-bodies";
import { isMausColor, type MausColor } from "../../shared/wire";
import { useStore } from "@/state/store";
import { CREATE_BOT_EVENT, openCreateBot, takeCreateBotSection } from "@/lib/create-bot-request";
import { openNewGroup } from "@/lib/new-group-request";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { MausAvatar } from "./Avatar";
import { GrokIcon } from "./GrokIcon";
import { VIEW_SPAN } from "./mascot-motion";

/** Grok Bot's Create New Bot shapes, in its rows of five, five and three. */
const SHAPES: GrokBodyId[][] = [
  ["blob", "cloud", "square", "sparkle", "clover"],
  ["heart", "flower", "teardrop", "tablet", "wedge"],
  ["house", "star", "hex"],
];

/** Grok Bot's eleven colours, each painted as its swatch shows it, and the bot colour it makes. Brown has no bot colour
 * here yet, so its dot waits until one exists. */
const COLORS: { label: string; dot: string; color: string }[] = [
  { label: "Black", dot: "#000000", color: "chrome" },
  { label: "Brown", dot: "#a06b39", color: "brown" },
  { label: "Red", dot: "#fb2b3e", color: "red" },
  { label: "Orange", dot: "#fd690f", color: "orange" },
  { label: "Yellow", dot: "#f59312", color: "yellow" },
  { label: "Green", dot: "#14c16f", color: "green" },
  { label: "Cyan", dot: "#13b7a2", color: "teal" },
  { label: "Blue", dot: "#1e86fc", color: "blue" },
  { label: "Violet", dot: "#8f59f9", color: "purple" },
  { label: "Magenta", dot: "#f93498", color: "pink" },
  { label: "Gray", dot: "#959595", color: "silver" },
];
const SWATCHES = COLORS.filter((swatch): swatch is { label: string; dot: string; color: MausColor } => isMausColor(swatch.color));

export { openCreateBot };

const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

function useOpenRequests(onOpen: () => void) {
  const latest = useRef(onOpen);
  latest.current = onOpen;
  useEffect(() => {
    const open = () => latest.current();
    window.addEventListener(CREATE_BOT_EVENT, open);
    return () => window.removeEventListener(CREATE_BOT_EVENT, open);
  }, []);
}

export function CreateBotDialog() {
  const [session, setSession] = useState<{ key: number; section?: string } | null>(null);
  useOpenRequests(() => { const section = takeCreateBotSection(); setSession((open) => open ?? { key: Date.now(), section }); });
  if (!session) return null;
  return <CreateBotForm key={session.key} section={session.section} onClose={() => setSession(null)} />;
}

function CreateBotForm({ section, onClose }: { section?: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState("");
  // Grok Bot opens on a shape and colour of its own choosing, a new one each time.
  const [body, setBody] = useState<GrokBodyId>(() => pick(SHAPES.flat()));
  const [color, setColor] = useState<MausColor>(() => pick(SWATCHES).color);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const pending = state.botCreationPending === true;
  const canCreate = name.trim().length > 0 && !pending;

  const create = () => {
    if (!canCreate) return;
    dispatch({ type: "newBot", section, look: { name: name.trim(), color, mascotBody: body } });
    onClose();
  };

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      const root = dialog.current;
      if (!root) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = [...root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      // The page behind is out of reach while the dialog is up.
      if (!root.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60]">
      <div aria-hidden className="absolute inset-0 bg-black/50" onMouseDown={onClose} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-create-bot-dialog
        className="absolute left-1/2 top-1/2 flex max-h-[calc(100vh-32px)] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-ink/12 bg-menu text-[13px] text-ink"
      >
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className="absolute right-2.5 top-2.5 z-[1] flex size-8 items-center justify-center rounded-[9999px] text-ink-secondary transition-[color,background-color,border-color] duration-150 ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <GrokIcon name="close" size={14} />
        </button>
        <div className="flex shrink-0 flex-col items-start gap-1 border-b border-ink/12 p-4">
          <h2 id={titleId} className="m-0 text-[14px] font-semibold leading-[22px] tracking-[-0.15px]">Create New Bot</h2>
        </div>
        <div className="min-h-0 w-full overflow-auto p-4 leading-[18px] tracking-[-0.08px]">
          <div className="flex flex-col gap-3">
            <span className="flex self-center" data-create-bot-preview>
              <MausAvatar bodyId={body} color={color} size={96} gaze={FACING} />
            </span>
            <input
              autoFocus
              type="text"
              aria-label="Bot name"
              placeholder="Name your Bot"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); create(); } }}
              className="my-1 h-9 w-full rounded-[8px] border border-ink/12 bg-transparent px-2.5 py-2 text-center text-[13px] tracking-[0.195px] text-ink outline-none placeholder:text-ink/56 focus:border-ink/12!"
            />
            <div className="flex flex-col gap-3">
              <div role="group" aria-label="Character shape" className="flex flex-col gap-2 py-1.5">
                {SHAPES.map((row) => (
                  <div key={row[0]} className="flex justify-center gap-x-[clamp(0px,calc((100%-240px)/4),8px)]">
                    {row.map((id) => (
                      <ShapeTile key={id} id={id} color={color} selected={id === body} onPick={() => setBody(id)} />
                    ))}
                  </div>
                ))}
              </div>
              <div role="group" aria-label="Character color" className="flex max-w-[232px] flex-wrap items-center justify-center gap-2 self-center py-2">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch.label}
                    type="button"
                    aria-label={`${swatch.label} character color`}
                    aria-pressed={swatch.color === color}
                    onClick={() => setColor(swatch.color)}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-[50%] border border-transparent p-0 text-black outline-none hover:border-ink/12 focus-visible:shadow-[0_0_0_2px_var(--color-focus)] focus-visible:outline-none!"
                  >
                    <span
                      className="block size-6 rounded-[50%]"
                      style={{ backgroundColor: swatch.dot, boxShadow: swatch.color === color ? "0 0 0 3px var(--color-menu), 0 0 0 4px color-mix(in srgb, var(--color-ink) 24%, transparent)" : undefined }}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ink/12 py-3 pl-4 pr-3">
          <button
            type="button"
            data-group-instead=""
            onClick={() => { onClose(); openNewGroup(); }}
            className="mr-auto cursor-pointer rounded-[6px] border-0 bg-transparent p-0 text-[13px] leading-[18px] tracking-[0.195px] text-ink-secondary transition-colors duration-[120ms] ease-[ease-out] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t("createBot.groupInstead")}
          </button>
          <button type="button" onClick={onClose} className={cn(KIT_BUTTON, "bg-ink/6 text-ink hover:bg-ink/10")}><span>Cancel</span></button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={create}
            className={cn(KIT_BUTTON, "bg-ink text-app hover:bg-[color-mix(in_srgb,var(--color-ink)_88%,var(--color-app))] disabled:bg-ink/15 disabled:text-ink/30")}
          >
            <span>Create</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Grok Bot's kit button: a 32px pill, 14px words at regular weight, a hairline drawn in its own ink. */
const KIT_BUTTON = "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[9999px] px-3 py-1.5 text-[14px] font-normal leading-5 tracking-[0.01em] shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,currentColor_15%,transparent)] outline-none transition-[background-color,color] duration-[120ms] ease-[ease-out] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default";

const MARK = 36;
const VIEW_BOX = `-15 -15 ${VIEW_SPAN} ${VIEW_SPAN}`;

/** Grok's editor preview faces the viewer at rest, turning only toward a pointer on it, and morphs between shapes. */
const FACING = { x: 0, y: 0 } as const;

/** A shape to pick, in the chosen colour. Hovered, focused or chosen, a 1px ring follows its outline 3px out, as Grok's
 * tiles do: faint on hover, darker once chosen. */
function ShapeTile({ id, color, selected, onPick }: { id: GrokBodyId; color: MausColor; selected: boolean; onPick: () => void }) {
  const ring = useId().replace(/:/g, "");
  const shape = GROK_BODIES[id];
  const d = /\sd="([^"]+)"/.exec(shape.clip)?.[1] ?? "";
  // Ring widths are in screen px; the outline is drawn under the viewBox's scale and the body's own fit.
  const unit = VIEW_SPAN / MARK / Number(/scale\(([\d.]+)\)/.exec(shape.fit)?.[1] ?? 1);
  return (
    <button
      type="button"
      aria-label={`${id} character shape`}
      aria-pressed={selected}
      onClick={onPick}
      className="group/shape relative inline-flex size-12 cursor-pointer appearance-none items-center justify-center border-0 bg-transparent p-0 text-black outline-none focus-visible:outline-none!"
    >
      <MausAvatar bodyId={id} color={color} size={MARK} animated={false} trackPointer={false} />
      <svg
        aria-hidden
        width={MARK}
        height={MARK}
        viewBox={VIEW_BOX}
        overflow="visible"
        className={cn(
          "pointer-events-none absolute text-ink opacity-0",
          selected ? "opacity-24" : "group-hover/shape:opacity-12 group-focus-visible/shape:opacity-24",
        )}
      >
        <mask id={ring} maskUnits="userSpaceOnUse" x={-VIEW_SPAN} y={-VIEW_SPAN} width={VIEW_SPAN * 3} height={VIEW_SPAN * 3}>
          <g transform={shape.fit}>
            <path d={d} fill="#fff" stroke="#fff" strokeWidth={8 * unit} strokeLinejoin="round" />
            <path d={d} fill="#000" stroke="#000" strokeWidth={6 * unit} strokeLinejoin="round" />
          </g>
        </mask>
        <rect x={-VIEW_SPAN} y={-VIEW_SPAN} width={VIEW_SPAN * 3} height={VIEW_SPAN * 3} fill="currentColor" mask={`url(#${ring})`} />
      </svg>
    </button>
  );
}
