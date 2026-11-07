import { cn } from "@/lib/cn";

/** A picture's place while it loads: a still tile the size the picture will be, which it then fades into. */
export function ImageLoading({ name, className }: { name: string; className: string }) {
  return (
    <span className={cn("block", className)} role="status">
      <span className="sr-only">Loading {name}</span>
    </span>
  );
}
