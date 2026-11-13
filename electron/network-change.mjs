// a network switch without a sleep (wifi to a phone hotspot, a vpn coming up) leaves connections made on the old
// network silent: nothing closes them, they just stop. the addresses this computer holds change when that happens.
import { networkInterfaces } from "node:os";

/** the computer's own addresses, link-local and loopback left out (they come and go without the network changing) */
export function addressPrint(interfaces = networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const entry of list ?? []) if (!entry.internal && !/^fe80:/i.test(entry.address)) out.push(`${name}|${entry.address}`);
  }
  return out.sort().join(",");
}

/** calls `onChange` once the addresses changed and stayed changed for one more look */
export function watchNetwork(onChange, { everyMs = 3000, read = addressPrint } = {}) {
  let last = read(), seen = null;
  const timer = setInterval(() => {
    const now = read();
    if (now === last) { seen = null; return; }
    if (seen !== now) { seen = now; return; }
    last = now;
    seen = null;
    onChange();
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
