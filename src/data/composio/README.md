# Composio toolkit catalog

- **toolkits.json**: 1718 toolkits (slug, name, description, category, sign-in kinds, action and trigger counts; a logo only where it is not `logos.composio.dev/api/<slug>`).
- **actions/*.json**: the first 30 action and trigger names of each toolkit, in 16 files a detail page loads one at a time.

Source: [Composio's docs data](https://github.com/ComposioHQ/composio/blob/93fc6654c5dd5972826a9d5be2274e276dcdb0dc/docs/public/data/toolkits.json) (MIT), SHA-256 `12af3ef45f0aee48a5dc2bc06becbd9507de3bf2681dcde06b30d3e4eebca147`, fetched 2026-11-06. Regenerate with `node scripts/composio-catalog-snapshot.mjs`.
Connect apps shows this list when the live catalog is unavailable and merges it under the live one when it is.
