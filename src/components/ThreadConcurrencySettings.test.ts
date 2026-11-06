import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThreadConcurrencySettings } from "./ThreadConcurrencySettings";

const fixture = vi.hoisted(() => ({ limit: undefined as number | undefined, cloudStarter: undefined as true | undefined }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { config: { threads: fixture.limit === undefined ? undefined : { maxConcurrentPerBot: fixture.limit }, cloudStarter: fixture.cloudStarter } }, dispatch: vi.fn() }),
}));

describe("ThreadConcurrencySettings", () => {
  it("shows three until the first answer arrives, and offers one through sixteen", () => {
    fixture.limit = undefined;
    const markup = renderToStaticMarkup(createElement(ThreadConcurrencySettings));
    expect(markup).toMatch(/role="combobox"[^>]*>.*>3<\/span>/);
    expect(markup).toContain("Tasks at once per bot");
  });
  it("shows Starter's one thread per bot as a plan limit it cannot raise", () => {
    fixture.limit = 1; fixture.cloudStarter = true;
    const markup = renderToStaticMarkup(createElement(ThreadConcurrencySettings));
    fixture.cloudStarter = undefined;
    expect(markup).toMatch(/>1<\/span>/);
    expect(markup).toContain("disabled");
    expect(markup).toContain("Starter runs one thread at a time per bot");
  });
  it("shows the confirmed server value", () => {
    fixture.limit = 10;
    expect(renderToStaticMarkup(createElement(ThreadConcurrencySettings))).toMatch(/>10<\/span>/);
  });
});
