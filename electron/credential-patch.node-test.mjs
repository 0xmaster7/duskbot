import assert from "node:assert/strict";
import { test } from "node:test";
import { CREDENTIAL_PATCH, credentialSaveError } from "./credential-patch.mjs";

test("a key the provider refused crosses IPC named KeyRejected, with the server's words", () => {
  const error = credentialSaveError(400, { error: "desktop.example.test rejected that key", code: "key_rejected" });
  assert.equal(error.toString(), "KeyRejected: desktop.example.test rejected that key");
  assert.equal(`Error invoking remote method 'credential:set': ${error}`, "Error invoking remote method 'credential:set': KeyRejected: desktop.example.test rejected that key");
});

test("every other refusal stays a plain Error", () => {
  for (const [status, body] of [[400, { error: "Couldn't reach desktop.example.test" }], [409, { error: "busy", code: "conflict" }], [503, null], [403, { code: "KeyRejected" }]]) {
    const error = credentialSaveError(status, body);
    assert.ok(error.toString().startsWith("Error: "), error.toString());
    assert.ok(!error.toString().startsWith("KeyRejected: "));
  }
  assert.equal(credentialSaveError(503, null).message, "Could not save credential (HTTP 503)");
});

test("the desktop cannot save a paid-desktop provider key", () => {
  assert.equal(Object.hasOwn(CREDENTIAL_PATCH, "boxToken"), false);
});
