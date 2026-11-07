# Product analytics

This fork does not load a product analytics SDK or send product usage events to
upstream. The daily usage snapshot and its background inventory requests are
removed. Existing telemetry call sites resolve locally without recording or
sending events.

The local `omb-email-gate` browser-storage value remains for compatibility with
an existing install's onboarding state. It is not sent anywhere.

Bot usage, cost accounting, server logs and diagnostics remain available in the
app and on the server.
