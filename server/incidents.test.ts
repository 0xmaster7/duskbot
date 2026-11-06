import { describe, expect, it } from "vitest";

import "./server-line-packs.ts";
import { INCIDENT_HARD_LIMIT, IncidentLedger, incidentChip, type Incident } from "./incidents.ts";

describe("IncidentLedger", () => {
  it("goes quiet on a crash loop, and starts over after an hour", () => {
    let now = 1_000_000;
    const ledger = new IncidentLedger({ now: () => now });
    const seen = Array.from({ length: INCIDENT_HARD_LIMIT + 1 }, () => ledger.note("t1"));
    expect(seen.map((entry) => entry.count)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen.map((entry) => entry.muted)).toEqual([false, false, false, false, false, true]);
    expect(ledger.note("t2")).toEqual({ count: 1, muted: false });
    now += 61 * 60_000;
    expect(ledger.note("t1")).toEqual({ count: 1, muted: false });
  });

  it("remembers when a thread last failed, so a late retry can see the thread moved on", () => {
    let now = 5_000;
    const ledger = new IncidentLedger({ now: () => now });
    expect(ledger.lastAt("t1")).toBeUndefined();
    ledger.note("t1");
    now = 9_000;
    ledger.note("t1");
    ledger.note("t2");
    expect(ledger.lastAt("t1")).toBe(9_000);
  });
});

describe("incident wording", () => {
  const incident: Incident = {
    kind: "failed",
    bot: { id: "ada", name: "Ada" },
    threadId: "t-ada",
    title: "Invoice reconciliation",
    detail: "exit_before_result",
  };

  it("names the bot, the thread and what happened", () => {
    expect(incidentChip(incident)).toBe('Ada hit a problem: its run in its thread #Invoice reconciliation failed: "exit_before_result"');
  });

  it("words a stall, a start failure, a routine and a room each in their own terms", () => {
    expect(incidentChip({ ...incident, kind: "stalled", detail: "" })).toBe("Ada hit a problem: its run in its thread #Invoice reconciliation stopped after showing no activity");
    expect(incidentChip({ ...incident, kind: "could-not-start", title: null })).toContain("Ada hit a problem: its run in its main conversation could not start");
    expect(incidentChip({ ...incident, kind: "routine-failed", title: "Inbox digest" })).toContain("Ada hit a problem: its scheduled routine in its thread #Inbox digest failed");
    expect(incidentChip({ ...incident, room: "Standup" })).toContain('Ada hit a problem: its run in the room "Standup" failed');
  });

  it("tells the person in their language", () => {
    expect(incidentChip(incident, "de")).toBe("Ada hatte ein Problem: Die Ausführung im Thread #Invoice reconciliation ist fehlgeschlagen: „exit_before_result“");
    expect(incidentChip({ ...incident, kind: "stalled", detail: "" }, "de"))
      .toBe("Ada hatte ein Problem: Die Ausführung im Thread #Invoice reconciliation wurde gestoppt, weil sie keine Aktivität mehr zeigte");
    expect(incidentChip({ ...incident, kind: "routine-failed", title: null, room: "Standup" }, "de"))
      .toBe("Ada hatte ein Problem: Die geplante Routine im Raum „Standup“ ist fehlgeschlagen: „exit_before_result“");
    expect(incidentChip({ ...incident, kind: "could-not-start", title: null, detail: "" }, "de")).toBe("Ada hatte ein Problem: Die Ausführung in der Hauptunterhaltung konnte nicht starten");
  });
});
