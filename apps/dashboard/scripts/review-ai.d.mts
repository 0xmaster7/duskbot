type HomeCall = (path: string, init?: { method?: string; body?: Record<string, unknown> }) => Promise<{ ok: boolean; status: number; data: any }>;
export interface ReviewAi { env: string; provider: string; url: string; model: string; key: string }
export declare const REVIEW_AI_NAME: string;
export declare const REVIEW_AI_PROVIDERS: Array<Omit<ReviewAi, "key">>;
export declare const MISSING_REVIEW_AI: string;
export declare function pickReviewAi(keys: Record<string, string | null | undefined>): ReviewAi | null;
export declare function wireDemoAi(call: HomeCall, input: { botId: string; ai: ReviewAi | null }):
  Promise<{ wired: false; reason: string } | { wired: true; added: boolean; pointed: boolean; instanceId: string; provider: string; model: string }>;
