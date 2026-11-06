import { afterEach, describe, expect, it, vi } from "vitest";

import { onOpenTemplates, openTemplates } from "./SidebarTemplates";

describe("openTemplates", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reaches the sidebar's Templates host while one is mounted, and says so when none is", () => {
    vi.stubGlobal("window", new EventTarget());
    expect(openTemplates()).toBe(false);
    const open = vi.fn();
    const stop = onOpenTemplates(open);
    expect(openTemplates()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    stop();
    expect(openTemplates()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
