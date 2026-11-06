import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { responderShortLabel } from "@/lib/room-responder";
import { StoreContext, useStore, type Action, type Bot, type Group } from "@/state/store";
import { sameModelSelection } from "../../../shared/thread-model";
import { groupUsageSummary } from "../GroupUsageChip";
import { useBulletinEditor } from "../RoomBulletin";
import { roomWorkingFolder } from "../RoomWorkingFolder";
import { ModelSelectRow } from "../native/ModelSelectRow";
import { UsageMeterRow } from "../native/UsageMeter";
import { buttonCls, Card, ColRow, ItemRow, NavRow, PanelSections, rowCls, RowText } from "../bot-panel/rows";

export type RoomPage = "responder" | "folder" | "models";

export function InstructionsRow({ group }: { group: Group }) {
  const bulletin = useBulletinEditor(group);
  const editRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (bulletin.open || !refocus.current) return;
    refocus.current = false;
    editRef.current?.focus();
  }, [bulletin.open]);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) refocus.current = true;
    bulletin.onKeyDown(event);
  };

  if (bulletin.open) {
    return (
      <ColRow data-panel-row="instructions">
        <RowText title={t("room.panel.instructions")} />
        <textarea
          autoFocus
          dir="auto"
          aria-label={t("room.panel.instructions")}
          value={bulletin.draft}
          onChange={(event) => bulletin.setDraft(event.target.value)}
          onBlur={bulletin.save}
          onKeyDown={onKeyDown}
          placeholder={t("room.bulletin.placeholder")}
          rows={6}
          className="w-full resize-y rounded-lg border border-hairline bg-inset px-2.5 py-2 text-[13px] leading-[18px] tracking-[0.015em] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent-border"
        />
        <div className="flex justify-end">
          <button
            type="button"
            data-panel-done="instructions"
            // keeps the field focused, so its blur does not save before Done does
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              refocus.current = true;
              bulletin.save();
            }}
            className={buttonCls}
          >
            {t("botSettings.simple.done")}
          </button>
        </div>
      </ColRow>
    );
  }
  const firstLine = group.bulletin.split("\n")[0]?.trim();
  return (
    <button
      ref={editRef}
      type="button"
      data-panel-edit="instructions"
      aria-label={`${t("botSettings.simple.edit")}: ${t("room.panel.instructions")}`}
      onClick={bulletin.start}
      className={cn(rowCls, "w-full text-left hover:bg-ink/[0.06]")}
    >
      <RowText
        title={t("room.panel.instructions")}
        hint={<span dir="auto" className="line-clamp-1">{firstLine || t("room.panel.instructionsHint")}</span>}
      />
      <ChevronRight size={14} className="-mr-0.5 shrink-0 text-ink-tertiary" aria-hidden="true" />
    </button>
  );
}

export interface RoomRowsProps {
  group: Group;
  members: Bot[];
  onOpen: (page: RoomPage) => void;
  onMembers: () => void;
  membersRef: Ref<HTMLButtonElement>;
}

/** Who answers, where the bots work, the room's brief and who is in it: the rows both Details and Advanced lead with. */
export function RoomRows({ group, members, onOpen, onMembers, membersRef }: RoomRowsProps) {
  const folder = roomWorkingFolder(group);
  return (
    <>
      <NavRow
        data-panel-page="responder"
        title={t("room.panel.whoResponds")}
        value={responderShortLabel(group, members)}
        onClick={() => onOpen("responder")}
      />
      <NavRow
        data-panel-page="folder"
        title={t("room.folder.title")}
        value={folder?.name ?? t("room.panel.folder.own")}
        tooltip={folder?.path}
        onClick={() => onOpen("folder")}
      />
      <InstructionsRow group={group} />
      <NavRow
        ref={membersRef}
        data-panel-row="members"
        title={t("room.panel.members")}
        value={String(members.length)}
        onClick={onMembers}
      />
    </>
  );
}

export function GroupUsageRow({ group }: { group: Group }) {
  const usage = groupUsageSummary(group.usage);
  if (!usage) return null;
  return (
    <ItemRow data-panel-row="room-usage" title={t("room.panel.chatUsage")}>
      <span title={usage.title} className="shrink-0 text-[13px] leading-[18px] tracking-[0.015em] tabular-nums text-ink-secondary">{usage.short}</span>
    </ItemRow>
  );
}

const SHOW_MARK = "[&_[data-tour=model]>span:first-child]:flex! [&_[data-provider-mark]]:opacity-100!";
// while members differ the pill reads "Mixed" in place of the lead's mark, model name and variant
const MIXED_PILL = "[&_[data-tour=model]>span.truncate]:hidden [&_[data-tour=model]>span.whitespace-pre]:hidden [&_[data-tour=model]]:before:content-(--room-mixed)";

/** The members' models as one row in the bot panel's Model anatomy. A pick from it lands on every member: the picker
 * runs for the first member, and its model change is dispatched for each of them. */
export function RoomModelRow({ members }: { members: Bot[] }) {
  const store = useStore();
  const lead = members[0]!;
  const mixed = members.some((member) => !sameModelSelection(member.modelSelection, lead.modelSelection));
  const everyone = useMemo(() => ({
    ...store,
    dispatch: (action: Action) => {
      if (action.type !== "setModel" || action.botId !== lead.id) return store.dispatch(action);
      for (const member of members) {
        store.dispatch({ ...action, botId: member.id, threadId: action.threadId ? member.threadId : undefined });
      }
    },
  }), [store, lead.id, members]);
  return (
    <div
      data-room-model-row={mixed ? "mixed" : "same"}
      className={mixed ? MIXED_PILL : SHOW_MARK}
      style={mixed ? { "--room-mixed": JSON.stringify(t("room.panel.mixed")) } as CSSProperties : undefined}
    >
      <StoreContext.Provider value={everyone}>
        <ModelSelectRow bot={lead} threadId={lead.threadId} />
      </StoreContext.Provider>
    </div>
  );
}

/** Each member's own model, one level down from the room's Model row. */
export function PerBotModels({ members }: { members: Bot[] }) {
  return (
    <Card>
      <div className={SHOW_MARK}>
        {members.map((member) => (
          <div key={member.id} data-room-model={member.id}>
            <ModelSelectRow bot={member} threadId={member.threadId} title={member.name} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ModelsCard({ group, members, onOpen }: { group: Group; members: Bot[]; onOpen: (page: RoomPage) => void }) {
  const engines = [...new Set(members.map((member) => member.modelSelection?.instanceId).filter(Boolean))];
  return (
    <Card anchor="model">
      <RoomModelRow members={members} />
      {members.length > 1 && <NavRow data-panel-page="models" title={t("room.panel.perBot")} onClick={() => onOpen("models")} />}
      <GroupUsageRow group={group} />
      {engines.map((engine) => <UsageMeterRow key={engine} engine={engine} />)}
    </Card>
  );
}

/** The room's Details tab, in the bot panel's Details anatomy. */
export function RoomDetailsTab(props: RoomRowsProps) {
  return (
    <PanelSections data-panel-tabpanel="details">
      <Card>
        <RoomRows {...props} />
      </Card>
      {props.members.length > 0 && <ModelsCard group={props.group} members={props.members} onOpen={props.onOpen} />}
    </PanelSections>
  );
}
