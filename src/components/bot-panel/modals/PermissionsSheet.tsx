import { useEffect, useState } from "react";

import { approvalModeOptionsFor, approvalModeSelectionRequiresLocalDesktop, shownApprovalMode } from "@/lib/approval-mode-options";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useStore, type Bot } from "@/state/store";
import { useTeamPeople } from "@/state/team-people";
import type { ApprovalMode } from "../../../../shared/approval-mode";
import { DEFAULT_OUTBOUND_POLICY, type OutboundPolicy } from "../../../../shared/outbound";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { CommandAllowlistDialog } from "../../CommandAllowlistDialog";
import { LocalComputerAutoWarning } from "../../LocalComputerAutoWarning";
import { Switch } from "../../SettingsPrimitives";
import { textFieldCls } from "../../ui/GrokDialog";
import { SelectPill } from "../../ui/SelectPill";
import { Group, LinkRow, Pill, Row } from "./sheet-kit";

type Derived = ReturnType<typeof useBotSettingsDerived>;

/** Chief of Staff and the departments it also leads, contact with other bots, the approval level and sending, as rows. */
export function PermissionsSheet({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { patch, engine, canCoordinate, approvalMode, trustedModesAvailable, sectionName } = derived;
  const { state, dispatch } = useStore();
  const team = useTeamPeople();
  const ownerOrAdmin = useOwnerOrAdmin();
  const [localAutoWarning, setLocalAutoWarning] = useState<string | null>(null);
  const [allowlistOpen, setAllowlistOpen] = useState(false);
  const section = sectionName === "General" ? t("botAccess.teams.general") : sectionName;
  const driverKind = engine?.driverKind ?? "";
  const applyFullEverywhere = () => dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: "full", applyToAllThreads: true } });
  const setApprovalMode = (mode: ApprovalMode) => {
    if (mode === approvalMode) return;
    if (mode === "full") applyFullEverywhere();
    else if (mode === "auto" && bot.computer === "local") setLocalAutoWarning(bot.id);
    else patch({ approvalMode: mode });
  };
  const peerNames = Array.isArray(bot.peers) ? bot.peers.flatMap((id) => state.bots.find((other) => other.id === id && !other.hidden)?.name ?? []) : null;

  return (
    <>
      {!team && (
        <Group label={t("permissions.chief.title")} data-sheet-group="chief">
          <Row
            title={t("botPanel.sheet.chiefRow", { section })}
            hint={canCoordinate ? undefined : t("botPanel.sheet.chiefNoModel")}
            tone={canCoordinate ? undefined : "warn"}
          >
            <Switch
              checked={Boolean(bot.chiefOfStaff)}
              aria-label={t("permissions.chief.title")}
              disabled={!bot.chiefOfStaff && !canCoordinate}
              onClick={() => patch({ chiefOfStaff: !bot.chiefOfStaff })}
            />
          </Row>
        </Group>
      )}
      {!team && bot.chiefOfStaff && (
        // a saved change remounts the list, so another bot's old selection can never be saved from it
        <ChiefTeams
          key={bot.id + JSON.stringify(bot.managedSections ?? [])}
          ownTeam={bot.section?.trim() || ""}
          teams={["", ...(state.sections ?? []), ...[...state.bots, ...state.groups].map((member) => member.section?.trim() || "")]}
          allowed={bot.managedSections ?? []}
          onSave={(managedSections) => patch({ managedSections, acknowledgePeerScope: true })}
        />
      )}

      <Group label={t("botPanel.sheet.peers")} data-sheet-group="peers">
        <Row title={t("botPanel.sheet.peersRow")}>
          <Switch
            checked={Boolean(bot.approvePeerComms)}
            aria-label={t("permissions.peers.title")}
            disabled={!bot.approvePeerComms && !canCoordinate}
            onClick={() => patch({ approvePeerComms: !bot.approvePeerComms })}
          />
        </Row>
        {peerNames && (
          <Row title={peerNames.length ? t("botPanel.sheet.peersOnly", { names: peerNames.join(", ") }) : t("permissions.peers.none")}>
            <Pill onClick={() => patch({ peers: null, acknowledgePeerScope: true })}>{t("botPanel.sheet.allowAll")}</Pill>
          </Row>
        )}
      </Group>

      <Group label={t("permissions.approval.title")} data-sheet-group="approval">
        <Row title={t("botPanel.sheet.approvalRow")}>
          <SelectPill
            aria-label={t("permissions.approval.title")}
            disabled={Boolean(bot.busy) || approvalModeSelectionRequiresLocalDesktop(approvalMode, trustedModesAvailable)}
            value={shownApprovalMode(driverKind, approvalMode)}
            options={approvalModeOptionsFor(driverKind, trustedModesAvailable).map((option) => ({ value: option.mode, label: option.label }))}
            onChange={setApprovalMode}
          />
        </Row>
        {approvalMode === "full" && (
          <Row title={t("botPanel.sheet.fullEverywhere")}>
            <Pill onClick={applyFullEverywhere}>{t("botPanel.sheet.apply")}</Pill>
          </Row>
        )}
        {ownerOrAdmin === true && <LinkRow data-sheet-row="allowlist" title={t("botPanel.sheet.allowlist")} onClick={() => setAllowlistOpen(true)} />}
      </Group>

      <Sending key={bot.id} bot={bot} onChange={(outbound) => patch({ outbound })} />

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
    <Group label={t("botAccess.teams.title")} data-sheet-group="chief-teams">
      {choices.length === 0 && <Row title={t("botAccess.teams.empty")} />}
      {choices.map((team) => {
        const name = team === "General" || !team ? t("botAccess.teams.general") : team;
        return (
          <label key={team} className="flex min-h-12 cursor-pointer items-center gap-5 px-3.5 py-2.5 text-[13px] leading-[18px] tracking-[-0.08px] text-ink">
            <span className="min-w-0 flex-1">{name}</span>
            <input
              type="checkbox"
              aria-label={name}
              className="size-4 shrink-0 cursor-pointer accent-[var(--color-ink)]"
              checked={selected.includes(team)}
              onChange={(event) => setSelected((current) => (event.target.checked ? [...current, team] : current.filter((value) => value !== team)))}
            />
          </label>
        );
      })}
      {choices.length > 0 && (
        <Row title={changed ? t("botPanel.sheet.unsaved") : t("botPanel.sheet.chosen", { count: selected.length })}>
          <Pill aria-label={t("botAccess.teams.save")} disabled={!changed} onClick={() => onSave(selected)}>{t("botPanel.sheet.save")}</Pill>
        </Row>
      )}
    </Group>
  );
}

