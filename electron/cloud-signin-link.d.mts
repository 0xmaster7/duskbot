export declare function linkSignIn(origin: string, provider: unknown, random?: (size: number) => Buffer): { url: string; verifier: string; state: string } | null;
