import { useEffect, useState } from "react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { Card as RowsCard, CopyRow, FormDialog, FormField, ItemRow, NavRow, NoteRow } from "./ListRows";
import { textFieldCls } from "./ui/GrokDialog";

export interface CustomDomainStatus {
  publicUrl: string | null;
  customDomain: string | null;
  fallbackUrl: string | null;
  supported: boolean;
  appPort: number;
  webhookPort: number;
  serverIpv4?: string | null;
}

/** Preview only; the server validates. Keep the full DNS name rather than guessing a provider's zone (co.uk). */
export function customDomainDnsName(raw: string): string | null {
  const value = raw.trim();
  if (!value || /[\s\\?#@%]/.test(value)) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const host = url.hostname.replace(/\.$/, "");
    if (url.protocol !== "https:" || url.port || url.pathname !== "/" || !host.includes(".")
      || host.length > 253 || /^[\d.]+$/.test(host)
      || !host.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
      || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host)) return null;
    return host;
  } catch { return null; }
}

export function CustomDomainDnsRecord({ domain, serverIpv4 }: { domain: string; serverIpv4?: string | null }) {
  const name = customDomainDnsName(domain);
  if (!name) return <NoteRow>{t("settings.domain.enterDomain")}</NoteRow>;
  const rows = [
    [t("settings.domain.recordType"), "A"],
    [t("settings.domain.recordName"), name],
    [t("settings.domain.recordValue"), serverIpv4],
  ] as const;
  return (
    <section aria-label={t("settings.domain.dnsRecord")} className="flex flex-col">
      {rows.map(([label, value]) => value
        ? <CopyRow key={label} title={label} text={value} copyLabel={t("settings.domain.copyField", { field: label })} />
        : <ItemRow key={label} title={label} hint={<span className="text-warning">{t("settings.domain.missingIp")}</span>} />)}
    </section>
  );
}

/** Security: a fixed placeholder, so a partially typed domain never becomes shell or Caddy configuration. */
export function customDomainProxyExample(status: Pick<CustomDomainStatus, "appPort" | "webhookPort">): string {
  return `bots.example.com {
    handle /hooks/* {
        reverse_proxy 127.0.0.1:${status.webhookPort}
    }
    handle {
        reverse_proxy 127.0.0.1:${status.appPort} {
            flush_interval -1
        }
    }
}`;
}

/** The server side of a custom domain, for whoever runs the server: DNS, HTTPS in front, then come back and connect. */
export function CustomDomainGuide({ status }: { status: CustomDomainStatus }) {
  return (
    <div data-domain-guide="" className="-mx-2 flex flex-col">
      <NoteRow>{t("settings.domain.dns")}</NoteRow>
      <NoteRow>{t("settings.domain.proxy")}</NoteRow>
      <CopyRow multiline title={t("settings.s2.domain.proxyConfig")} text={customDomainProxyExample(status)} />
      <NoteRow>{t("settings.domain.proxyHint")}</NoteRow>
      <NoteRow>{t("settings.domain.verifyHint")}</NoteRow>
      <NoteRow tone="warn">{t("settings.domain.loopbackWarning")}</NoteRow>
      {!status.serverIpv4 && <NoteRow>{t("settings.domain.ipAdminHint")}</NoteRow>}
      <NoteRow>{t("settings.domain.scope")}</NoteRow>
      <NavRow external title={t("settings.domain.fullGuide")} onClick={() => void openExternalLink(SELF_HOSTING_GUIDE)} />
    </div>
  );
}

const SELF_HOSTING_GUIDE = "https://github.com/milind-soni/OpenMausBot/blob/main/docs/self-hosting.md#connect-a-custom-domain-in-settings";

export function CustomDomainSettings() {
  const [status, setStatus] = useState<CustomDomainStatus | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<"loading" | "saving" | "removing" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api("/api/settings/custom-domain", { signal: controller.signal })
      .then((next: CustomDomainStatus) => {
        if (controller.signal.aborted) return;
        setStatus(next);
        setDomain(next.customDomain ?? "");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("settings.domain.failed"));
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, []);

  const save = async (remove: boolean): Promise<boolean> => {
    setBusy(remove ? "removing" : "saving");
    setError(null);
    setNotice(null);
    try {
      const next: CustomDomainStatus = await api("/api/settings/custom-domain", {
        method: remove ? "DELETE" : "POST",
        ...(remove ? {} : { body: JSON.stringify({ domain: domain.trim() }) }),
      });
      setStatus(next);
      setDomain(next.customDomain ?? "");
      setNotice(remove ? t("settings.domain.removed") : t("settings.domain.saved"));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.domain.failed"));
      return false;
    } finally { setBusy(null); }
  };

  if (status && !status.supported) return null;
  return (
    <RowsCard label={t("settings.domain.title")} data-settings-block="custom-domain">
      <div data-custom-domain-settings="" className="contents">
        {busy === "loading" && <NoteRow>{t("settings.domain.loading")}</NoteRow>}
        {status?.supported && (
          <>
            <NavRow data-settings-open="custom-domain" title={t("settings.domain.label")} hint={status.customDomain ? status.publicUrl ?? undefined : undefined}
              value={status.customDomain ?? t("settings.s2.domain.notSet")} onClick={() => { setError(null); setEditing(true); }} />
            {status.customDomain && (
              <ItemRow title={t("settings.domain.remove")} hint={status.fallbackUrl ? t("settings.domain.fallback", { url: status.fallbackUrl }) : t("settings.domain.noFallback")}>
                <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void save(true)}>{busy === "removing" ? t("settings.domain.removing") : t("settings.s2.remove")}</button>
              </ItemRow>
            )}
            <NavRow data-settings-open="domain-guide" title={t("settings.domain.guide")} hint={t("settings.s2.domain.guideHint")} onClick={() => setGuide(true)} />
          </>
        )}
        {notice && <NoteRow>{notice}</NoteRow>}
        {error && !editing && <NoteRow tone="danger">{error}</NoteRow>}
      </div>
      {editing && status?.supported && (
        <FormDialog data-panel-modal="custom-domain" title={t("settings.domain.title")} description={t("settings.domain.httpsNeeded")} width={460}
          saveLabel={busy === "saving" ? t("settings.domain.verifying") : t("settings.domain.verify")} canSave={Boolean(domain.trim())} busy={busy !== null}
          error={error ?? undefined} onSave={async () => { if (await save(false)) setEditing(false); }} onClose={() => setEditing(false)}>
          <FormField label={t("settings.domain.label")}>
            <input id="custom-domain" type="text" value={domain} disabled={busy !== null} onChange={(event) => { setDomain(event.target.value); setNotice(null); setError(null); }}
              placeholder="bots.yourcompany.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={textFieldCls} />
          </FormField>
          <div className="-mx-2"><CustomDomainDnsRecord domain={domain} serverIpv4={status.serverIpv4} /></div>
        </FormDialog>
      )}
      {guide && status && <FormDialog data-panel-modal="domain-guide" title={t("settings.domain.guide")} width={520} onClose={() => setGuide(false)}><CustomDomainGuide status={status} /></FormDialog>}
    </RowsCard>
  );
}
