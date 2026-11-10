import type { DeletionBlocker } from "../../../../shared/billing-api";
import { useEffect, useState } from "react";
import { Globe, Monitor, Smartphone } from "lucide-react";
import { ProviderMark } from "../ui/BrandMarks";
import { useCloud } from "../data/cloud";
import type { IdentityProvider, NotificationPrefs } from "../data/contracts";
import { useSession } from "../data/session";
import { api, ApiError } from "../lib/api";
import { API_DOCS, PHONE_WEB_APP } from "../lib/usage";
import { ago } from "../lib/format";
import { setTheme, useTheme, type ThemePref } from "../lib/theme";
import { Field, Modal, Switch } from "../ui/controls";
import { Button, ButtonLink, PageHeader, SectionTitle, Segmented, Skeleton } from "../ui/kit";
import { useNow } from "../lib/now";

const PROVIDERS: Array<{ id: IdentityProvider; label: string }> = [{ id: "google", label: "Google" }, { id: "apple", label: "Apple" }, { id: "x", label: "X" }, { id: "email", label: "Email" }];
const NOTIFICATIONS: Array<{ id: keyof NotificationPrefs; label: string; hint: string }> = [
  { id: "cloudStatus", label: "Cloud desktop status", hint: "When it is ready, goes to sleep or needs attention." },
  { id: "billing", label: "Billing", hint: "Receipts and payment problems." },
  { id: "botDigest", label: "Weekly bot digest", hint: "What your bots did this week." },
  { id: "product", label: "Product news", hint: "New features, a few times a year." },
];
const ICON = { size: 16, strokeWidth: 1.5 } as const;

