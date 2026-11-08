import { Badge, Button, Card, KV, PageHeader, SectionTitle } from "../ui/kit";

// billing does not exist yet: this page is a labelled preview with sample values, nothing here is charged
const INVOICES = [
  { id: "inv-1", date: "1 Nov 2026", label: "Self-hosted plan", amount: "$0.00" },
  { id: "inv-2", date: "1 Oct 2026", label: "Self-hosted plan", amount: "$0.00" },
  { id: "inv-3", date: "1 Sep 2026", label: "Self-hosted plan", amount: "$0.00" },
];

export function BillingPage() {
  return (
    <div>
      <PageHeader title="Billing" sub="Your bots run on your own machines and AI accounts, so nothing is billed today." action={<Badge tone="warn">Preview · sample values</Badge>} />
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <SectionTitle>Plan</SectionTitle>
            <p className="flex items-baseline gap-2"><span className="text-28 font-medium tracking-[-0.02em] text-ink">Self-hosted</span><span className="text-14 text-ink-3">free</span></p>
            <dl className="mt-4 divide-y divide-line border-t border-line">
              <KV k="Workspaces" v="Unlimited" />
              <KV k="Bots" v="Unlimited" />
              <KV k="AI" v="Your own accounts" />
            </dl>
          </Card>
          <Card>
            <SectionTitle action={<Button size="sm" variant="primary" disabled title="Credits arrive with billing">Buy credits</Button>}>Balance</SectionTitle>
            <p className="flex items-baseline gap-2"><span className="num text-28 font-medium tracking-[-0.02em] text-ink">$0.00</span><span className="text-14 text-ink-3">credits</span></p>
            <dl className="mt-4 divide-y divide-line border-t border-line">
              <KV k="Auto top-up" v="Off" />
              <KV k="Monthly spending cap" v="Not set" />
              <KV k="Alert at" v="80% of the cap" />
            </dl>
          </Card>
        </div>
        <Card>
          <SectionTitle>Invoices</SectionTitle>
          <ul className="divide-y divide-line">
            {INVOICES.map((i) => (
              <li key={i.id} className="flex items-center gap-4 py-3 text-14">
                <span className="num w-28 shrink-0 text-ink-3">{i.date}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{i.label}</span>
                <span className="num text-ink-2">{i.amount}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-13 text-ink-4">Sample rows. Real invoices appear here once paid plans exist.</p>
        </Card>
      </div>
    </div>
  );
}
