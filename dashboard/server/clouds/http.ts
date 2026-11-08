export class RetryableCloudError extends Error {
  readonly retryable = true;
  constructor(message = "Cloud provider temporarily unavailable.") { super(message); this.name = "RetryableCloudError"; }
}

export async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Cloud response too large.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Invalid cloud response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Cloud response too large.");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { await reader.cancel().catch(() => {}); throw new Error("Invalid cloud response."); }
  finally { reader.releaseLock(); }
}
