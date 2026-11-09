// The managed cloud's provider is never named in what the app ships (src, electron, shared, server, apps/mobile), in the
// README or in the language packs. Its adapter, lifecycle and docs live in apps/cloud-service, which runs only in the
// account service; this file and that package are the places that name it.
export const PROVIDER_WORD = "Boat";
export const PROVIDER_NAME = new RegExp(PROVIDER_WORD, "i");
export const SHIPPED_PATHS = ["src", "electron", "shared", "server", "apps/mobile", "README.md"] as const;
