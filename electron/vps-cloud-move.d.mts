type Store = { read(): unknown; write(value: unknown): void };
type Place = { id: string; origin: string; name: string; kind?: string };

export type VpsCloudMoveView =
  | { stage: "none"; cloud: "signed-out" | "none" | "starting" | "ready" }
  | { stage: "buying" | "waiting"; place: string; route: "direct" | "via-mac"; why?: string }
  | { stage: "moving"; place: string; route: "direct" | "via-mac"; why?: string; phase: string; chats?: { done: number; total: number }; waitingFor?: string; retrying?: boolean; error?: string | null }
  | { stage: "fallback"; place: string; route: "via-mac"; why?: string; phase?: string }
  | { stage: "failed"; place: string; route: "direct" | "via-mac"; why?: string; phase?: string; error: string | null }
  | { stage: "done"; place: string; route: "direct" | "via-mac"; why?: string; counts?: Record<string, unknown>; stays?: string };

export const MOVE_LABEL: string;
export const FALLBACK_AFTER: number;
export function staysLine(name: string): string;
export function parseVpsChoice(value: unknown): (Place & { v: 1; environmentId: string; at: number; route: "direct" | "via-mac"; why?: string }) | null;
export function vpsHandoff(name: string): (what: { kind: string }) => Promise<unknown>;

export function installVpsCloudMove(deps: {
  fetch: typeof fetch;
  environments(): any[];
  cloud(): any;
  home(): { origin: string; grant(): Promise<{ origin: string; code: string }> } | null;
  cloudRead(route: string): Promise<Response>;
  cloudFetch?: typeof fetch;
  journal: Store;
  choice: Store;
  sendState: Store;
  viaMac?: { available(place: { origin: string }): boolean; start(place: any): Promise<unknown>; view(): any } | null;
  buy?: ((plan?: string) => Promise<unknown>) | null;
  openHome?(): void;
  lastInput?(): number;
  track?(name: string, props: Record<string, string | number | boolean>): void;
  version?: string;
  onChange?(): void;
  now?(): number;
  timers?: unknown;
  log?(line: string): void;
}): {
  kick(): Promise<void>;
  view(): VpsCloudMoveView & Record<string, any>;
  chosen(): ReturnType<typeof parseVpsChoice>;
  journal(): unknown;
  homeJournal(): unknown;
  away(): boolean;
  busy(): boolean;
  start(id: string, options?: { buying?: boolean; plan?: string }): Promise<VpsCloudMoveView>;
  retry(): Promise<VpsCloudMoveView>;
  cancel(): VpsCloudMoveView;
  close(): void;
};
