// A widget's pick-one: the Buttons drawn as grok's lettered rows, whose one press answers the card. Imports only types
// from widget.ts, which builds on this.
import type { WidgetNode, WidgetRoot } from "./widget.ts";

/** `open_phone_pairing` opens the app's own phone pairing (the QR code and link) on the device. */
export const PHONE_PAIRING_ACTION = "open_phone_pairing";
export const WIDGET_FIELD_NODES: ReadonlySet<string> = new Set(["Select", "DatePicker", "TimePicker", "DayPicker", "Checkbox", "RadioGroup", "Input", "Textarea"]);

/** Handled on the device and never sent: a link, a thread, the phone pairing. */
export const isClientWidgetAction = (action: { type?: unknown }): boolean =>
  action.type === "open_url" || action.type === "open_thread" || action.type === PHONE_PAIRING_ACTION;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const childrenOf = (node: WidgetNode): WidgetNode[] => (Array.isArray(node.children) ? node.children : []).filter(isRecord) as WidgetNode[];

function each(node: WidgetNode, visit: (node: WidgetNode) => void): void {
  visit(node);
  for (const child of childrenOf(node)) each(child, visit);
}

const isChoiceButton = (node: WidgetNode): boolean =>
  node.type === "Button" && node.disabled !== true && node.submit !== true && node.style !== "danger" && !node.iconStart && !node.iconEnd
  && typeof node.label === "string" && Boolean(node.label.trim()) && isRecord(node.onClickAction) && !isClientWidgetAction(node.onClickAction);

/**
 * Two or more Buttons in a column (or a row of nothing else), each sending its own label, on a card with no fields,
 * form, status or progress. Each run is its Buttons' ids.
 */
export function widgetChoiceRuns(root: WidgetRoot): string[][] {
  if (root.type !== "Card" || isRecord(root.status)) return [];
  let plain = true;
  each(root, (node) => {
    if (node.type === "Progress" || node.type === "Form" || WIDGET_FIELD_NODES.has(node.type)) plain = false;
  });
  if (!plain) return [];
  const runs: string[][] = [];
  each(root, (node) => {
    const children = childrenOf(node);
    const across = node.type === "Row" || (node.type === "Box" && node.direction === "row");
    if (across ? !children.every(isChoiceButton) : node !== root && node.type !== "Col" && node.type !== "Box") return;
    let run: string[] = [];
    const close = () => {
      if (run.length >= 2) runs.push(run);
      run = [];
    };
    for (const child of children) {
      if (isChoiceButton(child)) run.push(child.id);
      else close();
    }
    close();
  });
  return runs;
}
