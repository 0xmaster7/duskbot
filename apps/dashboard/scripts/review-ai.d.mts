type HomeCall = (path: string, init?: { method?: string; body?: Record<string, unknown> }) => Promise<{ ok: boolean; status: number; data: any }>;
export declare const REVIEW_AI: { name: string; url: string; model: string };
export declare function wireDemoAi(call: HomeCall, input: { botId: string; key: string | null; model?: string }):
  Promise<{ wired: false; reason: string } | { wired: true; added: boolean; pointed: boolean; instanceId: string; model: string }>;
