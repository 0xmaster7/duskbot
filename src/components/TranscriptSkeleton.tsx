// a still outline of a conversation's last rows: it holds the bottom of the chat while the newest page is on its way,
// then the rows take its place where it stood
const ROWS: ReadonlyArray<{ side: "start" | "end"; widths: string[] }> = [
  { side: "end", widths: ["w-40"] },
  { side: "start", widths: ["w-[min(30rem,80%)]", "w-[min(24rem,66%)]", "w-[min(18rem,50%)]"] },
  { side: "end", widths: ["w-56"] },
  { side: "start", widths: ["w-[min(28rem,76%)]", "w-[min(20rem,56%)]"] },
];

export function TranscriptSkeleton() {
  return (
    <div data-transcript-skeleton="" aria-hidden="true" className="flex min-h-[60vh] flex-col justify-end gap-4">
      {ROWS.map((row, index) => (
        <div key={index} className={row.side === "end" ? "flex justify-end" : "flex flex-col items-start gap-2"}>
          {row.widths.map((width, line) => (
            <span key={line} className={`${width} block ${row.side === "end" ? "h-9 rounded-[18px]" : "h-3.5 rounded-full"} bg-ink/[0.05]`} />
          ))}
        </div>
      ))}
    </div>
  );
}
