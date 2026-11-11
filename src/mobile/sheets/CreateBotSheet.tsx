import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MausAvatar } from "@/components/Avatar";
import { WorkingDots } from "@/components/WorkingIndicator";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { MAUS_COLORS, colorSwatch, type MausColor } from "@/lib/mascot";
import { useStore } from "@/state/store";
import type { DuskBodyId } from "../../../shared/body-migration";
import { Sheet } from "../Sheet";
import { haptic } from "../haptics";
import { spring } from "../motion";
import type { SheetPageProps } from "./registry";

const BODIES = ["circle", "cloud", "squircle", "star", "pill", "heart", "moon", "drop"] as const satisfies readonly DuskBodyId[];
const COLORS = Object.keys(MAUS_COLORS) as MausColor[];

function moveRadio(event: KeyboardEvent<HTMLDivElement>) {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!step && event.key !== "Home" && event.key !== "End") return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']"));
  const current = buttons.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + step + buttons.length) % buttons.length;
  buttons[index]?.focus();
  buttons[index]?.click();
}

export function CreateBotSheet({ open, onClose, onOpenChat }: SheetPageProps<"create">) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState("");
  const [body, setBody] = useState<DuskBodyId>("circle");
  const [color, setColor] = useState<MausColor>("blue");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const reduced = useReducedMotion();
  const nameId = useId();
  const pending = state.botCreationPending === true;
  useEffect(() => { if (open) { setName(""); setError(false); setRevision(0); } }, [open]);
  const create = () => {
    if (!name.trim() || pending) return;
    setError(false);
    dispatch({
      type: "newBot",
      look: { name: name.trim(), color, mascotBody: body },
      preserveSelection: true,
      onCreated: (bot) => { haptic("success"); onClose(); onOpenChat(bot.id); },
      onError: () => { setError(true); haptic("error"); },
    });
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.create.title")} bodyClassName="flex flex-col">
      <form onSubmit={(event) => { event.preventDefault(); create(); }} className="flex flex-col gap-5 px-6 pt-3">
        <motion.div key={revision} initial={{ scale: revision && !reduced ? 0.94 : 1 }} animate={{ scale: 1 }} transition={spring.lively} className="self-center">
          <MausAvatar bodyId={body} color={color} size={112} animated={false} label={t("mobile.create.preview")} />
        </motion.div>
        <label htmlFor={nameId} className="sr-only">{t("mobile.create.name")}</label>
        <input id={nameId} name="botName" value={name} maxLength={80} autoComplete="off" onChange={(event) => setName(event.target.value)} placeholder={t("mobile.create.placeholder")} className="h-12 w-full rounded-full border-0 bg-ink/[0.05] px-4 text-center text-[17px] font-semibold text-ink placeholder:text-ink-tertiary" />
        <div role="radiogroup" aria-label={t("mobile.create.body")} onKeyDown={moveRadio} className="grid grid-cols-4 justify-items-center gap-y-3">
          {BODIES.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={id === body} aria-label={t(`mobile.create.body.${id}`)} tabIndex={id === body ? 0 : -1} onClick={() => { if (id !== body) { setBody(id); setRevision((value) => value + 1); haptic("selection"); } }} className="mobile-press flex size-12 items-center justify-center rounded-full">
              <span className={cn("flex size-10 items-center justify-center rounded-full", id === body && "ring-2 ring-ink ring-offset-[3px] ring-offset-app")}><MausAvatar bodyId={id} color={color} size={40} animated={false} label="" /></span>
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label={t("mobile.create.colour")} onKeyDown={moveRadio} className="grid grid-cols-7 justify-items-center self-center">
          {COLORS.map((value) => (
            <button key={value} type="button" role="radio" aria-label={t(`mobile.create.colour.${value}`)} aria-checked={value === color} tabIndex={value === color ? 0 : -1} onClick={() => { if (value !== color) { setColor(value); setRevision((count) => count + 1); haptic("selection"); } }} className="mobile-press flex size-11 items-center justify-center rounded-full">
              <span className={cn("size-[30px] rounded-full", value === color && "ring-2 ring-ink ring-offset-[3px] ring-offset-app")} style={{ background: colorSwatch(value) }} />
            </button>
          ))}
        </div>
        <div className="sticky bottom-0 bg-app pb-1 pt-2">
          <button type="submit" disabled={!name.trim() || pending} aria-busy={pending} className="mobile-press flex h-12 w-full items-center justify-center rounded-full bg-ink text-[16px] font-semibold text-app disabled:opacity-40">
            {pending ? <><WorkingDots size={4} /><span className="sr-only">{t("mobile.create.creating")}</span></> : t("mobile.create.submit")}
          </button>
          {error && <p role="alert" className="mt-3 text-center text-[14px] text-danger">{t("mobile.create.error")}</p>}
        </div>
      </form>
    </Sheet>
  );
}
