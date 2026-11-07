import { useCallback, useEffect, useRef, useState } from "react";
import { productName } from "@/lib/brand";

export interface TakeoverSnapshot {
  held: boolean;
  /** This view's lease holds the computer; absent from a plain take or release. */
  owned?: boolean;
}

/** Another device's hand-back and this view's next take can arrive out of order; only a release that lasts ends a session. */
const RELEASE_SETTLE_MS = 1_500;

/** `crypto.randomUUID` exists only in secure contexts, and a phone may reach the app over plain LAN http. */
const newLeaseId = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, "0")).join("");

type Request = (action: "take" | "release", controlLeaseId?: string) => Promise<TakeoverSnapshot>;

function post(path: string, body: unknown): void {
  void fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true })
    .catch(() => {});
}

/**
 * Taking control where the person watches: the panel's own picture becomes the live, drivable desktop at once, and the
 * bot's computer calls wait. Leaving it in any way (Hand back, closing the panel or the page, another conversation)
 * gives the computer back, but only a hold this view took: another device's stays.
 */
export function useComputerTakeover({ botId, session, held, request, viewerClose }: {
  botId: string;
  /** The bot, conversation and computer being watched; a new one ends a session started on the old. */
  session: string;
  held: boolean;
  request: Request;
  /** A VPS keeps its viewer tunnel until told; the Local VM's viewer runs with the VM. */
  viewerClose: string | null;
}) {
  const [here, setHere] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [handingBack, setHandingBack] = useState(false);
  const lease = useRef<{ id: string; viewerClose: string | null } | null>(null);
  const target = useRef(session);
  target.current = session;
  const generation = useRef(0);
  const closeRef = useRef(viewerClose);
  closeRef.current = viewerClose;

  const end = useCallback(() => {
    setHere(false);
    setExpanded(false);
  }, []);

  const leave = useCallback(() => {
    generation.current += 1;
    const mine = lease.current;
    lease.current = null;
    end();
    if (!mine) return;
    post(`/api/bots/${botId}/computer/control`, { action: "release", controlLeaseId: mine.id });
    if (mine.viewerClose) post(mine.viewerClose, {});
  }, [botId, end]);

  const take = useCallback(async (expand = false) => {
    const id = newLeaseId();
    const attempt = ++generation.current;
    const snap = await request("take", id);
    if (generation.current !== attempt || target.current !== session) {
      if (snap.owned) post(`/api/bots/${botId}/computer/control`, { action: "release", controlLeaseId: id });
      return;
    }
    if (!snap.held) throw new Error(`${productName()} could not confirm computer control`);
    lease.current = snap.owned ? { id, viewerClose: closeRef.current } : null;
    setHere(true);
    setExpanded(expand);
  }, [request, botId, session]);

  const handBack = useCallback(async (keepExpanded = false) => {
    generation.current += 1;
    const close = lease.current?.viewerClose ?? closeRef.current;
    lease.current = null;
    if (keepExpanded) setHere(false); else end();
    setHandingBack(true);
    try {
      await request("release");
    } finally {
      setHandingBack(false);
      if (close) post(close, {});
    }
  }, [end, request]);

  useEffect(() => leave, [session, leave]);
  useEffect(() => {
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [leave]);
  useEffect(() => {
    if (!here || held) return;
    const timer = setTimeout(() => {
      lease.current = null;
      end();
    }, RELEASE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [here, held, end]);

  return { here, expanded, setExpanded, handingBack, take, handBack, leave };
}
