// "unavailable" (could not read) must never look like "empty": a caller would register a fresh installation over the real one.
// macOS says "temporarily unavailable. Please try again." for a keychain that is busy at launch, so retry briefly first.
export const CREDENTIAL_READ_DELAYS_MS = [100, 200, 400, 800];

const message = (error) => (error instanceof Error ? error.message : String(error));

/** "unreadable": the store works (a fresh value round-trips) but this file does not open with it, so it can be set aside
 * instead of blocking every later save: a truncated write, or a Safe Storage keychain item that was deleted or replaced. */
export async function readSecureCredentials({
  exists,
  isAvailable,
  readFile,
  decrypt,
  sleep,
  roundTrips = async () => false,
  delays = CREDENTIAL_READ_DELAYS_MS,
}) {
  if (!exists()) return { status: "empty", credentials: {} };
  const unreadable = async (error) => ((await roundTrips().catch(() => false))
    ? { status: "unreadable", credentials: {}, error }
    : { status: "unavailable", credentials: {}, error });

  let lastError = "the operating-system credential store is unavailable";
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      if (!(await isAvailable())) {
        lastError = "the operating-system credential store is unavailable";
        continue;
      }
      const encrypted = readFile();
      if (!encrypted?.length) return unreadable("the credential store file is empty");
      const decrypted = await decrypt(encrypted);
      const text = typeof decrypted === "string" ? decrypted : decrypted?.result;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return unreadable("the credential store is not readable");
        return { status: "ok", credentials: parsed };
      } catch {
        return unreadable("the credential store is not readable");
      }
    } catch (error) {
      lastError = message(error);
    }
  }
  return unreadable(lastError);
}
