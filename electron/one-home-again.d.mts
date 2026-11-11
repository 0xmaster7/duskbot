export interface HomeGrant { origin: string; code: string; expiresAt: number }
export interface Answer { ok: boolean; status: number; body: any }
export function createHomeAgain(deps: {
  exportGrant(): Promise<{ starting: true } | { notHeld: true } | { deleted: true } | { grant: HomeGrant }>;
  open(grant: HomeGrant): Promise<{ call(method: string, route: string, body?: unknown): Promise<Answer>; fetch?(route: string, init?: RequestInit): Promise<Response>; close(): Promise<void> }>;
  local: { json(method: string, route: string, body?: unknown): Promise<Answer>; upload(file: string, bytes: number): Promise<Answer> };
  tempRoot: string;
}): {
  stage(): Promise<{ later: number } | { deleted: true } | { staged: true; switches: Record<string, boolean> }>;
  bring(): Promise<{ later: number } | { deleted: true } | { restored: string; switches: Record<string, boolean> }>;
};
