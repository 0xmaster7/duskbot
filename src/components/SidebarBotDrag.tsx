import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { nextRename } from "@/lib/rename";
import { BOTS_SECTION_ID, userSectionName } from "@/lib/sidebar-layout";
import { BOT_ROW_DRAG_TYPE, botDropPlace, botListOf, planBotDrop, sameBotDrop, stepBot, unusedName, type BotDrop, type BotDropPlace, type BotMove } from "@/lib/sidebar-bot-drop";
import type { Action, Bot } from "@/state/store";
import { moveBotsToSection, renameDepartment, saveBotOrder, useMayMoveBots } from "./bot-sections";

/** The department being named, before it exists. The server trims names and never keeps a control character. */
export const NEW_DEPARTMENT = "\u0000new";
const PIN_LIST = "\u0000pin";

type DropHandlers = { onDragOver: (event: DragEvent<HTMLElement>) => void; onDrop: (event: DragEvent<HTMLElement>) => void };

export type BotRowDrag = {
  row(botId: string): DropHandlers & { draggable: true; onDragStart: (event: DragEvent<HTMLElement>) => void; onDragEnd: () => void };
  step(botId: string, direction: -1 | 1): void;
};

export type SectionNaming = { value: string; label: string; onCommit: (name: string) => void; onCancel: () => void };

type Naming = { kind: "new"; botIds: string[]; name: string } | { kind: "rename"; section: string };

type Arranged = { enabled: boolean; lists: Map<string, string[]>; bots: Bot[]; taken: string[] };

const carries = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes(BOT_ROW_DRAG_TYPE);
const failure = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function botRowDropClass(drop: BotDropPlace | null | undefined, dragging: boolean | undefined, simple = false): string {
  return cn(dragging && (simple ? "opacity-50" : "opacity-40"), drop === "group" && "rounded-[12px] bg-accent/10 outline outline-2 -outline-offset-2 outline-accent/70");
}

type Lift = { botId: string; left: number; top: number; x: number; y: number };

const TILE = { width: 80, height: 90 };
/** grok holds the lifted tile centred on the pointer */
const tileAt = (x: number, y: number) => `translate3d(${x - TILE.width / 2}px, ${y - TILE.height / 2}px, 0)`;

let blankImage: HTMLImageElement | null = null;
/** Chrome draws a native drag image unless it is handed an empty one; the tile below is drawn instead. */
function hideNativeDragImage(event: DragEvent<HTMLElement>) {
  blankImage ??= Object.assign(new Image(), { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });
  event.dataTransfer.setDragImage(blankImage, 0, 0);
}

const DROP_BACK = "transform 300ms cubic-bezier(.25,1.15,.4,1)";

/** Grok's lifted bot: an 80px tile, its avatar and name on a 90% white card, scaled 1.04, that follows the pointer and
 * springs back to its row when the drag is called off. */
