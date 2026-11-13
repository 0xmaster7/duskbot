import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalCard } from "./ApprovalCard";
import { pendingApprovals, PendingApprovalPanel, spokenApprovalPrompt } from "./PendingApproval";
import type { Message } from "@/state/store";

const raw = '{"parent":{"page_id":"abc"},"pages":[{"properties":{"title":"Launch checklist"}}]}';
const notionCard = (answered?: string): Message => ({
  id: "notion-card",
  role: "bot",
  kind: "options",
  at: 1,
  card: {
    title: "Approval needed",
    subtitle: raw,
    options: ["Allow", "Deny"],
    requestId: "r1",
    tool: "mcp__notion__notion-create-pages",
    appAction: { app: "Notion", domain: "notion.so", action: "Create a page", target: "Launch checklist" },
    ...(answered ? { answered } : {}),
  },
});

describe("a connected app's approval", () => {
  it("leads with the app's logo and a plain sentence, the raw input folded behind Details", () => {
    const [pending] = pendingApprovals([notionCard()]);
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0, botName: "Nova" }));
    expect(html).toContain("Create a page in Notion: Launch checklist");
    expect(html).not.toContain("notion-create-pages");
    expect(html).toContain("<img");
    // the raw input waits behind the Details toggle
    expect(html).not.toContain("page_id");
    expect(html).toContain('aria-expanded="false"');
  });

  it("reads the same on the settled row and on a call", () => {
    const settled = renderToStaticMarkup(createElement(ApprovalCard, { message: notionCard("allow"), bot: { name: "Nova" } }));
    expect(settled).toContain("Create a page in Notion: Launch checklist");
    expect(settled).not.toContain("wants to notion");
    const [pending] = pendingApprovals([notionCard()]);
    expect(spokenApprovalPrompt(pending!, "Nova")).toBe("Nova wants to create a page in Notion: Launch checklist. Should I allow it?");
  });
});
