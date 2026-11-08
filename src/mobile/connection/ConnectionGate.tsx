import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MausAvatar } from "@/components/Avatar";
import { t } from "@/lib/i18n";
import { readSessionState } from "@/lib/session";
import { parseMobilePairingLink, type MobileConnectionRecord } from "../../../shared/mobile-link";
import { usePlatform } from "../platform";
import { Sheet } from "../Sheet";
import { installTransport } from "../transport/transport";
import { createConnectionStore } from "./connections";
import { PairScreen } from "./PairScreen";
import type { TypedPairing } from "./pair";

type GateState = { kind: "loading" } | { kind: "pair"; reason?: "revoked" } | { kind: "ready"; id: string };

export function ConnectionGate({ children, forcePair }: { children: ReactNode; forcePair?: boolean }) {
  const platform = usePlatform();
  const store = useMemo(() => createConnectionStore(platform), [platform]);
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [incoming, setIncoming] = useState<{ payload: TypedPairing; sequence: number } | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    let stopped = false;
    let uninstall: (() => void) | undefined;
    const controller = new AbortController();
    setState({ kind: "loading" });
    const decide = async () => {
      if (forcePair) { setState({ kind: "pair" }); return; }
      const active = await store.active();
      if (stopped) return;
      if (active?.record.origin && active.record.transport !== "relay") {
        uninstall = installTransport({ kind: "bearer", origin: active.record.origin, token: active.token });
        setState({ kind: "ready", id: active.record.id });
        void store.touch(active.record.id).catch(() => {});
        void fetch("/api/auth/session", { signal: controller.signal }).then(async (response) => {
          if (stopped || response.status !== 401) return;
          setState({ kind: "pair", reason: "revoked" });
          uninstall?.();
          uninstall = undefined;
          await store.remove(active.record.id);
        }).catch(() => {});
        return;
      }
      const session = await readSessionState();
      if (stopped) return;
      if (session.kind === "loopback" || session.kind === "session") {
        uninstall = installTransport({ kind: "same-origin", origin: window.location.origin });
        setState({ kind: "ready", id: "same-origin" });
      } else setState({ kind: "pair" });
    };
    void decide().catch(() => { if (!stopped) setState({ kind: "pair" }); });
    return () => { stopped = true; controller.abort(); uninstall?.(); };
  }, [forcePair, store]);

  useEffect(() => {
    const receive = (url: string) => {
      const payload = parseMobilePairingLink(url);
      if (payload) setIncoming({ payload, sequence: ++sequence.current });
      return Boolean(payload);
    };
    const customLink = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (typeof detail === "string") receive(detail);
    };
    const stop = platform.onAppUrl?.(receive);
    window.addEventListener("omb:pair-link", customLink);
    return () => { stop?.(); window.removeEventListener("omb:pair-link", customLink); };
  }, [platform]);

  const linked = useCallback(async (record: MobileConnectionRecord, token: string) => {
    await store.save(record, token);
    window.location.reload();
  }, [store]);
  const cancel = () => setIncoming(null);
  if (state.kind === "loading" && !incoming && !forcePair) return <div className="omb-mobile flex size-full items-center justify-center bg-app"><MausAvatar color="green" size={56} state="idle" animated={false} personality={false} /></div>;
  if (state.kind !== "ready" || forcePair) return <PairScreen key={incoming?.sequence ?? 0} initial={incoming?.payload} reason={state.kind === "pair" ? state.reason : null} onLinked={linked} onCancel={cancel} />;
  return (
    <>
      <Fragment key={state.id}>{children}</Fragment>
      {incoming && (
        <div className="omb-mobile fixed inset-0 z-50">
          <Sheet open onClose={cancel} title={t("mobile.pair.sheetTitle")} full flush>
            <PairScreen key={incoming.sequence} initial={incoming.payload} onLinked={linked} onCancel={cancel} />
          </Sheet>
        </div>
      )}
    </>
  );
}
