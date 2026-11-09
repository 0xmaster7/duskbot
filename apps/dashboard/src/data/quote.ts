import { useEffect, useMemo, useState } from "react";
import { api, FIXTURE } from "../lib/api";
import type { PlanCatalog, Selection } from "./contracts";
import { priceCart, type Cart } from "./pricing";

export function useCart(given: Selection | null, catalog: PlanCatalog | null) {
  // callers rebuild the selection each render: quote on its values, not its identity
  const key = given ? JSON.stringify(given) : null;
  const selection = useMemo(() => given, [key]);
  const [result, setResult] = useState<{ selection: Selection; catalog: PlanCatalog; cart: Cart | null; error: string | null } | null>(null);
  useEffect(() => {
    if (FIXTURE || !selection || !catalog) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api.quote(selection, controller.signal).then((cart) => {
        if (!controller.signal.aborted) setResult({ selection, catalog, cart, error: null });
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ selection, catalog, cart: null, error: error instanceof Error ? error.message : "Could not load the price. Try again." });
      });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selection, catalog]);
  const current = result?.selection === selection && result?.catalog === catalog ? result : null;
  return {
    cart: current?.cart ?? (selection && catalog ? priceCart(selection, catalog) : null),
    ready: Boolean(FIXTURE || current?.cart),
    error: current?.error ?? null,
  };
}
