// Security: the invite link is convenience, not a second door; the one-time code still goes to the address itself.
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatUsd, hasFiniteCost } from "@/lib/usage";
import { readMembership, type Membership } from "../lib/membership";
import { readSessionState, type SessionState } from "../lib/session";
import { canPairDevices } from "./ServerPairingCard";
import { normalizeAccessEntry, withEntry, withoutEntry, type SignInLists } from "./SignInAccessCard";
import { SettingRow } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";
import { CopyRow, FormDialog, FormField, ItemRow, NoteRow, rowCls } from "./ListRows";
import { textFieldCls } from "./ui/GrokDialog";

export type Role = "admin" | "member";


export interface Person {
  entry: string;
  role: Role;
  isDomain: boolean;
  lastSeenAt: number | null;
  devices: number;
  turns: number;
  costUsd: number | null;
  estimated?: boolean;
}

export function inviteLink(base: string, entry: string): string {
  const origin = base.replace(/\/+$/, "");
  return entry.startsWith("@") ? `${origin}/pair` : `${origin}/pair?email=${encodeURIComponent(entry)}`;
}

export function mergePeople(
  lists: SignInLists,
  sessions: Array<{ email?: string; lastSeenAt: number }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null; estimatedUsd?: number | null }>,
): Person[] {
  const people: Person[] = [];
  const seen = new Set<string>();
  const add = (entry: string, role: Role) => {
    const key = entry.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const devices = sessions.filter((session) => session.email?.toLowerCase() === key);
    const month = usage.find((group) => group.key === `user:${key}`);
    people.push({
      entry: key,
      role,
      isDomain: key.startsWith("@"),
      lastSeenAt: devices.length ? Math.max(...devices.map((session) => session.lastSeenAt)) : null,
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
      ...(hasFiniteCost(month?.estimatedUsd) && month.estimatedUsd > 0 ? { estimated: true } : {}),
    });
  };
  for (const entry of lists.admins) add(entry, "admin");
  for (const entry of lists.members) add(entry, "member");
  return people;
}

export function peopleFromSessions(
  sessions: Array<{ email?: string; lastSeenAt: number; scopes?: string[] }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null }>,
): Person[] {
  const byEmail = new Map<string, Array<{ lastSeenAt: number; scopes?: string[] }>>();
  for (const session of sessions) {
    const email = session.email?.trim().toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), session]);
  }
  return [...byEmail.entries()].map(([entry, devices]) => {
    const month = usage.find((group) => group.key === `user:${entry}`);
    return {
      entry,
      role: devices.some((device) => device.scopes?.includes("admin")) ? "admin" : "member",
      isDomain: false,
      lastSeenAt: Math.max(...devices.map((device) => device.lastSeenAt)),
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
    } satisfies Person;
  }).sort((a, b) => (a.role === b.role ? a.entry.localeCompare(b.entry) : a.role === "admin" ? -1 : 1));
}

export function lastSeenLabel(lastSeenAt: number | null, now = Date.now()): string {
  if (lastSeenAt === null) return t("people.never");
  if (now - lastSeenAt < 24 * 60 * 60_000) return t("people.today");
  return new Date(lastSeenAt).toISOString().slice(0, 10);
}

/** Each person as a panel row: who, their role, last seen and this month's spend as one quiet line, and their actions. */
export function PeopleTable({ people, busy, onRole, onRemove, onLink, readOnly = false }: {
  people: Person[];
  busy: boolean;
  onRole: (person: Person, role: Role) => void;
  onRemove: (person: Person) => void;
  onLink: (person: Person) => void;
  readOnly?: boolean;
}) {
  if (people.length === 0) return <NoteRow>{t(readOnly ? "people.portal.empty" : "people.empty")}</NoteRow>;
  return (
    <>
      {people.map((person) => {
        const spend = hasFiniteCost(person.costUsd) ? `${person.estimated ? "~" : ""}${formatUsd(person.costUsd)}` : "-";
        const hint = [
          person.role === "admin" ? t("people.roleAdmin") : t("people.roleMember"),
          person.isDomain ? "" : `${t("people.colLastSeen")} ${lastSeenLabel(person.lastSeenAt)}`,
          `${t("people.colMonth")} ${spend}`,
          person.devices > 0 ? t("people.devices", { count: String(person.devices) }) : "",
        ].filter(Boolean).join(" · ");
        return (
          <ItemRow key={person.entry} title={person.isDomain ? t("people.everyoneAt", { domain: person.entry.slice(1) }) : person.entry} hint={<span title={t("people.turns", { turns: String(person.turns) })}>{hint}</span>}>
            {!readOnly && <>
              <button type="button" disabled={busy} onClick={() => onLink(person)} aria-label={t("people.link")} title={t("people.link")}
                className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-secondary hover:bg-ink/[0.035] hover:text-ink disabled:opacity-45"><Link2 size={13} aria-hidden="true" /></button>
              <button type="button" disabled={busy} onClick={() => onRole(person, person.role === "admin" ? "member" : "admin")} className="ui-button">
                {person.role === "admin" ? t("people.makeMember") : t("people.makeAdmin")}
              </button>
              <button type="button" disabled={busy} onClick={() => onRemove(person)} className="ui-button text-danger">{t("people.remove")}</button>
            </>}
          </ItemRow>
        );
      })}
    </>
  );
}

