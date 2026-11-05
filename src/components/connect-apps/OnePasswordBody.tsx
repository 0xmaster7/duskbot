import { useState } from "react";

import { t } from "@/lib/i18n";
import { connectOnePassword, disconnectOnePassword, refreshOnePassword } from "@/lib/logins";
import type { OnePasswordStatus } from "../../../shared/logins";
import { KitActions, KitBody, KitButton, KitField, KitLink, KitStatus, KitText } from "./detail-kit";

/** 1Password on its Connect Apps page: a service account token for one vault, then the vaults it reaches. */
export function OnePasswordBody({ status, onChange, onManage }: {
  status: OnePasswordStatus | null;
  onChange: (status: OnePasswordStatus) => void;
  onManage: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"connect" | "refresh" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<OnePasswordStatus>) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      onChange(await work());
      if (kind === "connect") setToken("");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("settings.logins.onePassword.error"));
    } finally {
      setBusy(null);
    }
  };

  if (status === null) return <KitBody data-onepassword=""><KitStatus>{t("common.checking")}</KitStatus></KitBody>;
  return (
    <KitBody data-onepassword="">
      {status.connected ? (
        <>
          <KitText>{t("settings.logins.onePassword.connected", { vaults: (status.vaults ?? []).map((vault) => vault.title).join(", ") || "-", count: String(status.items ?? 0) })}</KitText>
          {status.error && <KitStatus tone="danger">{status.error}</KitStatus>}
          <KitActions>
            <KitButton variant="secondary" disabled={busy !== null} onClick={() => void run("refresh", refreshOnePassword)}>
              {busy === "refresh" ? t("common.checking") : t("settings.logins.onePassword.refresh")}
            </KitButton>
            <KitButton variant="secondary" tone="danger" disabled={busy !== null} onClick={() => void run("disconnect", disconnectOnePassword)}>
              {t("settings.logins.onePassword.disconnect")}
            </KitButton>
          </KitActions>
          <KitLink onClick={onManage}>{t("connectApps.onePassword.manage")}</KitLink>
        </>
      ) : (
        <form className="ca-kit" style={{ alignSelf: "stretch" }} onSubmit={(event) => {
          event.preventDefault();
          if (token.trim()) void run("connect", () => connectOnePassword(token.trim()));
        }}>
          <KitText>{t("settings.logins.onePassword.guide")}</KitText>
          <KitField label={t("settings.logins.onePassword.token")} name="onePasswordToken" type="password" autoComplete="off" spellCheck={false} maxLength={8192}
            value={token} disabled={busy !== null} onChange={(event) => setToken(event.target.value)} />
          <KitActions>
            <KitButton type="submit" disabled={busy !== null || !token.trim()}>
              {busy === "connect" ? t("connectApps.connecting") : t("settings.logins.onePassword.connect")}
            </KitButton>
          </KitActions>
        </form>
      )}
      {error && <KitStatus tone="danger">{error}</KitStatus>}
    </KitBody>
  );
}
