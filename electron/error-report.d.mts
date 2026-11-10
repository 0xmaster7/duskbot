export interface ErrorSpool { append(line: string): void; take(): string[] }
export type ErrorComponent = "desktop" | "server" | "dashboard" | "dashboard-web" | "mobile" | "link" | "cloud";
export interface ErrorReporterOptions {
  dsn: string | null | undefined;
  component: ErrorComponent;
  release: string;
  environment?: string;
  enabled?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
  maxPerMinute?: number;
  spool?: ErrorSpool;
}
export interface ErrorReporter {
  readonly enabled: boolean;
  capture(error: unknown, extra?: { level?: "fatal" | "error" | "warning"; tags?: Record<string, string | number | boolean> }): string | null;
  flush(): number;
}
export interface ErrorFrame { function: string; filename: string; lineno: number; colno: number; in_app: boolean }
export interface ErrorEvent {
  event_id: string; timestamp: number; platform: "javascript"; level: string; release: string; environment: string;
  tags: Record<string, string>;
  exception: { values: Array<{ type: string; value: string; stacktrace: { frames: ErrorFrame[] } }> };
}
export declare function parseDsn(dsn: unknown): { endpoint: string; key: string } | null;
export declare function scrubText(value: unknown): string;
export declare function stackFrames(stack: unknown): ErrorFrame[];
export declare function errorEvent(error: unknown, context: { component: ErrorComponent; release: string; environment: string; now: () => number; level?: string; tags?: Record<string, unknown> }): ErrorEvent;
export declare function createErrorReporter(options: ErrorReporterOptions): ErrorReporter;
export declare function reportProcessErrors(reporter: ErrorReporter, proc?: NodeJS.Process): ErrorReporter;
