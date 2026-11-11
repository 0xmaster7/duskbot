// Which arrays of each store get a collection of their own (one document per row, keyed), and the indexes on them.
// Everything else in a store (counters, small queues, version fields) is one document in `stores`.
type Row = Record<string, unknown>;
export interface CollectionLayout {
  collection: string;
  key: (row: Row) => string;
  indexes?: Array<{ keys: Record<string, 1 | -1>; unique?: boolean; partial?: Record<string, unknown> }>;
}
export type StoreLayout = Record<string, CollectionLayout>;

const byId = (row: Row) => row.id as string;
const byAccount = [{ keys: { accountId: 1 } as Record<string, 1> }];

export const STORE_LAYOUTS: Record<string, StoreLayout> = {
  state: {
    workspaces: { collection: "workspaces", key: byId, indexes: [{ keys: { ownerAccountId: 1 } }, { keys: { publicKey: 1 } }] },
    accounts: { collection: "workspace_accounts", key: byId },
  },
  auth: {
    accounts: { collection: "accounts", key: byId, indexes: [{ keys: { email: 1 }, unique: true }] },
    identities: { collection: "identities", key: row => `${row.provider}:${row.subject}`, indexes: [{ keys: { accountId: 1 } }] },
    sessions: { collection: "sessions", key: byId, indexes: [{ keys: { tokenHash: 1 }, unique: true }, { keys: { accountId: 1 } }, { keys: { expiresAt: 1 } }] },
  },
  billing: {
    customers: { collection: "billing_customers", key: row => row.accountId as string },
    checkouts: { collection: "billing_checkouts", key: byId, indexes: [...byAccount, { keys: { providerSessionId: 1 } }] },
    subscriptions: { collection: "billing_subscriptions", key: byId,
      indexes: [...byAccount, { keys: { providerSubscriptionId: 1 }, unique: true, partial: { providerSubscriptionId: { $type: "string" } } }] },
    licenses: { collection: "billing_licenses", key: byId, indexes: [{ keys: { ownerAccountId: 1 } }] },
    invoices: { collection: "billing_invoices", key: byId, indexes: [...byAccount, { keys: { providerPaymentId: 1 }, unique: true }] },
    credits: { collection: "billing_credits", key: byId, indexes: [...byAccount, { keys: { reason: 1, ref: 1 }, unique: true }] },
    webhookEvents: { collection: "billing_webhook_events", key: byId, indexes: [{ keys: { at: 1 } }] },
    feedback: { collection: "billing_feedback", key: byId },
    closures: { collection: "billing_closures", key: byId },
    refunds: { collection: "billing_refunds", key: byId },
    providerCancels: { collection: "billing_provider_cancels", key: byId },
    duplicates: { collection: "billing_duplicates", key: byId, indexes: byAccount },
  },
  clouds: {
    clouds: { collection: "clouds", key: byId, indexes: [...byAccount, { keys: { status: 1 } }] },
  },
  pages: {
    pages: { collection: "pages", key: byId, indexes: byAccount },
  },
  "slack-edge": {
    regs: { collection: "slack_edge_regs", key: row => row.cloudId as string },
    events: { collection: "slack_edge_events", key: byId, indexes: [{ keys: { cloudId: 1 } }] },
  },
};

/** append-only logs and their indexes */
export const LOGS: Record<string, Array<{ keys: Record<string, 1 | -1> }>> = {
  managed_audit: [{ keys: { cloudId: 1, at: 1 } }, { keys: { at: 1 } }],
};
