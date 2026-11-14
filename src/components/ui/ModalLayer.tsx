import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** A full-window overlay (a scrim and its dialog) drawn at the top of the page, in <body>, so no stacking context it was
 * opened from (the chat's composer dock, a card, Settings) can hold its scrim under the toolbar, the chat's header or the
 * sidebar footer. Rendered to a string there is no body, so it draws in place. */
export function ModalLayer({ children }: { children: ReactNode }) {
  return typeof document === "undefined" || !document.body ? <>{children}</> : createPortal(children, document.body);
}
