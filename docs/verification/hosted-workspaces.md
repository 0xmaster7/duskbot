# Hosted workspace access refusals

A server configured with any of `OMB_ADMIN_URL`, `OMB_ADMIN_WORKSPACE` or
`OMB_ADMIN_MEMBERSHIP` keeps its hosted sign-in authority. Remote navigation,
hosted sign-in endpoints and existing sessions fail closed with 503. Email
sign-in and pairing requests remain forbidden. `/api/health/hosted` always
returns 503.

Hosted bots still default to Ask. Session-less loopback callers default to
service trust, with access only to the guarded service routes. An explicit
operator override can retain local owner access without opening remote access.

Run the isolated fixtures:

```sh
pnpm exec vitest run server/hosted-workspace.test.ts server/hosted-access.test.ts server/request-auth.test.ts server/full-access-workflows.e2e.test.ts
```

The hosted-access fixture launches real server processes with a disposable
home, static page, sessions and fake engine. It checks refusals for complete,
partial and invalid hosted configurations, local owner access, default Ask
behavior and session-less local service trust. It contacts no real portal or
provider and does not mutate the user's app.
