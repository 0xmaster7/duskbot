export interface UpdateNotice { check(): Promise<string | null>; start(): void; stop(): void }
export declare function createUpdateNotice(options: {
  request(route: string, init?: RequestInit): Promise<Response>;
  notify(note: { title: string; body: string; click(): void }): void;
  open(url: string): void;
  memory: { read(): { told?: string } | null; write(value: { told: string }): void };
  log?: (line: string) => void;
  firstDelayMs?: number;
  intervalMs?: number;
  timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}): UpdateNotice;
