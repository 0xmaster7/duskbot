import { widgetString, type WidgetNode } from "../../../shared/widget";
import { AskChoices } from "../AskCard";
import { kids } from "./widget-style";
import { useWidgetForm, type WidgetForm } from "./WidgetControls";

/** A node to draw, or a pick-one's run of Buttons drawn together as one list. */
export type WidgetPiece = { node: WidgetNode; run?: undefined } | { node: WidgetNode; run: WidgetNode[] };

/** Folds each pick-one's Buttons into one piece, keyed by its first Button. */
export function widgetPieces(nodes: readonly WidgetNode[], form: WidgetForm): WidgetPiece[] {
  const pieces: WidgetPiece[] = [];
  for (const node of nodes) {
    const run = form.choices.get(node.id);
    if (!run) pieces.push({ node });
    else if (run[0] === node.id) pieces.push({ node, run: nodes.filter((sibling) => run.includes(sibling.id)) });
  }
  return pieces;
}

/** A pick-one's Button, or a column or row holding nothing else: drawn as the lettered list. */
export function isChoiceList(node: WidgetNode, form: WidgetForm): boolean {
  if (form.choices.has(node.id)) return true;
  const children = kids(node);
  return children.length > 0 && children.every((child) => form.choices.has(child.id));
}

/** Grok's question widget: one lettered row per option, a tap sends it and answers the card. */
export function WidgetChoices({ run }: { run: readonly WidgetNode[] }) {
  const form = useWidgetForm();
  const refs = new Map(run.map((node) => [form.actions.get(node.id)?.label ?? widgetString(node, "label") ?? "", node.id]));
  const labels = [...refs.keys()];
  const pending = run.find((node) => node.id === form.pendingRef);
  return (
    <AskChoices
      choices={labels.map((label) => ({ label }))}
      label={form.name || labels.join(", ")}
      sending={pending ? labels[run.indexOf(pending)] ?? null : null}
      disabled={form.locked && !pending}
      onPick={(label) => {
        const ref = refs.get(label);
        if (ref) form.press(ref);
      }}
    />
  );
}
