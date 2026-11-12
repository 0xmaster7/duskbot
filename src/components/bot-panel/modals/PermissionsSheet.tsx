import { useEffect, useState } from "react";

import { approvalModeOptionsFor, approvalModeSelectionRequiresLocalDesktop, shownApprovalMode } from "@/lib/approval-mode-options";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useStore, type Bot } from "@/state/store";
import { useTeamPeople } from "@/state/team-people";
import type { ApprovalMode } from "../../../../shared/approval-mode";
import { effectiveOutboundPolicy, type OutboundPolicy } from "../../../../shared/outbound";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { CommandAllowlistDialog } from "../../CommandAllowlistDialog";
import { LocalComputerAutoWarning } from "../../LocalComputerAutoWarning";
import { Card, CheckRow, FormDialog, FormField, NavRow, NoteRow, pillCls, SelectRow, SwitchRow, useSubPage } from "../../ListRows";
import { textFieldCls } from "../../ui/GrokDialog";

type Derived = ReturnType<typeof useBotSettingsDerived>;

/** Chief of Staff and the departments it also leads, contact with other bots, the approval level and sending, as rows. */
export function PermissionsSheet({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { patch, engine, canCoordinate, approvalMode, trustedModesAvailable, sectionName } = derived;
  const { state, dispatch } = useStore();
  const { at, open } = useSubPage();
  const team = useTeamPeople();
  const ownerOrAdmin = useOwnerOrAdmin();
  const [localAutoWarning, setLocalAutoWarning] = useState<string | null>(null);
  const [allowlistOpen, setAllowlistOpen] = useState(false);
  const section = sectionName === "General" ? t("botPanel.ui.botAccessTeamsGeneral") : sectionName;
  const driverKind = engine?.driverKind ?? "";
  const applyFullEverywhere = () => dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: "full", applyToAllThreads: true } });
  const setApprovalMode = (mode: ApprovalMode) => {
    if (mode === approvalMode) return;
    if (mode === "full") applyFullEverywhere();
    else if (mode === "auto" && bot.computer === "local") setLocalAutoWarning(bot.id);
    else patch({ approvalMode: mode });
  };
  const peerNames = Array.isArray(bot.peers) ? bot.peers.flatMap((id) => state.bots.find((other) => other.id === id && !other.hidden)?.name ?? []) : null;
  const led = bot.managedSections?.length ?? 0;

  if (at === "teams" && !team && bot.chiefOfStaff) {
    return (
      // a saved change remounts the list, so another bot's old selection can never be saved from it
      <ChiefTeams
        key={bot.id + JSON.stringify(bot.managedSections ?? [])}
        ownTeam={bot.section?.trim() || ""}
        teams={["", ...(state.sections ?? []), ...[...state.bots, ...state.groups].map((member) => member.section?.trim() || "")]}
        allowed={bot.managedSections ?? []}
        onSave={(managedSections) => patch({ managedSections, acknowledgePeerScope: true })}
      />
    );
  }

  return (
    <>
      {!team && (
        <Card label={t("botPanel.ui.permissionsChiefTitle")} data-sheet-group="chief">
          <SwitchRow
            title={t("botPanel.sheet.chiefRow", { section })}
            hint={canCoordinate ? undefined : t("botPanel.sheet.chiefNoModel")}
            label={t("botPanel.ui.permissionsChiefTitle")}
            checked={Boolean(bot.chiefOfStaff)}
            disabled={!bot.chiefOfStaff && !canCoordinate}
            onChange={() => patch({ chiefOfStaff: !bot.chiefOfStaff })}
          />
          {bot.chiefOfStaff && (
            <NavRow
              data-sheet-row="chief-teams"
              title={t("botPanel.ui.botAccessTeamsTitle")}
              value={led ? t("botPanel.sheet.chosen", { count: led }) : t("botPanel.none")}
              onClick={() => open("teams", t("botPanel.ui.botAccessTeamsTitle"))}
            />
          )}
        </Card>
      )}

      <Card label={t("botPanel.sheet.peers")} data-sheet-group="peers">
        <SwitchRow
          title={t("botPanel.sheet.peersRow")}
          label={t("botPanel.ui.permissionsPeersTitle")}
          checked={Boolean(bot.approvePeerComms)}
          disabled={!bot.approvePeerComms && !canCoordinate}
          onChange={() => patch({ approvePeerComms: !bot.approvePeerComms })}
        />
        {peerNames && (
          <NavRow
            drill={false}
            data-sheet-row="peers-only"
            title={peerNames.length ? t("botPanel.sheet.peersOnly", { names: peerNames.join(", ") }) : t("permissions.peers.none")}
            value={t("botPanel.sheet.allowAll")}
            onClick={() => patch({ peers: null, acknowledgePeerScope: true })}
          />
        )}
      </Card>

      <Card label={t("botPanel.ui.permissionsApprovalTitle")} data-sheet-group="approval">
        <SelectRow
          data-sheet-row="approval"
          title={t("botPanel.sheet.approvalRow")}
          label={t("botPanel.ui.permissionsApprovalTitle")}
          disabled={Boolean(bot.busy) || approvalModeSelectionRequiresLocalDesktop(approvalMode, trustedModesAvailable)}
          value={shownApprovalMode(driverKind, approvalMode)}
          options={approvalModeOptionsFor(driverKind, trustedModesAvailable).map((option) => ({ value: option.mode, label: option.label }))}
          onChange={setApprovalMode}
        />
        {approvalMode === "full" && (
          <NavRow drill={false} data-sheet-row="full-everywhere" title={t("botPanel.sheet.fullEverywhere")} value={t("botPanel.sheet.apply")} onClick={applyFullEverywhere} />
        )}
        {ownerOrAdmin === true && <NavRow data-sheet-row="allowlist" title={t("botPanel.sheet.allowlist")} onClick={() => setAllowlistOpen(true)} />}
      </Card>

      <Sending key={bot.id} bot={bot} fullAccess={approvalMode === "full"} onChange={(outbound) => patch({ outbound })} />

      {allowlistOpen && <CommandAllowlistDialog key={`command-allowlist:${bot.id}`} botId={bot.id} botName={bot.name} onClose={() => setAllowlistOpen(false)} />}
      <LocalComputerAutoWarning
        open={localAutoWarning !== null}
        onCancel={() => setLocalAutoWarning(null)}
        onConfirm={() => {
          const target = localAutoWarning;
          setLocalAutoWarning(null);
          if (target) dispatch({ type: "updateBot", botId: target, patch: { approvalMode: "auto", acknowledgeLocalAuto: true } });
        }}
      />
    </>
  );
}

