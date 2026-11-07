export function vpsContainerStartedAt(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19) ? value : undefined;
}

export function compareVpsContainerStarts(left: string, right: string): number {
  const normalized = (value: string) => {
    if (!vpsContainerStartedAt(value)) throw new Error("Invalid VPS container start time");
    const fraction = value.slice(19, -1).replace(/^\./, "");
    return `${value.slice(0, 19)}.${fraction.padEnd(9, "0")}Z`;
  };
  const before = normalized(left), after = normalized(right);
  return before < after ? -1 : before > after ? 1 : 0;
}
