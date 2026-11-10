import type { ErrorReporter } from "./error-report.mjs";
export declare function desktopErrorDsn(env: Record<string, string | undefined>, appPath: string, files?: Pick<typeof import("node:fs"), "readFileSync">): string | null;
export declare function startDesktopErrorReporting(options: {
  app: Pick<Electron.App, "getAppPath" | "getPath" | "getVersion" | "isPackaged" | "on">;
  prefs: { errorReports(): boolean };
  env?: Record<string, string | undefined>;
  files?: Pick<typeof import("node:fs"), "readFileSync">;
}): ErrorReporter;