/** The invite link, as the one copyable row. */
export function CopyLink({ link }: { link: string }) {
  return <CopyRow title={t("people.link")} text={link} />;
}

export function PortalPeople({ peopleUrl, people }: { peopleUrl: string | null; people: Person[] }) {
  const noop = () => {};
  return (
    <div data-people-portal="" className="contents">
      <NoteRow>{t("people.portal.managed")}</NoteRow>
      {peopleUrl && (
        <a href={peopleUrl} target="_blank" rel="noopener noreferrer" className={cn(rowCls, "cursor-pointer text-[13px] leading-[18px] text-ink hover:bg-ink/[0.035]")}>
          <span className="min-w-0 flex-1">{t("people.portal.open")}</span>
          <ExternalLink size={12} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        </a>
      )}
      <PeopleTable people={people} busy={false} readOnly onRole={noop} onRemove={noop} onLink={noop} />
      <NoteRow>{t("people.portal.note")}</NoteRow>
    </div>
  );
}

export function PeopleSection() {
  const [inviting, setInviting] = useState(false);
  const [tried, setTried] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [lists, setLists] = useState<SignInLists | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [base, setBase] = useState<string>(typeof window !== "undefined" ? window.location.origin : "");
  const [emailOffered, setEmailOffered] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [config, sessions, usage, domain, environment] = await Promise.all([
        api("/api/config"),
        api("/api/auth/sessions").catch(() => ({ sessions: [] })),
        api("/api/usage?groupBy=user").catch(() => ({ groups: [] })),
        api("/api/settings/custom-domain").catch(() => null),
        fetch("/.well-known/openmausbot/environment").then((res) => (res.ok ? res.json() : null)).catch(() => null),
      ]);
      const current: SignInLists = {
        admins: Array.isArray(config?.signIn?.admins) ? config.signIn.admins : [],
        members: Array.isArray(config?.signIn?.members) ? config.signIn.members : [],
      };
      const authority = readMembership(config);
      setMembership(authority);
      setLists(current);
      const signedIn = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
      const spent = Array.isArray(usage?.groups) ? usage.groups : [];
      setPeople(authority.authority === "portal" ? peopleFromSessions(signedIn, spent) : mergePeople(current, signedIn, spent));
      if (typeof domain?.publicUrl === "string" && domain.publicUrl) setBase(domain.publicUrl);
      setEmailOffered(environment?.capabilities?.emailSignIn === true ? true : environment ? false : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void readSessionState().then((state) => {
      setSession(state);
      if (canPairDevices(state)) void load();
    });
  }, [load]);

  const save = async (next: SignInLists) => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify({ signIn: next }) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const invite = async (): Promise<boolean> => {
    setTried(true);
    if (!lists || busy) return false;
    const entry = normalizeAccessEntry(draft);
    if (!entry) {
      setError(t("remote.signInAccess.invalid"));
      return false;
    }
    await save(withEntry(lists, entry, role));
    setDraft("");
    setLink(inviteLink(base, entry));
    return true;
  };

  if (!canPairDevices(session)) return null;
  if (membership?.authority === "portal") return <PortalPeople peopleUrl={membership.peopleUrl} people={people} />;
  return (
    <div data-people-summary="" className="contents">
      {emailOffered === false && tried && <NoteRow tone="warn">{t(membership?.pairingCodes === false ? "people.portalSignIn" : "people.notHosted")}</NoteRow>}
      <ItemRow title={t("people.title")} hint={t("settings.simple.people")}>
        <button type="button" onClick={() => void load()} disabled={loading || busy} className="ui-button">{t("people.refresh")}</button>
        <button type="button" data-settings-open="people-invite" disabled={busy} className="ui-button" onClick={() => { setError(null); setInviting(true); }}>{t("settings.simple.people.invite")}</button>
      </ItemRow>
      {link && <CopyLink link={link} />}
      {error && !inviting && <NoteRow tone="danger">{error}</NoteRow>}
      <PeopleTable
        people={people}
        busy={busy}
        onRole={(person, next) => { if (lists) void save(withEntry(lists, person.entry, next)); }}
        onRemove={(person) => { if (lists) void save(withoutEntry(lists, person.entry)); }}
        onLink={(person) => setLink(inviteLink(base, person.entry))}
      />
      {inviting && (
        <FormDialog data-panel-modal="people-invite" title={t("settings.simple.people.invite")} description={t("people.inviteHint")}
          saveLabel={t("people.invite")} canSave={Boolean(draft.trim())} busy={busy} error={error ?? undefined}
          onSave={async () => { if (await invite()) setInviting(false); }} onClose={() => setInviting(false)}>
          <FormField label={t("people.inviteEmail")}>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("remote.signInAccess.placeholder")} disabled={busy} className={textFieldCls} />
          </FormField>
          <div className="-mx-2 flex flex-col">
            <SettingRow title={t("people.colRole")}>
              <SettingsSelect data-settings-select="people-role" aria-label={t("people.colRole")} value={role} disabled={busy}
                options={[{ value: "member", label: t("people.roleMember") }, { value: "admin", label: t("people.roleAdmin") }]}
                onChange={(e) => setRole(e.target.value as Role)} />
            </SettingRow>
          </div>
        </FormDialog>
      )}
    </div>
  );
}