function ChiefTeams({ ownTeam, teams, allowed, onSave }: {
  ownTeam: string;
  teams: string[];
  allowed: string[];
  onSave: (teams: string[]) => void;
}) {
  const [selected, setSelected] = useState(allowed);
  const choices = [...new Set([...teams, ...allowed])].filter((team) => team !== ownTeam).sort();
  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...allowed].sort());
  return (
    <>
      <Card data-sheet-group="chief-teams">
        {choices.length === 0 && <NoteRow>{t("botAccess.teams.empty")}</NoteRow>}
        {choices.map((team) => {
          const name = team === "General" || !team ? t("botPanel.ui.botAccessTeamsGeneral") : team;
          return (
            <CheckRow
              key={team}
              aria-label={name}
              title={name}
              checked={selected.includes(team)}
              onClick={() => setSelected((current) => (current.includes(team) ? current.filter((value) => value !== team) : [...current, team]))}
            />
          );
        })}
      </Card>
      {choices.length > 0 && (
        <div className="-mt-2.5 flex items-center justify-end gap-3 px-3">
          <span className="mr-auto text-[12px] leading-4 tracking-[0.01em] text-ink-secondary">{changed ? t("botPanel.sheet.unsaved") : t("botPanel.sheet.chosen", { count: selected.length })}</span>
          <button type="button" aria-label={t("botPanel.ui.botAccessTeamsSave")} disabled={!changed} onClick={() => onSave(selected)} className={pillCls}>{t("botPanel.sheet.save")}</button>
        </div>
      )}
    </>
  );
}

function Sending({ bot, fullAccess, onChange }: { bot: Bot; fullAccess: boolean; onChange: (policy: OutboundPolicy) => void }) {
  const policy = effectiveOutboundPolicy(bot.outbound, fullAccess);
  const [today, setToday] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/bots/${bot.id}/outbound`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { today?: number } | null) => {
        if (alive && typeof body?.today === "number") setToday(body.today);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bot.id, bot.outbound]);

  return (
    <Card label={t("botPanel.ui.permissionsOutboundTitle")} data-sheet-group="sending">
      <SelectRow
        data-sheet-row="sending"
        title={t("botPanel.sheet.sendingRow")}
        label={t("botPanel.ui.permissionsOutboundTitle")}
        value={policy.policy}
        options={[{ value: "ask", label: t("botPanel.ui.permissionsOutboundAsk") }, { value: "allow", label: t("botPanel.ui.permissionsOutboundAllow") }]}
        onChange={(value) => onChange({ policy: value, dailyCap: policy.dailyCap })}
      />
      {policy.policy === "allow" && (
        <NavRow
          data-sheet-row="per-day"
          title={t("botPanel.sheet.perDay")}
          hint={today === null ? undefined : t("permissions.outbound.usedToday", { today, cap: policy.dailyCap })}
          value={String(policy.dailyCap)}
          onClick={() => setEditing(true)}
        />
      )}
      {editing && <DailyCapDialog cap={policy.dailyCap} onClose={() => setEditing(false)} onSave={(dailyCap) => { onChange({ policy: policy.policy, dailyCap }); setEditing(false); }} />}
    </Card>
  );
}

function DailyCapDialog({ cap, onSave, onClose }: { cap: number; onSave: (cap: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(String(cap));
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000;
  return (
    <FormDialog data-panel-modal="per-day" title={t("botPanel.sheet.perDay")} canSave={valid && parsed !== cap} onSave={() => onSave(parsed)} onClose={onClose}>
      <FormField label={t("botPanel.ui.permissionsOutboundDailyLimit")}>
        <input
          data-autofocus
          type="number"
          min={1}
          max={1000}
          value={value}
          aria-label={t("botPanel.ui.permissionsOutboundDailyLimit")}
          onChange={(event) => setValue(event.target.value)}
          className={`${textFieldCls} tabular-nums`}
        />
      </FormField>
    </FormDialog>
  );
}
