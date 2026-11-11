// The managed cloud's providers are never named in what the app ships (src, electron, shared, server, apps/mobile), in the
// README or in the language packs. Its adapter, lifecycle and docs live in apps/cloud-service, which runs only in the
// account service; this file and that package are the places that name it.
export const PROVIDER_WORDS = ["InstaBox"] as const;
export const PROVIDER_WORD = PROVIDER_WORDS[0];
export const PROVIDER_NAME = new RegExp(PROVIDER_WORDS.join("|"), "i");
export const SHIPPED_PATHS = ["src", "electron", "shared", "server", "apps/mobile", "README.md"] as const;
