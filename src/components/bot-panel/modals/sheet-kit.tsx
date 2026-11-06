import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Card } from "../../ListRows";
import { textAreaCls } from "../../ui/GrokDialog";

/** A few lines to type in, filling a card of its own on a page: the field is the whole card. */
export function FieldCard({ label, children }: { label: string; children: ReactNode }) {
  return <Card label={label}><div className="p-1">{children}</div></Card>;
}

export const sheetAreaCls = cn(textAreaCls, "border-0 bg-transparent px-1.5 py-1 font-mono text-[12px] focus:border-0!");
