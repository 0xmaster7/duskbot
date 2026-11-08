import { useMemo, useState } from "react";
import { Copy, Fingerprint, KeyRound, Laptop, Mail, Monitor, Plus, Server, Smartphone } from "lucide-react";
import { useStore } from "../data/store";
import type { Account, ApiToken, Session } from "../data/types";
import { ago, date, monthYear } from "../lib/format";
import { Button, Card, CardHead, Field, Input, PageHead, Pill, Select, STROKE, Switch } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { Dialog } from "../ui/overlays";

function useAccount() {
  const { data, update, toast } = useStore();
  const set = (fn: (a: Account) => Account) => update((d) => ({ ...d, account: fn(d.account) }));
  return { a: data.account, now: data.now, set, toast };
}

const ZONES = ["UTC", "Europe/Berlin", "Europe/London", "Europe/Lisbon", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];

export function ProfilePage() {
  const { a, set, toast } = useAccount();
  const [form, setForm] = useState({ name: a.name, handle: a.handle, email: a.email, timezone: a.timezone, language: a.language, weekStart: a.weekStart });
  const zones = useMemo(() => (ZONES.includes(a.timezone) ? ZONES : [a.timezone, ...ZONES]), [a.timezone]);
  const nameBad = form.name.trim() ? null : "Enter the name your bots call you.";
  const handleBad = /^[a-z0-9_]{2,24}$/.test(form.handle) ? null : "Use 2 to 24 lowercase letters, numbers or underscores.";
  const dirty = JSON.stringify(form) !== JSON.stringify({ name: a.name, handle: a.handle, email: a.email, timezone: a.timezone, language: a.language, weekStart: a.weekStart });
  const field = <K extends keyof typeof form>(key: K) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })) });
  return (
    <>
      <PageHead title="Profile" sub="Who you are to your bots, and the clock your routines and charts follow." />
      <Card className="max-w-[760px] p-5">
        <div className="flex flex-wrap items-center gap-4 border-b border-row pb-5">
          <span className="flex size-14 items-center justify-center rounded-full bg-black text-18 font-medium text-[#fafafa]" aria-hidden>{a.initials}</span>
          <div className="min-w-0 flex-1"><p className="text-16 font-medium">{a.name}</p><p className="text-13 text-ink-3">Member since {monthYear(Date.now() - 318 * 86_400_000)}</p></div>
          <Button onClick={() => toast("Choose a photo in the app: Settings, Profile")}>Change photo</Button>
        </div>
        <form className="mt-5 grid max-w-[640px] gap-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          if (nameBad || handleBad) return;
          set((x) => ({ ...x, ...form, weekStart: form.weekStart as Account["weekStart"] }));
          toast("Profile saved");
        }}>
          <Field label="Name" error={nameBad}>{(id, d) => <Input id={id} autoComplete="name" aria-invalid={!!nameBad} aria-describedby={d} {...field("name")} />}</Field>
          <Field label="Handle" error={handleBad} hint="Teammates mention you with it.">{(id, d) => <Input id={id} aria-invalid={!!handleBad} aria-describedby={d} {...field("handle")} />}</Field>
          <Field label="Email" hint={<span className="inline-flex items-center gap-1.5"><Pill tone="good">Verified</Pill>Changing it sends a confirmation link.</span>}>{(id, d) => <Input id={id} type="email" autoComplete="email" aria-describedby={d} {...field("email")} />}</Field>
          <Field label="Language">{(id) => <Select id={id} {...field("language")}>{["English", "Deutsch", "Español", "Français", "Português", "日本語"].map((l) => <option key={l}>{l}</option>)}</Select>}</Field>
          <Field label="Timezone" hint="Days in your activity map and routine times use it.">{(id, d) => <Select id={id} aria-describedby={d} {...field("timezone")}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>}</Field>
          <Field label="Weeks start on">{(id) => <Select id={id} {...field("weekStart")}><option value="monday">Monday</option><option value="sunday">Sunday</option></Select>}</Field>
          <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={!dirty}>Save profile</Button></div>
        </form>
      </Card>
    </>
  );
}

const SESSION_ICON: Record<Session["kind"], typeof Laptop> = { desktop: Laptop, phone: Smartphone, browser: Monitor };

function TokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { set, toast } = useAccount();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("Read usage");
  const [made, setMade] = useState<string | null>(null);
  const close = () => { onClose(); setTimeout(() => { setName(""); setMade(null); }, 250); };
  const create = () => {
    const secret = `omb_live_${Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32)}`;
    const token: ApiToken = { id: `tk-${Date.now()}`, name: name.trim(), scope, createdAt: Date.now(), lastUsedAt: null, prefix: secret.slice(0, 12) };
    set((a) => ({ ...a, tokens: [token, ...a.tokens] }));
    setMade(secret);
  };
  return (
    <Dialog open={open} onClose={close} title={made ? "Copy your token now" : "New API token"}
      actions={made ? <Button variant="primary" onClick={close}>Done</Button> : <><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={create}>Create token</Button></>}>
      {made ? (
        <>
          <p className="text-13">This is the only time it is shown. Store it somewhere safe; you can revoke it here any time.</p>
          <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-sunk p-2 ps-3">
            <code className="min-w-0 flex-1 truncate font-mono text-12">{made}</code>
            <Button size="sm" icon={Copy} onClick={() => { void navigator.clipboard?.writeText(made); toast("Token copied"); }}>Copy</Button>
          </div>
        </>
      ) : (
        <div className="grid gap-3">
          <Field label="Name" hint="Say where it is used, like Shortcuts on iPhone.">{(id, d) => <Input id={id} data-autofocus value={name} onChange={(e) => setName(e.target.value)} aria-describedby={d} />}</Field>
          <Field label="What it may do">{(id) => <Select id={id} value={scope} onChange={(e) => setScope(e.target.value)}>{["Read usage", "Send messages", "Run routines", "Everything"].map((s) => <option key={s}>{s}</option>)}</Select>}</Field>
        </div>
      )}
    </Dialog>
  );
}

