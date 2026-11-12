import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { initialState } from "@/state/store";

vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), useStore: () => ({ state: initialState, dispatch: vi.fn() }) }));

import { APP_FACES, POPULAR_APPS, SidebarConnectApps, appFaces } from "./SidebarConnectApps";

const card = (slug: string) => ({ slug, label: slug, logo: `https://logos.example/${slug}.png`, domain: null });

describe("the Connect apps faces", () => {
  it("shows popular apps until something is connected", () => {
    expect(appFaces([], new Map()).map((face) => face.slug)).toEqual(POPULAR_APPS.map((app) => app.slug));
  });

  it("shows grok's featured apps not yet connected, in order, and never more than three", () => {
    const cards = new Map([["github", card("github")], ["gmail", card("gmail")]]);
    expect(appFaces(["github", "gmail"], cards).map((face) => face.slug)).toEqual(["googledrive", "googlecalendar", "granola"]);
    expect(appFaces(["googledrive", "granola"], cards).map((face) => face.slug)).toEqual(["googlecalendar", "notion", "slack"]);
    const many = new Map(["a", "b", "c", "d"].map((slug) => [slug, card(slug)]));
    expect(appFaces(["a", "b", "c", "d"], many)).toHaveLength(APP_FACES);
  });

  it("draws grok's 36px hairline pill with a 14px medium label and three 16px tiles on white, 6px over each other", () => {
    const html = renderToStaticMarkup(createElement(SidebarConnectApps));
    // 16px in, 12px out beside the logos, which sit 6px after the label
    expect(html).toMatch(/class="group\/apps flex h-9 min-w-0 flex-1 items-center justify-center rounded-full border border-ink\/\[0\.08\] bg-composer ps-4 text-\[14px\] font-medium leading-5 [^"]*\bpe-3\b/);
    expect(html).toContain('class="ms-1.5 flex shrink-0 items-center"');
    const faces = [...html.matchAll(/data-app-face="[^"]+" class="([^"]*)"/g)].map(([, classes]) => classes!);
    expect(faces).toHaveLength(3);
    for (const face of faces) expect(face).toContain("size-[18px] shrink-0 items-center justify-center rounded-[6px] bg-composer p-px");
    expect(faces[0]).not.toContain("-ms-");
    expect(faces[1]).toContain("-ms-[6px]");
    // at rest they sit straight; only the hovered pill fans them, as grok's does
    for (const face of faces) expect(face.split(" ").filter((name) => name.includes("rotate")).every((name) => name.includes("group-hover/apps:"))).toBe(true);
  });

  it("is a round 36px apps-grid button on the collapsed rail, named for screen readers", () => {
    const html = renderToStaticMarkup(createElement(SidebarConnectApps, { circle: true }));
    expect(html).toMatch(/data-tour="nav-apps"[^>]*aria-label="connect apps" class="[^"]*\brounded-full\b[^"]*\bh-9 min-w-9\b/);
    expect(html).toContain('data-icon-name="grid-plus"');
    expect(html).not.toContain("data-app-face");
  });

  it("keeps a connected app it cannot draw yet out, and the popular ones in", () => {
    expect(appFaces(["linear"], new Map()).map((face) => face.slug)).toEqual(["googledrive", "googlecalendar", "granola"]);
  });
});