export function AccountPage() {
  const cloud = useCloud();
  const { account } = cloud;
  const { setAccount, toast } = useSession();
  const now = useNow();
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<{ provider: IdentityProvider; message: string } | null>(null);
  const [deviceError, setDeviceError] = useState<{ id: string; message: string } | null>(null);
  const [confirm, setConfirm] = useState<"signout" | "delete" | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [blockers, setBlockers] = useState<DeletionBlocker[] | null>(null);
  const [destroyDesktopsNow, setDestroyDesktopsNow] = useState(false);
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationPrefs | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  useEffect(() => { if (account) setNotifications(account.notifications); }, [account?.notifications]);
  const saveProfile = async () => {
    if (!account) return;
    const next = name.trim();
    if (!next) { setProfileError("Enter your name."); return; }
    setBusy("profile"); setProfileError(null);
    try { await cloud.updateProfile(next); setAccount({ id: account.profile.id, email: account.profile.email, name: next }); setEditing(false); toast("Name updated"); }
    catch (e) { setProfileError((e as Error).message); }
    finally { setBusy(null); }
  };
  const unlink = async (provider: IdentityProvider) => {
    setBusy(`identity-${provider}`); setIdentityError(null);
    try { await cloud.unlinkIdentity(provider); toast("Sign-in method removed"); }
    catch (e) { setIdentityError({ provider, message: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const revoke = async (id: string) => {
    setBusy(`device-${id}`); setDeviceError(null);
    try { await cloud.revokeDevice(id); toast("Device signed out"); }
    catch (e) { setDeviceError({ id, message: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const toggle = async (id: keyof NotificationPrefs, checked: boolean) => {
    const previous = notifications ?? account?.notifications;
    if (!previous || notificationBusy) return;
    const next = { ...previous, [id]: checked };
    setNotifications(next); setNotificationBusy(true);
    try { await cloud.setNotifications(next); }
    catch (e) { setNotifications(previous); toast((e as Error).message, "bad"); }
    finally { setNotificationBusy(false); }
  };
  const finish = async () => {
    if (!confirm) return;
    setBusy(confirm); setConfirmError(null);
    try {
      if (confirm === "delete") await cloud.deleteAccount(confirmEmail, { cancelBilling: blockers !== null, destroyDesktopsNow });
      else await cloud.signOutEverywhere();
      setAccount(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "billing_active") { setBlockers(e.blockers); setConfirmError(null); }
      else setConfirmError((e as Error).message);
    }
    finally { setBusy(null); }
  };
  const close = () => { if (!busy) { setConfirm(null); setConfirmError(null); setConfirmEmail(""); setBlockers(null); setDestroyDesktopsNow(false); setConfirmDestroy(false); } };
  if (!account) return <div className="max-w-[640px]"><PageHeader title="Account" />{cloud.error ? <section><p role="alert" className="text-13 text-bad">Could not load your account. {cloud.error}</p><Button className="mt-4" size="sm" onClick={cloud.refresh}>Retry</Button></section> : <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading account"><Skeleton className="h-52 !rounded-card" /><Skeleton className="h-64 !rounded-card" /><Skeleton className="h-60 !rounded-card" /></div>}</div>;
  const profile = account.profile;
  const displayName = profile.name || profile.email.split("@")[0] || profile.email;
  const prefs = notifications ?? account.notifications;
  return <div className="min-w-0 max-w-[640px]">
    <PageHeader title="Account" />
    <section aria-labelledby="profile-title">
      <SectionTitle id="profile-title">Profile</SectionTitle>
      <div className="divide-y divide-line">
        <div className="flex min-w-0 items-center gap-3 py-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-card-2 text-14 font-medium uppercase text-ink-2" aria-hidden>{displayName.slice(0, 1)}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-14 font-medium text-ink">{displayName}</p><p className="truncate text-13 text-ink-3">{profile.email}</p></div>
          {!editing && <Button size="sm" variant="ghost" className="-me-3.5" onClick={() => { setName(profile.name ?? ""); setProfileError(null); setEditing(true); }}>Edit name</Button>}
        </div>
        {editing && <form className="py-3" onSubmit={(e) => { e.preventDefault(); void saveProfile(); }}><Field label="Name" htmlFor="profile-name" error={profileError}><input id="profile-name" className="field" maxLength={100} value={name} autoFocus disabled={busy !== null} aria-invalid={Boolean(profileError)} onChange={(e) => setName(e.target.value)} /></Field><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" type="submit" variant="primary" disabled={busy !== null}>{busy === "profile" ? "Saving" : "Save"}</Button><Button size="sm" variant="ghost" className="-me-3.5" disabled={busy !== null} onClick={() => setEditing(false)}>Cancel</Button></div></form>}
      </div>
    </section>
    <section className="mt-10" aria-labelledby="sign-in-title">
      <SectionTitle id="sign-in-title">Sign-in methods</SectionTitle>
      <ul className="divide-y divide-line">{PROVIDERS.map((provider) => {
        const identity = account.identities.find((item) => item.provider === provider.id);
        const last = account.identities.length <= 1;
        return <li key={provider.id} className="py-3"><div className="flex items-center gap-3"><span className="shrink-0 text-ink-3" aria-hidden><ProviderMark provider={provider.id} size={16} /></span><div className="min-w-0 flex-1"><p className="text-14 text-ink">{provider.label}</p>{identity && <p className="truncate text-13 text-ink-3">{identity.label}</p>}</div>{identity ? <Button size="sm" variant="ghost" className="-me-3.5" disabled={last || busy !== null} title={last ? "Keep at least one sign-in method so you can access your account." : undefined} onClick={() => void unlink(provider.id)}>{busy === `identity-${provider.id}` ? "Removing" : "Remove"}</Button> : provider.id === "email" ? <span className="text-13 text-ink-4">Always on</span> : <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => window.location.assign(api.oauthUrl(provider.id, "signin"))}>Link</Button>}</div>{identityError?.provider === provider.id && <p role="alert" className="mt-2 text-13 text-bad">{identityError.message}</p>}</li>;
      })}</ul>
    </section>
    <section id="devices" className="mt-10 scroll-mt-20">
      <SectionTitle>Devices</SectionTitle>
      {account.devices.length ? <ul className="divide-y divide-line">{account.devices.map((device) => {
        const Icon = device.kind === "desktop" ? Monitor : device.kind === "phone" ? Smartphone : Globe;
        return <li key={device.id} className="py-3"><div className="flex flex-wrap items-center gap-3"><Icon {...ICON} className="shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><p className="truncate text-14 text-ink">{device.label}</p><p className="text-13 text-ink-3">{[device.platform, device.current ? "Active now" : `Last active ${ago(device.lastSeenAt, now)}`].filter(Boolean).join(" · ")}</p></div>{device.current ? <span className="text-13 text-ink-3">This device</span> : <Button size="sm" variant="ghost" className="-me-3.5" disabled={busy !== null} onClick={() => void revoke(device.id)}>{busy === `device-${device.id}` ? "Revoking" : "Revoke"}</Button>}</div>{deviceError?.id === device.id && <p role="alert" className="mt-2 text-13 text-bad">{deviceError.message}</p>}</li>;
      })}</ul> : <p className="text-14 text-ink-3">No devices reported yet.</p>}
      <p className="mt-4 text-13 text-ink-3">{PHONE_WEB_APP}</p>
      <Button variant="ghost" className="-ms-4 mt-4" disabled={busy !== null} onClick={() => { setConfirmError(null); setConfirm("signout"); }}>Sign out everywhere</Button>
    </section>
    <section className="mt-10" aria-labelledby="notifications-title">
      <SectionTitle id="notifications-title">Notifications</SectionTitle>
      <ul className="divide-y divide-line">{NOTIFICATIONS.map((item) => <li key={item.id} className="flex items-center gap-4 py-3"><div className="min-w-0 flex-1"><label htmlFor={`notification-${item.id}`} className="text-14 text-ink">{item.label}</label><p className="mt-0.5 text-13 text-ink-3">{item.hint}</p></div><Switch id={`notification-${item.id}`} label={item.label} checked={prefs[item.id]} disabled={notificationBusy} onChange={(checked) => void toggle(item.id, checked)} /></li>)}</ul>
    </section>
    <section className="mt-10" aria-labelledby="appearance-title">
      <SectionTitle id="appearance-title">Appearance</SectionTitle>
      <div className="divide-y divide-line"><div className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="text-14 text-ink">Theme</span><Segmented<ThemePref> label="Theme" value={theme} onChange={setTheme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} /></div></div>
    </section>
    <section className="mt-10" aria-labelledby="api-title">
      <SectionTitle id="api-title">Developers</SectionTitle>
      <p className="text-14 text-ink-3">Drive your bots from your own scripts with the bot API. <a href={API_DOCS} target="_blank" rel="noreferrer" className="hover-link text-ink-2 underline decoration-line-2 underline-offset-4">Read the API docs</a></p>
    </section>
    <section className="mt-10" aria-labelledby="download-title">
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-3"><div className="min-w-0 flex-1"><SectionTitle id="download-title">Download your data</SectionTitle><p className="text-13 text-ink-3">A copy of your account, sign-ins, devices, workspaces, cloud desktops and plans as a JSON file.</p></div><Button onClick={() => window.location.assign("/v1/account/export")}>Download</Button></div>
    </section>
    <section className="mt-10" aria-labelledby="delete-title">
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-3"><div className="min-w-0 flex-1"><SectionTitle id="delete-title">Delete account</SectionTitle><p className="text-13 text-ink-3">Close your account and remove its workspaces from the dashboard.</p></div><Button variant="danger" disabled={busy !== null} onClick={() => { setConfirmError(null); setConfirmEmail(""); setConfirm("delete"); }}>Delete account</Button></div>
    </section>
    <Modal open={confirm !== null} onClose={close} title={confirm === "delete" ? "Delete your account?" : "Sign out everywhere?"} footer={<><Button disabled={busy !== null} onClick={close}>Cancel</Button><Button variant={confirm === "delete" ? "danger" : "primary"} disabled={busy !== null || confirm === "delete" && (confirmEmail !== profile.email || destroyDesktopsNow && !confirmDestroy)} onClick={() => void finish()}>{busy === "delete" ? "Deleting" : busy === "signout" ? "Signing out" : confirm === "delete" ? blockers !== null ? "Cancel everything and delete" : "Delete account" : "Sign out everywhere"}</Button></>}>
      {confirm === "delete" ? <><p>This permanently deletes your account, signs out every device and removes your workspaces from the dashboard. Active plans and cloud desktops must be cancelled before deletion can finish.</p><div className="mt-4"><Field label="Type your email to confirm" htmlFor="delete-email"><input id="delete-email" type="email" className="field" value={confirmEmail} disabled={busy !== null} autoComplete="off" onChange={(e) => setConfirmEmail(e.target.value)} /></Field></div></> : <p>Every app and browser signs out, this one too.</p>}
      {confirm === "delete" && blockers !== null && <div className="mt-4 space-y-3 text-13">
        <p role="alert">Cancel your plan and cloud desktops before deleting your account.</p>
        <ul className="list-disc pl-5">{blockers.map(blocker => <li key={`${blocker.kind}-${blocker.id}`}>{blocker.label} ({blocker.status.replaceAll("_", " ")})</li>)}</ul>
        <ButtonLink to="/billing" size="sm">Plans &amp; billing</ButtonLink>
        <p>Cancelling turns off renewal. Cloud desktops are kept until the paid period ends plus the grace period, unless you delete them now.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={destroyDesktopsNow} disabled={busy !== null} onChange={e => { setDestroyDesktopsNow(e.target.checked); setConfirmDestroy(false); }} />Delete my cloud desktops now</label>
        {destroyDesktopsNow && <label className="flex items-start gap-2 text-bad"><input type="checkbox" checked={confirmDestroy} disabled={busy !== null} onChange={e => setConfirmDestroy(e.target.checked)} />Your cloud desktops and everything on them are deleted at once. This cannot be undone.</label>}
      </div>}
      {confirmError && <p role="alert" className="mt-3 text-13 text-bad">{confirmError}</p>}
    </Modal>
  </div>;
}
