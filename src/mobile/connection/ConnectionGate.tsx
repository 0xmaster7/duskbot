import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { MausAvatar } from "@/components/Avatar";
import { readSessionState } from "@/lib/session";
import { parseMobilePairingLink, type MobileConnectionRecord } from "../../../shared/mobile-link";
import { usePlatform } from "../platform";
import { useMobileAccount } from "../account/AccountGate";
import { enrollWorkspace } from "../account/enroll-workspace";
import { installTransport } from "../transport/transport";
import { Onboarding } from "../onboarding/Onboarding";
import { Success } from "../onboarding/Success";
import { connectToWorkspace, createConnectionStore } from "./connections";
import { PairError, parseTypedPairing, type TypedPairing } from "./pair";
import { registerPushForConnection } from "./push";

type GateState = { kind: "loading" } | { kind: "pair"; reason?: "revoked" } | { kind: "ready"; id: string };

export function ConnectionGate({ children, forcePair }: { children: ReactNode; forcePair?: boolean }) {
  const platform = usePlatform();
  const account = useMobileAccount();
  const store = useMemo(() => createConnectionStore(platform), [platform]);
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [incoming, setIncoming] = useState<{ payload: TypedPairing; sequence: number } | null>(null);
  const [celebrate, setCelebrate] = useState<{ name: string; sequence: number } | null>(null);
  const [entered, setEntered] = useState(false);
  const [adding, setAdding] = useState(0);
  useEffect(() => {
    const open = () => setAdding((n) => n + 1);
    window.addEventListener("omb:link-another", open);
    return () => window.removeEventListener("omb:link-another", open);
  }, []);
  const sequence = useRef(0);
  const uninstall = useRef<(() => void) | null>(null);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    setState({ kind: "loading" });
    const decide = async () => {
      if (forcePair) { setState({ kind: "pair" }); return; }
      const active = await store.active();
      if (stopped) return;
      if (active) {
        try {
          const transport = await connectToWorkspace(active.record, active.token, platform, controller.signal);
          if (stopped) { if (transport.kind === "relay") transport.channel.close(); return; }
          uninstall.current = installTransport(transport);
          setState({ kind: "ready", id: active.record.id });
          void store.touch(active.record.id).catch(() => {});
        } catch (error) {
          if (stopped) return;
          if (error instanceof PairError && error.code === "refused") {
            await store.remove(active.record.id);
            if (!stopped) setState({ kind: "pair", reason: "revoked" });
          } else setState({ kind: "pair" });
        }
        return;
      }
      // a native app's own origin is its bundled files, never an installation: it always links one
      if (platform.native) { setState({ kind: "pair" }); return; }
      const session = await readSessionState();
      if (stopped) return;
      if (session.kind === "loopback" || session.kind === "session") {
        uninstall.current = installTransport({ kind: "same-origin", origin: window.location.origin });
        setState({ kind: "ready", id: "same-origin" });
      } else setState({ kind: "pair" });
    };
    void decide().catch(() => { if (!stopped) setState({ kind: "pair" }); });
    return () => { stopped = true; controller.abort(); uninstall.current?.(); uninstall.current = null; };
  }, [forcePair, platform, store]);

  useEffect(() => {
    if (state.kind === "ready" && platform.native) void registerPushForConnection(platform);
  }, [state, platform]);

  useEffect(() => {
    if (state.kind === "ready" && account?.account) void enrollWorkspace(platform, state.id, account.account.id, account.enrollGrant);
  }, [state, platform, account]);

  useEffect(() => {
    const receive = (url: string) => {
      const payload = parseMobilePairingLink(url);
      if (payload) setIncoming({ payload, sequence: ++sequence.current });
      return Boolean(payload);
    };
    const customLink = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (typeof detail !== "string") return;
      const parsed = parseTypedPairing(detail);
      if (parsed && !("kind" in parsed)) setIncoming({ payload: parsed, sequence: ++sequence.current });
    };
    const stop = platform.onAppUrl?.(receive);
    window.addEventListener("omb:pair-link", customLink);
    return () => { stop?.(); window.removeEventListener("omb:pair-link", customLink); };
  }, [platform]);

  /** Linked: the app mounts on the new installation straight away, under the success moment, so Home is loaded by the
   * time the moment hands over. No reload. */
  const linked = useCallback(async (record: MobileConnectionRecord, token: string, name: string) => {
    await store.save(record, token);
    const transport = await connectToWorkspace(record, token, platform, new AbortController().signal);
    uninstall.current?.();
    uninstall.current = installTransport(transport);
    setIncoming(null);
    setAdding(0);
    setEntered(true);
    setCelebrate({ name, sequence: ++sequence.current });
    setState({ kind: "ready", id: record.id });
  }, [platform, store]);
  const cancel = () => { ++sequence.current; setIncoming(null); };

  const success = (
    <AnimatePresence>
      {celebrate && <Success key={celebrate.sequence} name={celebrate.name} onDone={() => { setCelebrate(null); platform.setStatusBar?.(document.documentElement.dataset.skin === "grok-dark" ? "light" : "dark"); }} />}
    </AnimatePresence>
  );
  const onboarding = state.kind !== "ready" || (forcePair && !entered);
  if (state.kind === "loading" && !incoming && !forcePair) return <div className="omb-mobile flex size-full items-center justify-center bg-app"><MausAvatar color="green" size={56} state="idle" animated={false} personality={false} /></div>;
  if (onboarding) {
    return <>{success}<Onboarding key={incoming?.sequence ?? 0} initial={incoming?.payload} reason={state.kind === "pair" ? state.reason : null} onLinked={linked} onCancel={cancel} /></>;
  }
  return (
    <>
      <Fragment key={state.id}>{children}</Fragment>
      {(incoming || adding > 0) && (
        <div className="fixed inset-0 z-50">
          <Onboarding key={incoming ? `in-${incoming.sequence}` : `add-${adding}`} initial={incoming?.payload} startAtLink
            onLinked={linked} onCancel={() => { cancel(); setAdding(0); }} />
        </div>
      )}
      {success}
    </>
  );
}
