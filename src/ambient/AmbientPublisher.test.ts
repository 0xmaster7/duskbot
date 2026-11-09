import { describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Message } from "@/state/store";
import { runAmbientAct } from "./AmbientPublisher";

const question = (fields: Record<string, unknown> = {}) => ({ id: "m1", at: 1, role: "bot", kind: "options", card: { title: "Which branch?", subtitle: "", options: ["main", "dev"], requestId: "q1", requestType: "question", ...fields } }) as unknown as Message;
const bot = (fields: Partial<Bot> = {}) => ({ id: "nova", name: "Nova", color: "blue", threadId: "t1", messages: [], busy: false, ...fields }) as unknown as Bot;
const run = (act: Parameters<typeof runAmbientAct>[0], bots: Bot[]) => {
  const dispatch = vi.fn();
  runAmbientAct(act, { bots } as AppState, dispatch);
  return dispatch.mock.calls.map(([action]) => action);
};

describe("what the island asks the page to do", () => {
  it("answers an open question with one of its own choices, or typed only where the question takes that", () => {
    const asking = bot({ messages: [question({ fixedOptions: true })] });
    expect(run({ kind: "answer", botId: "nova", threadId: "t1", requestId: "q1", text: "dev" }, [asking]))
      .toEqual([{ type: "decideRequest", threadId: "t1", requestId: "q1", behavior: "answer", message: "dev" }]);
    expect(run({ kind: "answer", botId: "nova", threadId: "t1", requestId: "q1", text: "rm -rf" }, [asking])).toEqual([]);
    expect(run({ kind: "answer", botId: "nova", threadId: "t1", requestId: "q1", text: "staging, please" }, [bot({ messages: [question()] })]))
      .toEqual([{ type: "decideRequest", threadId: "t1", requestId: "q1", behavior: "answer", message: "staging, please" }]);
    expect(run({ kind: "answer", botId: "nova", threadId: "t1", requestId: "old", text: "dev" }, [asking])).toEqual([]);
    expect(run({ kind: "answer", botId: "nova", threadId: "t1", requestId: "q1", text: "dev" }, [bot({ messages: [question({ answered: "answer" })] })])).toEqual([]);
  });

  it("answers a structured question in its own question-and-answer form", () => {
    const structured = bot({ messages: [question({ questionRequest: { version: 1, questions: [{ question: "Ship it now?", options: [{ label: "Yes" }, { label: "Later" }] }] } })] });
    const [action] = run({ kind: "answer", botId: "nova", threadId: "t1", requestId: "q1", text: "Later" }, [structured]);
    expect(action).toMatchObject({ type: "decideRequest", behavior: "answer" });
    expect(action.message).toContain("Ship it now?");
    expect(action.message).toContain("Later");
  });

  it("stops a working bot's running chat, and leaves a resting one alone", () => {
    const working = bot({ busy: true, tasks: [{ threadId: "t1", busy: false }, { threadId: "t2", busy: true }] } as Partial<Bot>);
    expect(run({ kind: "stop", botId: "nova", threadId: "t1" }, [working])).toEqual([{ type: "interrupt", botId: "nova", threadId: "t2" }]);
    expect(run({ kind: "stop", botId: "nova", threadId: "t1" }, [bot()])).toEqual([]);
  });
});
