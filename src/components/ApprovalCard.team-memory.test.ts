import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

import type { Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ admin: false as boolean | null }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));

const { ApprovalCard } = await import("./ApprovalCard");

const saved: Message = {
  id: "applied-card", role: "bot", kind: "options", at: 1,
  card: {
    title: "Remember", subtitle: "person: Ada Lovelace — Runs the payroll review.", options: [], answered: "allow", dismissed: true,
    autoApplied: true, requestId: "memory-request", tool: "propose_team_memory",
    teamMemoryRequest: { section: "", entryId: "e", kind: "person", revision: "v1" },
  },
};
const render = () => renderToStaticMarkup(createElement(ApprovalCard, { bot: { name: "Luna" }, message: saved, threadId: "thread-1" }));

beforeEach(() => { fixture.admin = false; });

// applied changes read as one plain line with no inline Undo, for anyone (4a3109d6c)
it("shows a memory notice as a plain saved line without Undo", () => {
  const html = render();
  expect(html).toContain(">Saved to shared memory<");
  expect(html).toContain(">person: Ada Lovelace<");
  expect(html).not.toContain(">Undo<");
});

it("offers no inline Undo to an admin either", () => {
  fixture.admin = true;
  expect(render()).not.toContain(">Undo<");
});
