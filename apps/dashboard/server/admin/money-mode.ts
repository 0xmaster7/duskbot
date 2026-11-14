export type MoneyMode = "test" | "live";
export type MoneyView = MoneyMode | "all";

interface MoneyRecords {
  subscriptions: ReadonlyArray<{ id: string; mode?: MoneyMode }>;
  invoices: ReadonlyArray<{ providerPaymentId: string; subscriptionId: string | null; mode?: MoneyMode }>;
  refunds?: ReadonlyArray<{ paymentId: string }>;
  ledger?: ReadonlyArray<{ subscriptionId: string | null; providerPaymentId: string | null }>;
  checkouts: ReadonlyArray<{ subscriptionId: string | null }>;
}

/** which money the panel counts, from the x-dusk-admin-money header: live unless it asks for test or all */
export const moneyViewOf = (value: unknown): MoneyView => value === "test" || value === "all" ? value : "live";

/** the records made in one mode: a record without a stamp was made in the server's provider mode (preview's dodo is test),
 *  and test money never counts toward live numbers, or the other way. a read-only copy; nothing in the store changes */
export function moneyIn<T extends MoneyRecords>(state: T, want: MoneyView, serverMode: MoneyMode): T {
  if (want === "all") return state;
  const subMode = new Map(state.subscriptions.map(sub => [sub.id, sub.mode ?? serverMode]));
  const payMode = new Map(state.invoices.map(row => [row.providerPaymentId, row.mode ?? (row.subscriptionId ? subMode.get(row.subscriptionId) : undefined) ?? serverMode]));
  const of = (subscriptionId: string | null | undefined, paymentId?: string | null) =>
    (subscriptionId ? subMode.get(subscriptionId) : undefined) ?? (paymentId ? payMode.get(paymentId) : undefined) ?? serverMode;
  return { ...state, subscriptions: state.subscriptions.filter(sub => subMode.get(sub.id) === want),
    invoices: state.invoices.filter(row => payMode.get(row.providerPaymentId) === want),
    ...(state.refunds ? { refunds: state.refunds.filter(row => (payMode.get(row.paymentId) ?? serverMode) === want) } : {}),
    ...(state.ledger ? { ledger: state.ledger.filter(row => of(row.subscriptionId, row.providerPaymentId) === want) } : {}),
    checkouts: state.checkouts.filter(row => of(row.subscriptionId) === want) };
}
