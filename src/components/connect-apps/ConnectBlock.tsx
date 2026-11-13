import type { ReactNode } from "react";

import { Icon } from "../Icon";
import { CancelLink, ConnectedMark } from "./AppRow";
import { PrimaryButton, type Primary } from "./PrimaryButton";

export interface ConnectLine { text: string; tone: "status" | "alert" | "done" }

/** Where a sign-in stands, said beside the button that moves it on. */
export function ConnectStatus({ line, marker }: { line: ConnectLine; marker: `data-${string}` }) {
  return (
    <p role={line.tone === "alert" ? "alert" : "status"} className="ca-connect-status" data-tone={line.tone} {...{ [marker]: "" }}>
      <Icon name={line.tone === "alert" ? "exclamation-circle" : line.tone === "done" ? "check" : "clock"} size={13} />
      <span>{line.text}</span>
    </p>
  );
}

/** An app's way in, under its name: one short line, the one button with Cancel and where it stands beside it. */
export function ConnectBlock({ note, primary, connected, line, lineMarker = "data-connect-line", children, ...rest }: {
  note?: ReactNode;
  primary: Primary | null;
  connected?: boolean;
  line?: ConnectLine | null;
  lineMarker?: `data-${string}`;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined> & { "aria-label"?: string }) {
  const showMark = !primary && connected;
  return (
    <section className="ca-connect" data-connect="" {...rest}>
      {note && <p className="ca-connect-note">{note}</p>}
      {(primary || showMark || line) && (
        <div className="ca-connect-row">
          {primary ? <PrimaryButton primary={primary} /> : showMark && <ConnectedMark />}
          {primary?.onCancel && (primary.busy || primary.waiting) && <CancelLink onCancel={primary.onCancel} />}
          {line && <ConnectStatus line={line} marker={lineMarker} />}
        </div>
      )}
      {children}
    </section>
  );
}
