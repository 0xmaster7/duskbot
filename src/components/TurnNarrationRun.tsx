// Providers such as Grok narrate before tools.
import { useEffect, useState } from "react";
import { Check, ChevronRight } from "../icons";
import { RUN_TOGGLE } from "./ActivityRun";

export function TurnNarrationRun({
  label,
  title,
  forceOpen = false,
  children,
}: {
  label: string;
  title?: string;
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={title ?? (open ? "Hide progress messages" : "Show progress messages")}
          data-run-toggle=""
            className={RUN_TOGGLE}
        >
          <Check size={13} aria-hidden="true" className="shrink-0 text-success" />
          <span className="min-w-0 truncate leading-5">{label}</span>
          <ChevronRight size={13} aria-hidden="true" className={open ? "shrink-0 rotate-90" : "shrink-0"} />
        </button>
      </div>
      {open && children}
    </div>
  );
}
