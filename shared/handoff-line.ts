/** A hand-off between two bots as the chat shows it: who handed what to whom ("Nova → Quill: draft the post"), or who
 * reported back (`phase: "result"`). */
export interface HandoffLine {
  phase: "sent" | "result";
  from: { botId: string; name: string; color: string };
  to: { botId: string; name: string; color: string };
  /** The brief, one line, for a sent row; a result row's words are its tool output. */
  text?: string;
}
