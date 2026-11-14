export interface AppEvent { name: string; at: number; props: Record<string, string | number | boolean> }
/** What the desktop renderer hands main: its install id, its session and up to a few hundred usage events. */
export interface ProductEventsBatch { install: string; session?: string; events: AppEvent[] }
/** This computer's page and My Cloud's home page only; main adds the account token and posts. */
export interface ProductEventsBridge {
  send(batch: ProductEventsBatch): Promise<boolean>;
  clear(): Promise<void>;
  /** the final batch as usage analytics goes off: posted once, nothing after */
  last(batch: ProductEventsBatch): Promise<boolean>;
}
export declare const APP_EVENT_PROPS: Readonly<Record<string, readonly string[]>>;
export declare const MAX_QUEUE: number;
export declare const BATCH: number;
export declare const FLUSH_MS: number;
export declare const MAX_BACKOFF_MS: number;
export declare function cleanAppEvent(input: unknown, at?: number): AppEvent | null;
export interface ProductEvents {
  send(input: unknown): boolean;
  /** An app_action of main's own, sent with the page's install and session once the page sent a batch. */
  action(name: string, props?: Record<string, string | number | boolean>): boolean;
  clear(): void;
  last(input: unknown): Promise<boolean>;
  flush(): Promise<boolean | undefined>;
  size(): number;
  close(): Promise<void>;
}
export declare function createProductEvents(options: {
  origin: string; token?: () => string | null; platform: string; version: string; fetch?: typeof fetch; now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (timer: unknown) => void; random?: () => number;
}): ProductEvents;
