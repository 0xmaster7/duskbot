/** Before a pairing code or QR is shown: the desktop's presence check when it has one, else yes. A check that fails or
 * throws keeps the secret hidden. */
export async function confirmUserPresence(reason: string): Promise<boolean> {
  const check = typeof window === "undefined" ? undefined : window.duskDesktop?.requireUserPresence;
  if (!check) return true;
  try {
    return (await check(reason)) === true;
  } catch {
    return false;
  }
}
