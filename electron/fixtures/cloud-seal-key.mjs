import { createCardSealer } from "../../server/card-seal.ts";

/** A fake My Cloud's sealer: its public key answers GET /api/seal-key, and `open` reads what a move sealed for it. */
export const cloudSealer = createCardSealer();

/** The answer to GET /api/seal-key, or null for any other call. */
export const sealKeyAnswer = (method, route) => (method === "GET" && route === "/api/seal-key" ? { ok: true, status: 200, body: { sealKey: cloudSealer.publicKey() } } : null);
