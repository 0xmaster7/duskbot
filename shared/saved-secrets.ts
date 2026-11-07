/** A secret saved to the Vault from a bot's card, as Settings shows it: never its value. */
export interface SavedSecretSummary {
  id: string;
  label: string;
  /** The bots that may use it. */
  bots: string[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

/** A card secret sealed in the person's app for the server that keeps it (HPKE, P-256, AES-256-GCM): the relay between
 * them only ever carries this. */
export interface SealedCardSecret {
  keyId: string;
  encapsulatedKey: string;
  ciphertext: string;
}

/** The server's key a card seals for, valid while that server process runs. */
export interface CardSealKey {
  version: 1;
  keyId: string;
  x: string;
  y: string;
}

export const CARD_SECRET_INFO = "OpenMausBot card secret v1";

/** What the seal is bound to, so a relay cannot move it to another bot, conversation, card or choice. */
export function cardSecretAAD(context: { keyId: string; botId: string; threadId: string; messageId: string; requestKey: string; remember: boolean }): Uint8Array {
  return new TextEncoder().encode([
    "openmausbot-card-secret-v1", context.keyId, context.botId, context.threadId, context.messageId, context.requestKey, context.remember ? "save" : "once",
  ].join("\n"));
}
