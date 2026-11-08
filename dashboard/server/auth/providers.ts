import type { OAuthProvider } from "../../../shared/account-api.ts";

export interface Provider { id: OAuthProvider }
export function createProviderRegistry() { return new Map<OAuthProvider, Provider>(); }
