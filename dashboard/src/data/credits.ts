import { useCallback, useState } from "react";
import { FIXTURE } from "../lib/api";

// auto top-up and a monthly spend limit have no billing contract yet; fixtures keep them in memory so the page can
// be shown, and live builds hide the controls until billing answers for them
let memory = { autoTopUp: false, limitUsd: null as number | null };

export function useCreditControls() {
  const [state, setState] = useState(memory);
  const supported = FIXTURE !== null;
  const update = useCallback((patch: Partial<typeof memory>) => { memory = { ...memory, ...patch }; setState(memory); }, []);
  return {
    supported,
    autoTopUp: state.autoTopUp,
    limitUsd: state.limitUsd,
    setAutoTopUp: (on: boolean) => update({ autoTopUp: on }),
    setLimit: (usd: number | null) => update({ limitUsd: usd }),
  };
}