function BotDragTile({ lift, bot, returning, onReturned }: { lift: Lift; bot: Bot; returning: boolean; onReturned: () => void }) {
  const tile = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (returning) return;
    let frame = 0;
    const follow = (event: { clientX: number; clientY: number }) => {
      if (event.clientX === 0 && event.clientY === 0) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (tile.current) tile.current.style.transform = tileAt(event.clientX, event.clientY);
      });
    };
    document.addEventListener("dragover", follow);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("dragover", follow); };
  }, [lift, returning]);
  useEffect(() => {
    if (!returning) return;
    const element = tile.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onReturned();
    element.style.transition = DROP_BACK;
    element.style.transform = `translate3d(${lift.left}px, ${lift.top}px, 0)`;
    const timer = window.setTimeout(onReturned, 300);
    return () => window.clearTimeout(timer);
  }, [returning, onReturned, lift]);
  const style: CSSProperties = { left: 0, top: 0, transform: tileAt(lift.x, lift.y) };
  return createPortal(
    <div ref={tile} aria-hidden="true" data-bot-drag-tile="" className="pointer-events-none fixed z-[999] w-20" style={style}>
      <div className="relative scale-[1.04]">
        <div className="absolute inset-0 rounded-xl bg-composer opacity-90 shadow-(--shadow-popover)" />
        <div className="relative flex flex-col items-center gap-1 px-2 py-1">
          <BotAvatar bot={bot} size={60} animated={false} trackPointer={false} />
          <span className="w-full truncate text-center text-[12px] font-medium leading-[18px] tracking-[0.01em] text-ink">{bot.name}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BotDropLine({ place }: { place: BotDropPlace | null | undefined }) {
  if (place !== "before" && place !== "after") return null;
  return <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-accent", place === "before" ? "-top-[2px]" : "-bottom-[2px]")} />;
}

/** Dragging bots between the rows outside any department and each department's, onto a bot to start a department,
 * Alt+Up/Down, and the name field a new or renamed department shows in its heading. */
export function useSidebarBotDrag({ dispatch, announce, onNamed, onRenamed, onError, onCancelled, simple = false }: {
  /** grok's drag: a lifted tile, a section takes the bot as a whole, and a slot at the top pins it */
  simple?: boolean;
  dispatch: Dispatch<Action>;
  announce: (text: string) => void;
  onNamed: (name: string) => void;
  onRenamed: (from: string, to: string) => void;
  onError: (message: string) => void;
  onCancelled: () => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<BotDrop | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const [returning, setReturning] = useState(false);
  // grok fades the pin slot out where it stands before the list closes over it
  const [slotLeaving, setSlotLeaving] = useState(false);
  useEffect(() => {
    if (!slotLeaving) return;
    const timer = window.setTimeout(() => setSlotLeaving(false), 150);
    return () => window.clearTimeout(timer);
  }, [slotLeaving]);
  const dropped = useRef(false);
  const grok = useRef(simple);
  grok.current = simple;
  const mayMove = useMayMoveBots();
  const latest = useRef<Arranged>({ enabled: false, lists: new Map(), bots: [], taken: [] });
  const moving = useRef<{ botId: string | null; drop: BotDrop | null }>({ botId: null, drop: null });
  const controller = useRef<BotRowDrag | null>(null);
  const actions = useRef({ dispatch, announce });
  actions.current = { dispatch, announce };

  const show = (next: BotDrop | null) => {
    if (sameBotDrop(moving.current.drop, next)) return;
    moving.current.drop = next;
    setDrop(next);
  };
  const end = () => {
    if (grok.current && moving.current.botId) setSlotLeaving(true);
    moving.current = { botId: null, drop: null };
    setDragging(null);
    setDrop(null);
    if (dropped.current) setLift(null);
    else setReturning(true);
    dropped.current = false;
  };
  const startNew = (botIds: string[]) => setNaming({ kind: "new", botIds, name: unusedName(t("sidebar.grok.newSection"), latest.current.taken) });
  const apply = (botId: string, move: BotMove, keyboard: boolean) => {
    if (move.kind === "group") return startNew(move.botIds);
    const { lists, bots } = latest.current;
    if (botListOf(lists, botId) !== move.section) moveBotsToSection(actions.current.dispatch, [botId], move.section);
    saveBotOrder(actions.current.dispatch, bots, move.order);
    if (!keyboard) return;
    const name = bots.find((bot) => bot.id === botId)?.name ?? "";
    actions.current.announce(t("sidebar.section.moved", { name, position: move.order.indexOf(botId) + 1, count: move.order.length }));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(botId)}"]`)?.focus());
  };
  const finish = (target: BotDrop | null) => {
    const botId = moving.current.botId;
    dropped.current = true;
    end();
    const move = botId && target && latest.current.enabled ? planBotDrop(latest.current.lists, botId, target) : null;
    if (botId && move) apply(botId, move, false);
  };
  const rowDrop = (event: DragEvent<HTMLElement>, botId: string): BotDrop => {
    const box = event.currentTarget.getBoundingClientRect();
    return { kind: "row", botId, place: botDropPlace(event.clientY - box.top, box.height, botListOf(latest.current.lists, botId) === "") };
  };

  controller.current ??= {
    row: (botId) => ({
      draggable: true,
      onDragStart: (event) => {
        if (!latest.current.enabled || botListOf(latest.current.lists, botId) === undefined) return;
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(BOT_ROW_DRAG_TYPE, botId);
        moving.current = { botId, drop: null };
        setDragging(botId);
        if (grok.current) {
          hideNativeDragImage(event);
          const box = event.currentTarget.getBoundingClientRect();
          dropped.current = false;
          setReturning(false);
          setLift({ botId, left: box.left, top: box.top, x: event.clientX, y: event.clientY });
        }
      },
      onDragEnd: () => { if (moving.current.botId) end(); },
      onDragOver: (event) => {
        if (grok.current || !carries(event) || !moving.current.botId) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        show(botId === moving.current.botId ? null : rowDrop(event, botId));
      },
      onDrop: (event) => {
        if (grok.current || !carries(event)) return;
        event.preventDefault();
        event.stopPropagation();
        finish(botId === moving.current.botId ? null : rowDrop(event, botId));
      },
    }),
    step: (botId, direction) => {
      const move = latest.current.enabled ? stepBot(latest.current.lists, botId, direction) : null;
      if (move) apply(botId, move, true);
    },
  };

  const finishNaming = (current: Naming, draft: string) => {
    setNaming(null);
    if (current.kind === "new") {
      const name = draft.trim() || current.name;
      moveBotsToSection(dispatch, current.botIds.filter((id) => latest.current.bots.some((bot) => bot.id === id && !bot.hidden)), name);
      onNamed(name);
      return;
    }
    const to = nextRename(current.section, draft);
    if (to) renameDepartment(dispatch, current.section, to).then(() => onRenamed(current.section, to), (cause) => onError(failure(cause)));
  };

  const lifted = lift ? latest.current.bots.find((bot) => bot.id === lift.botId) : undefined;
  return {
    overlay: lift && lifted ? <BotDragTile lift={lift} bot={lifted} returning={returning} onReturned={() => { setLift(null); setReturning(false); }} /> : null,
    pending: naming?.kind === "new" ? [NEW_DEPARTMENT] : [],
    preview: <T extends Bot>(bots: T[]): T[] => naming?.kind === "new" ? bots.map((bot) => (naming.botIds.includes(bot.id) ? { ...bot, section: NEW_DEPARTMENT } : bot)) : bots,
    startNew: (botIds: string[]) => startNew(botIds),
    startRename: (section: string) => setNaming({ kind: "rename", section }),
    arrange({ enabled, main, sectioned, departments, bots, taken }: {
      enabled: boolean; main: Bot[]; sectioned: Bot[]; departments: string[]; bots: Bot[]; taken: string[];
    }) {
      const movable = enabled && mayMove;
      const lists = new Map<string, string[]>([["", main.map((bot) => bot.id)]]);
      for (const name of departments) if (name !== NEW_DEPARTMENT) lists.set(name, sectioned.filter((bot) => bot.section === name).map((bot) => bot.id));
      latest.current = { enabled: movable, lists, bots, taken };
      const active = movable && dragging !== null && botListOf(lists, dragging) !== undefined ? dragging : null;
      const shown = active ? drop : null;
      const mainIds = lists.get("")!.filter((id) => id !== active);
      const listFor = (sectionId: string) => (sectionId === BOTS_SECTION_ID ? "" : userSectionName(sectionId));
      // Between rows, or under the last one, the nearest row places the bot; a department's heading takes it in.
      const zoneDrop = (event: DragEvent<HTMLElement>, list: string): BotDrop => {
        const ids = lists.get(list)!;
        const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-sidebar-bot-row]")]
          .filter((element) => ids.includes(element.dataset.sidebarBotRow ?? "")).map((element) => ({ botId: element.dataset.sidebarBotRow!, box: element.getBoundingClientRect() }));
        if (!rows.length || (list !== "" && event.clientY < rows[0]!.box.top)) return { kind: "end", list };
        const row = rows.find(({ box }) => event.clientY < box.bottom) ?? rows.at(-1)!;
        return { kind: "row", botId: row.botId, place: event.clientY < row.box.top + row.box.height / 2 ? "before" : "after" };
      };
      const grokDrop = (list: string): BotDrop => ({ kind: "end", list });
      const pinning = active !== null && simple && !bots.find((bot) => bot.id === active)?.pinned;
      const pinOver = shown?.kind === "end" && shown.list === PIN_LIST;
      return {
        /** the section a lifted bot would go into, washed grey as grok does */
        over: (sectionId: string) => simple && shown?.kind === "end" && shown.list !== PIN_LIST && shown.list === listFor(sectionId),
        pinSlot: pinning || (simple && slotLeaving) ? (
          <div className={cn("pb-0.5 transition-opacity duration-150 ease-out motion-reduce:transition-none", !pinning && "pointer-events-none opacity-0")}>
            <div data-bot-pin-slot="" className={cn("flex h-[104px] items-center justify-center rounded-xl border border-dashed text-[14px] leading-5 tracking-[0.01em] text-ink-secondary", pinOver ? "border-transparent bg-ink/[0.06]" : "border-transparent")}
              onDragOver={(event) => {
                if (!carries(event) || !moving.current.botId) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                show({ kind: "end", list: PIN_LIST });
              }}
              onDrop={(event) => {
                if (!carries(event)) return;
                event.preventDefault();
                event.stopPropagation();
                const botId = moving.current.botId;
                dropped.current = true;
                end();
                if (botId) actions.current.dispatch({ type: "updateBot", botId, patch: { pinned: true } });
              }}>
              {t("sidebar.grok.dragToPin")}
            </div>
          </div>
        ) : null,
        row: (botId: string): { botDrag?: BotRowDrag; botDrop?: BotDropPlace | null; botDragging?: boolean } => {
          if (!movable || botListOf(lists, botId) === undefined) return {};
          if (simple) return { botDrag: controller.current!, botDrop: null, botDragging: active === botId };
          const place = shown?.kind === "row" && shown.botId === botId ? shown.place
            : shown?.kind === "end" && shown.list === "" && botId === mainIds.at(-1) ? "after" : null;
          return { botDrag: controller.current!, botDrop: place, botDragging: active === botId };
        },
        into: (name: string | null) => !simple && shown?.kind === "end" && name !== null && name !== "" && shown.list === name,
        zone: (sectionId: string, fallback: DropHandlers): DropHandlers => ({
          onDragOver: (event) => {
            if (!carries(event)) return fallback.onDragOver(event);
            const list = listFor(sectionId);
            if (!moving.current.botId || list === null || !lists.has(list)) return show(null);
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (simple) return show(grokDrop(list));
            const target = zoneDrop(event, list);
            show(target.kind === "row" && target.botId === moving.current.botId ? null : target);
          },
          onDrop: (event) => {
            if (!carries(event)) return fallback.onDrop(event);
            event.preventDefault();
            const list = listFor(sectionId);
            // a bot dropped back on its own section stays where it was, as in grok
            if (simple) {
              const first = list !== null ? lists.get(list)?.[0] : undefined;
              const into: BotDrop | null = list === null || !lists.has(list) || botListOf(lists, moving.current.botId ?? "") === list ? null
                : first ? { kind: "row", botId: first, place: "before" } : { kind: "end", list };
              return finish(into);
            }
            finish(list !== null && lists.has(list) ? zoneDrop(event, list) : null);
          },
        }),
        slot: active !== null && mainIds.length === 0 && botListOf(lists, active) !== ""
          ? <div data-bot-drop-slot="" className={cn("mx-2 flex h-10 items-center justify-center rounded-[10px] border border-dashed text-[13px] leading-[18px]",
            shown?.kind === "end" && shown.list === "" ? "border-accent bg-accent/10 text-ink" : "border-transparent text-ink-secondary")}>{t("sidebar.grok.unassigned")}</div>
          : null,
        naming: (name: string | null): SectionNaming | undefined => {
          if (!naming || name === null) return undefined;
          const value = naming.kind === "new" ? (name === NEW_DEPARTMENT ? naming.name : null) : (name === naming.section ? naming.section : null);
          if (value === null) return undefined;
          return {
            value,
            label: naming.kind === "new" ? t("sidebar.grok.newSection") : t("sidebar.grok.renameSection"),
            onCommit: (draft) => finishNaming(naming, draft),
            onCancel: () => { setNaming(null); if (naming.kind === "rename") onNamed(naming.section); else onCancelled(); },
          };
        },
      };
    },
  };
}
