import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhooksSettingsRow } from "./WebhooksSettingsRow";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), webhooks: [] as unknown[] }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { webhooks: fixture.webhooks }, dispatch: fixture.dispatch }) }));

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const nodes = (value: ReactNode): Node[] => Children.toArray(value).flatMap((child) => (isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []));

function render() {
  let tree: ReactNode = null;
  function Capture() { tree = WebhooksSettingsRow(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, row: nodes(tree).find((node) => node.props["data-settings-open"] === "webhooks") };
}

beforeEach(() => { fixture.dispatch.mockReset(); fixture.webhooks = []; });

describe("the Webhooks row in Advanced features", () => {
  it("names webhooks in plain words and opens Automations, where they are managed", () => {
    const view = render();
    expect(view.html).toContain("Webhooks");
    expect(view.html).toContain("Set them up in Automations");
    (view.row!.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showRoutines", view: "list" });
  });

  it("shows how many there are once there is one", () => {
    fixture.webhooks = [{ id: "w1" }, { id: "w2" }];
    expect(render().row!.props.value).toBe("2");
  });
});