export function SecurityPage() {
  const { a, now, set, toast } = useAccount();
  const [tokenOpen, setTokenOpen] = useState(false);
  const revokeSession = (s: Session) => { set((x) => ({ ...x, sessions: x.sessions.filter((y) => y.id !== s.id) })); toast(`Signed out ${s.device}`); };
  return (
    <>
      <PageHead title="Security & devices" sub="How you sign in, and every device and key that can reach your bots." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead icon={Fingerprint} title="Sign-in"><Button size="sm" icon={Plus} onClick={() => toast("Follow your browser's prompt to add a passkey")}>Add passkey</Button></CardHead>
          <ul className="px-4 pb-2">
            <li className="flex min-h-11 items-center gap-3 border-b border-row"><Mail size={16} strokeWidth={STROKE} className="text-ink-3" aria-hidden /><span className="flex-1 text-13"><span className="font-medium">Email link</span><span className="text-ink-3">, {a.email}</span></span></li>
            {a.passkeys.map((p) => (
              <li key={p.id} className="flex min-h-11 items-center gap-3 border-b border-row last:border-0">
                <KeyRound size={16} strokeWidth={STROKE} className="text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 text-13"><span className="font-medium">{p.name}</span><span className="text-ink-3">, added {date(p.addedAt)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => { set((x) => ({ ...x, passkeys: x.passkeys.filter((y) => y.id !== p.id) })); toast(`${p.name} removed`); }} disabled={a.passkeys.length === 1}>Remove</Button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3 border-t border-row px-4 py-3">
            <div className="flex-1"><p className="text-13 font-medium">Two-step sign-in</p><p className="text-12 text-ink-3">Ask for a passkey or code after the email link.</p></div>
            <Switch checked={a.twoFactor} label="Two-step sign-in" onChange={(v) => { set((x) => ({ ...x, twoFactor: v })); toast(v ? "Two-step sign-in is on" : "Two-step sign-in is off"); }} />
          </div>
        </Card>
        <Card>
          <CardHead icon={Server} title="Paired apps and servers" />
          <ul className="px-4 pb-2">
            {a.paired.map((p) => (
              <li key={p.id} className="flex min-h-11 items-center gap-3 border-b border-row last:border-0">
                <span className="min-w-0 flex-1 text-13"><span className="font-medium">{p.name}</span><span className="block text-12 text-ink-3">{p.kind}, seen {ago(p.lastSeenAt, now)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => { set((x) => ({ ...x, paired: x.paired.filter((y) => y.id !== p.id) })); toast(`${p.name} unpaired`); }}>Unpair</Button>
              </li>
            ))}
          </ul>
          <div className="border-t border-row px-4 py-3 text-12 text-ink-3">Pair a new device from the app: Settings, Devices.</div>
        </Card>
      </div>

      <Card id="sessions" className="mt-4">
        <CardHead title="Where you're signed in"><Button size="sm" onClick={() => { set((x) => ({ ...x, sessions: x.sessions.filter((s) => s.current) })); toast("Signed out everywhere else"); }}>Sign out everywhere else</Button></CardHead>
        <ul className="px-4 pb-2">
          {a.sessions.map((s) => {
            const Icon = SESSION_ICON[s.kind];
            return (
              <li key={s.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-row py-2 last:border-0">
                <Icon size={16} strokeWidth={STROKE} className="text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 text-13"><span className="font-medium">{s.device}</span><span className="block text-12 text-ink-3">{s.place}, {s.current ? "active now" : ago(s.lastActiveAt, now)}</span></span>
                {s.current ? <Pill tone="accent">This device</Pill> : <Button size="sm" variant="ghost" onClick={() => revokeSession(s)}>Sign out</Button>}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card id="tokens" className="mt-4">
        <CardHead icon={KeyRound} title="API tokens"><Button size="sm" icon={Plus} onClick={() => setTokenOpen(true)}>New token</Button></CardHead>
        {a.tokens.length === 0 ? <div className="flex flex-col items-center px-6 py-8 text-center"><Mascot color="silver" body="squircle" size={40} state="curious" /><p className="mt-3 text-13 text-ink-3">No tokens. Make one to let Shortcuts or Home Assistant talk to your bots.</p></div> : (
          <div className="scroll-x">
            <table className="w-full min-w-[520px] text-13">
              <thead><tr className="h-9 border-b border-row text-12 text-ink-3"><th className="ps-4 text-start font-normal">Name</th><th className="text-start font-normal">Can</th><th className="text-start font-normal">Token</th><th className="text-start font-normal">Last used</th><th className="pe-4"><span className="sr-only">Revoke</span></th></tr></thead>
              <tbody>
                {a.tokens.map((t) => (
                  <tr key={t.id} className="h-11 border-b border-row last:border-0">
                    <td className="ps-4 font-medium">{t.name}</td>
                    <td className="text-ink-2">{t.scope}</td>
                    <td className="font-mono text-12 text-ink-3">{t.prefix}...</td>
                    <td className="text-ink-2">{t.lastUsedAt ? ago(t.lastUsedAt, now) : "Never"}</td>
                    <td className="pe-4 text-end"><Button size="sm" variant="ghost" className="text-bad" onClick={() => { set((x) => ({ ...x, tokens: x.tokens.filter((y) => y.id !== t.id) })); toast(`${t.name} revoked. Anything using it stops working now.`); }}>Revoke</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <TokenDialog open={tokenOpen} onClose={() => setTokenOpen(false)} />
    </>
  );
}
