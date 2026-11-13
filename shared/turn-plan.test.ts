import { expect, it } from "vitest";
import { readPlan } from "./turn-plan.ts";

it("reads TodoWrite's todos and update_plan's plan, leaving cancelled steps out", () => {
  expect(readPlan("TodoWrite", JSON.stringify({ todos: [{ content: "Find  flights", status: "completed" }, { content: "Book", status: "cancelled" }, { content: "Pay", status: "in_progress" }] })))
    .toEqual({ steps: [{ text: "Find flights", state: "done" }, { text: "Pay", state: "now" }], done: 1, total: 2 });
  expect(readPlan("update_plan", JSON.stringify({ plan: [{ step: "Read the repo", status: "pending" }] })))
    .toEqual({ steps: [{ text: "Read the repo", state: "todo" }], done: 0, total: 1 });
});

it("reads no plan from another tool or an input that does not parse", () => {
  expect(readPlan("Bash", JSON.stringify({ todos: [{ content: "x", status: "pending" }] }))).toBeNull();
  expect(readPlan("TodoWrite", "{\"todos\": [")).toBeNull();
  expect(readPlan("TodoWrite", JSON.stringify({ todos: [] }))).toBeNull();
});
