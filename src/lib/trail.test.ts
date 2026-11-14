import { describe, expect, it } from "vitest";
import { settingsChange } from "./trail";
import { safeSettingValue, trailForAction } from "./trail-actions";

describe("renderer trail", () => {
  it("keeps a setting's key, and its value only when it is a switch, a number or a short choice", () => {
    expect(settingsChange(JSON.stringify({ theme: "dark", fontSize: 14, sounds: false, displayName: "Sidd", apiKey: "sk-123", note: "my private note" })))
      .toEqual({ key: "theme,fontSize,sounds,displayName,apiKey,note", values: { theme: "dark", fontSize: 14, sounds: false } });
    expect(settingsChange("not json")).toBeNull();
    expect(safeSettingValue("Hello there")).toBeUndefined();
  });

  it("a send records its length, never its words", () => {
    const event = trailForAction({ type: "send", botId: "b1", threadId: "t1", text: "my bank password is hunter2" });
    expect(event?.ev).toBe("chat.send");
    expect(JSON.stringify(event)).not.toContain("hunter2");
    expect(event?.fields.len).toBe(27);
  });

  it("a bot update keeps no words a person wrote", () => {
    const event = trailForAction({ type: "updateBot", botId: "b1", patch: { name: "ana", instructions: "be kind", autoApprove: true } });
    expect(event?.fields).toMatchObject({ key: "name,instructions,autoApprove", values: { autoApprove: true } });
    expect(JSON.stringify(event)).not.toMatch(/ana"|be kind/);
  });
});
