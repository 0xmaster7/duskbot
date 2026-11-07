# Team package export and import

The package format and import/export helpers remain available. The former
whole-team share dialog and its HTTP/browser round-trip fixtures were removed
with the Advanced UI, so they are not current acceptance checks.
See [the package guide](../team-sharing.md) for the format.

## Format, export and import units

```sh
pnpm exec vitest run shared/package-format.test.ts server/package-export.test.ts server/package-import.test.ts server/bot-package.test.ts
```

- `shared/package-format.test.ts` parses every file in
  `shared/package-fixtures/` to the sha256, keys, summary, secret findings and
  v1 downgrade recorded in `manifest.json` (Admin reads the same files), and
  covers the 4 MiB boundary, stripped authority fields, the publisher rule,
  each refusal sentence, redaction and the canonical form.
- `server/package-export.test.ts` covers team scoping, starter-note caps,
  redaction, picture and connection skips, key stability across renames,
  what "all" leaves out (30 per bot with switched-on skills first, 60 per
  team, conflicting names), exact choices refused with `TeamExportError`,
  the dialog's starting ticks always being a choice that fits (and still
  fitting with any one box unticked), and connection addresses: one table of
  keys that must not travel (sign-in part, fragment, query and matrix values,
  a key in a subdomain, short hex keys, 24 letters or digits in a row, a key
  after `: @ ! $ ' ( ) * ,` inside a segment, a key as a query or matrix
  name, a percent-escaped key) and one of plain addresses that must stay
  byte for byte (`github-mcp-server-2024`, `acme-corp-2025-sales`,
  `path%20with%20spaces`, localhost).
- `server/package-import.test.ts` imports into a real store, routine manager,
  skill store and memory in a throwaway home: every part, repeat imports,
  MCP policy refusal, full rollback when the last step fails, the library
  refusal, run-limit adjustment, and the organization path (skills on,
  provenance stamps, "already added", refused mismatches).

## Renderer state helpers

```sh
pnpm exec vitest run src/lib/team-share.test.ts src/lib/team-import.test.ts
```

These pure-function tests cover export-body construction, skill choices and
counts, pictures, starter notes, refused previews and import state. They do not
render a share dialog, save a native file, or prove an HTTP round trip. A new
isolated integration fixture is required before claiming those flows work.
