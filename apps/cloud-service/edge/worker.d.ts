export declare const HOLD_MS: number;
export declare function wakeReason(request: Request, url: URL): "webhook" | "client" | null;
export declare function routeFor(label: string, env: Record<string, string>, ctx: { waitUntil(p: Promise<unknown>): void }, options?: { fresh?: boolean }): Promise<{ upstream: string; awake: boolean; wakeable: boolean } | null>;
declare const worker: { fetch(request: Request, env: Record<string, string>, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> };
export default worker;