function Sending({ bot, onChange }: { bot: Bot; onChange: (policy: OutboundPolicy) => void }) {
  const policy = bot.outbound ?? DEFAULT_OUTBOUND_POLICY;
  const [today, setToday] = useState<number | null>(null);
  const [cap, setCap] = useState(String(policy.dailyCap));

  useEffect(() => setCap(String(policy.dailyCap)), [policy.dailyCap]);
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

  const commit = () => {
    const parsed = Number(cap);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) setCap(String(policy.dailyCap));
    else if (parsed !== policy.dailyCap) onChange({ policy: policy.policy, dailyCap: parsed });
  };

  return (
    <Group label={t("permissions.outbound.title")} data-sheet-group="sending">
      <Row title={t("botPanel.sheet.sendingRow")}>
        <SelectPill
          aria-label={t("permissions.outbound.title")}
          value={policy.policy}
          options={[{ value: "ask", label: t("permissions.outbound.ask") }, { value: "allow", label: t("permissions.outbound.allow") }]}
          onChange={(value) => onChange({ policy: value, dailyCap: policy.dailyCap })}
        />
      </Row>
      {policy.policy === "allow" && (
        <Row title={t("botPanel.sheet.perDay")} hint={today === null ? undefined : t("permissions.outbound.usedToday", { today, cap: policy.dailyCap })}>
          <input
            type="number"
            min={1}
            max={1000}
            value={cap}
            aria-label={t("permissions.outbound.dailyLimit")}
            onChange={(event) => setCap(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className={`${textFieldCls} w-20 text-right tabular-nums`}
          />
        </Row>
      )}
    </Group>
  );
}
