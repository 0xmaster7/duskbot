import { afterEach, describe, expect, it } from "vitest";
import { isTechnicalError, plainErrorLine } from "./plain-error";
import { setLocale } from "./i18n";
import { registrySaveFailure } from "../../shared/registry-save-failure";
import { requestTooLargeMessage } from "../../shared/request-too-large";

describe("plainErrorLine", () => {
  it.each([
    ["Failed to fetch", "couldn't reach Dusk. check that it's running, then try again."],
    ["NetworkError when attempting to fetch resource.", "couldn't reach Dusk. check that it's running, then try again."],
    ["The operation was aborted due to timeout", "that took too long. try again."],
    ["502 Bad Gateway", "something went wrong on the other end. try again."],
    ["500 Internal Server Error", "something went wrong on the other end. try again."],
    ["404 Not Found", "that couldn't be found. it may have been removed."],
    ["413 Payload Too Large", "that's too large to send. try a smaller file or a shorter message."],
    ["429 Too Many Requests", "too many requests right now. wait a moment, then try again."],
    ['API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', "the service is busy right now. try again in a moment."],
    ["API Error: 529 Overloaded. This is a server-side issue, usually temporary.", "Overloaded. This is a server-side issue, usually temporary."],
    ["API Error: 400 Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required.", "Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required."],
    ["OpenRouter HTTP 404: model qwen-9 not found", "model qwen-9 not found"],
    ["HTTP 503", "the service is busy right now. try again in a moment."],
    ["HTTP 502 Bad Gateway", "something went wrong on the other end. try again."],
    ["upstream HTTP 503 Service Unavailable", "the service is busy right now. try again in a moment."],
    ["EACCES: permission denied, open '/Users/sam/notes.md'", "this computer didn't allow that. check the file or folder permissions, then try again."],
    ["upstream HTTP 401: {\"error\":{\"message\":\"invalid x-api-key\"}}", "access was refused. check the sign-in, then try again."],
    ["read ECONNRESET", "the connection dropped. try again."],
    ["TypeError: Cannot read properties of undefined (reading 'id')", "something went wrong. try again."],
    ["Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON", "something went wrong. try again."],
    ["claude exited 3 before result: fake-claude: simulated crash before result", "something went wrong. try again."],
    ["claude exited null before result", "something went wrong. try again."],
    ["codex exited null (signal SIGKILL) before turn/completed", "something went wrong. try again."],
    ["DeepSeek Harness exited 3 before the prompt result: panicked at src/main.rs", "something went wrong. try again."],
    ["Antigravity ACP exited SIGTERM.", "something went wrong. try again."],
    ["rate_limited", "too many requests right now. wait a moment, then try again."],
    ["Error\n    at fetchBots (store.tsx:12:3)", "something went wrong. try again."],
  ])("reads %j as a plain line", (raw, line) => {
    expect(plainErrorLine(raw)).toBe(line);
  });

  it.each([
    "Clipboard has no image",
    "Add your key in Settings → API keys",
    "Not logged in · Please run /login",
    "rate limited",
    "Your Pro plan includes 2 cloud computers at once. Delete one to start another.",
    "ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded)",
    "no activity for 10 minutes — the turn was stopped",
    "Muse Code stopped unexpectedly. Send the message again to continue.",
    "The server returned HTTP 503. Wait for the scheduled maintenance to finish, then try again.",
    "Couldn't undo that change.",
    registrySaveFailure("the thread switch", "bots.json", "EPERM"),
    registrySaveFailure("the thread deletion", "groups.json", "ENOSPC"),
    "",
  ])("keeps a sentence a person can read: %j", (raw) => {
    expect(isTechnicalError(raw)).toBe(false);
    expect(plainErrorLine(raw)).toBeUndefined();
  });
});

describe("a provider refusing a message as too large", () => {
  afterEach(() => setLocale("en"));

  it("is said in the reader's language with the model's name", () => {
    const cause = requestTooLargeMessage("GLM 5.3 Flash");
    expect(plainErrorLine(cause)).toBe("this message is too large for GLM 5.3 Flash. start a new chat or pick a model that accepts more.");
    setLocale("de");
    expect(plainErrorLine(cause)).toBe("Diese Nachricht ist zu groß für GLM 5.3 Flash. Starte einen neuen Chat oder wähle ein Modell, das mehr annimmt.");
    setLocale("ja");
    expect(plainErrorLine(`  ${requestTooLargeMessage("vendor/model-1.5")}\n`)).toBe("このメッセージは vendor/model-1.5 には大きすぎます。新しいチャットを始めるか、より多くを受け付けるモデルを選んでください。");
    expect(plainErrorLine("this message is too large for the box.")).toBeUndefined();
  });
});
