/** A step of the plan a bot keeps with its engine's own plan tool (Claude's TodoWrite, Codex's update_plan, Gemini's
 * write_todos). */
export type PlanStepState = "done" | "now" | "todo";
export interface PlanStep { text: string; state: PlanStepState }
export interface TurnPlan { steps: PlanStep[]; done: number; total: number }

const PLAN_TOOL = /\b(?:todowrite|todo_write|write_todos|update_plan|updateplan)\b/i;
const STATE: Record<string, PlanStepState> = { completed: "done", in_progress: "now", pending: "todo" };

/** The plan in a plan tool call's input, or null when the call is no plan tool or its input shows no steps. A cancelled
 * step leaves the plan. */
export function readPlan(toolName: string | undefined, input: string | undefined): TurnPlan | null {
  if (!input || !PLAN_TOOL.test(toolName ?? "")) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { return null; }
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const list = Array.isArray(record.todos) ? record.todos : Array.isArray(record.plan) ? record.plan : null;
  if (!list) return null;
  const steps: PlanStep[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const step = item as Record<string, unknown>;
    const state = typeof step.status === "string" ? STATE[step.status] : undefined;
    const raw = typeof step.content === "string" ? step.content : typeof step.step === "string" ? step.step : "";
    const text = raw.replace(/\s+/g, " ").trim();
    if (state && text) steps.push({ text, state });
  }
  if (!steps.length) return null;
  return { steps, done: steps.filter((step) => step.state === "done").length, total: steps.length };
}

/** The fields of a chat row the checklist reads. */
export interface PlanRow { id: string; role: string; kind?: string; steered?: boolean; tool?: { name: string; input?: string } }
export interface PlanAnchor { plan: TurnPlan; newest: boolean }

const asks = (row: PlanRow) => row.role === "user" && row.kind === "text" && !row.steered;

/** Each ask's plan as its newest plan call left it, by that call's row id: the chat shows the checklist there.
 * `newest` marks the plan of the newest ask, the one a running turn is still working. A one-step plan is no checklist. */
export function planAnchors(rows: readonly PlanRow[]): Map<string, PlanAnchor> {
  const anchors = new Map<string, PlanAnchor>();
  let current: { id: string; plan: TurnPlan } | null = null;
  for (const row of rows) {
    if (asks(row)) {
      if (current) anchors.set(current.id, { plan: current.plan, newest: false });
      current = null;
      continue;
    }
    if (row.kind !== "activity" || !row.tool) continue;
    const plan = readPlan(row.tool.name, row.tool.input);
    if (plan && plan.total > 1) current = { id: row.id, plan };
  }
  if (current) anchors.set(current.id, { plan: current.plan, newest: true });
  return anchors;
}
