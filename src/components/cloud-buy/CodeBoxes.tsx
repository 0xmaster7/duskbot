import type { ClipboardEvent, KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { FIELD } from "./parts";

const DIGITS = 8;
export function codeDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, DIGITS);
}

export function CodeBoxes({ code, onCode, busy, wrong, labelId, problemId }: {
  code: string; onCode: (code: string) => void; busy: boolean; wrong: boolean; labelId: string; problemId?: string;
}) {
  const focusBox = (from: HTMLElement, index: number) => from.parentElement?.querySelectorAll<HTMLInputElement>("input")[index]?.focus();
  const typeDigit = (index: number, value: string, target: HTMLInputElement) => {
    const typed = codeDigits(value);
    if (typed.length > 1) { onCode(codeDigits(code.slice(0, index) + typed)); focusBox(target, Math.min(DIGITS - 1, index + typed.length)); return; }
    const next = (code.slice(0, index) + typed + code.slice(index + 1)).slice(0, DIGITS);
    onCode(codeDigits(next));
    if (typed && index < DIGITS - 1) focusBox(target, index + 1);
  };
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !code[index] && index > 0) { event.preventDefault(); onCode(code.slice(0, index - 1)); focusBox(event.currentTarget, index - 1); }
    else if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); focusBox(event.currentTarget, index - 1); }
    else if (event.key === "ArrowRight" && index < DIGITS - 1) { event.preventDefault(); focusBox(event.currentTarget, index + 1); }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = codeDigits(event.clipboardData.getData("text"));
    if (!pasted) return;
    event.preventDefault();
    onCode(pasted);
    focusBox(event.currentTarget, Math.min(DIGITS - 1, pasted.length));
  };
  return <div role="group" aria-labelledby={labelId} className="grid grid-cols-8 gap-1.5" dir="ltr">
        {Array.from({ length: DIGITS }, (_, index) => <input key={index} data-autofocus={index === Math.min(code.length, DIGITS - 1) || undefined}
          value={code[index] ?? ""} inputMode="numeric" pattern="[0-9]*" maxLength={DIGITS}
          autoComplete={index === 0 ? "one-time-code" : "off"} aria-label={t("cloudBuy.signIn.digit", { n: index + 1 })} disabled={busy}
          aria-invalid={wrong || undefined} aria-describedby={problemId}
          onChange={event => typeDigit(index, event.target.value, event.currentTarget)} onKeyDown={onKeyDown(index)} onPaste={onPaste}
          onFocus={event => event.currentTarget.select()}
          className={cn(FIELD, "h-11 min-w-0 px-0 text-center text-[20px] font-medium tabular-nums")} />)}
      </div>;
}
