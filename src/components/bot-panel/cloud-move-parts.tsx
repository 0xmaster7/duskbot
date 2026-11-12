import { Check, Loader2 } from "../../icons";

export function Perk({ children }: { children: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Check size={15} className="mt-[1px] shrink-0 text-ink/[0.68]" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export function Progress({ line }: { line: string }) {
  return (
    <p role="status" className="my-2 flex items-start gap-2.5 text-[13px] leading-[18px] text-ink">
      <Loader2 size={15} className="mt-[1px] shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>{line}</span>
    </p>
  );
}
