import { useEffect, useState, type MouseEvent } from "react";

/** A switch moves the moment it is pressed. Its owner may save first and pass `disabled` while it does: the switch
 * keeps showing the new position and stays looking live (no dimming, no busy cursor), ignores presses until the save
 * settles, then shows what its owner reports, so a failed save flips it back. An owner that ignores the click (neither
 * flips nor goes busy in that render) is shown as it is at once; a stuck one gives up after 4s. */
export function useOptimisticSwitch(checked: boolean, disabled: boolean | undefined, onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined) {
  const [pending, setPending] = useState<{ value: boolean; sawBusy: boolean } | null>(null);
  if (pending && !disabled && (pending.value === checked || pending.sawBusy)) setPending(null);
  else if (pending && disabled && !pending.sawBusy) setPending({ ...pending, sawBusy: true });
  const value = pending?.value;
  // an owner that neither flips nor goes busy in the click's own render ignored the click: show its value at once
  const ignored = pending !== null && !pending.sawBusy && !disabled && pending.value !== checked;
  useEffect(() => {
    if (ignored) setPending(null);
  }, [ignored]);
  useEffect(() => {
    if (value === undefined) return;
    const timer = window.setTimeout(() => setPending(null), 4000);
    return () => window.clearTimeout(timer);
  }, [value]);
  const shown = pending ? pending.value : checked;
  const saving = pending !== null && Boolean(disabled);
  return {
    checked: shown,
    disabled: disabled && pending === null,
    busy: saving,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (saving) { event.preventDefault(); return; }
      setPending({ value: !shown, sawBusy: false });
      onClick?.(event);
    },
  };
}
