// The phone app's "report this reply" (App Store guideline 1.2): it installs where a report goes; elsewhere there is none.

export interface AiReport { botName?: string; messageId: string; text: string }
type ReportHandler = (report: AiReport) => void;

let handler: ReportHandler | null = null;

export function installAiReport(next: ReportHandler): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export function aiReportHandler(): ReportHandler | null {
  return handler;
}
