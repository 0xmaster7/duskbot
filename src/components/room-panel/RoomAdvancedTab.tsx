import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, Trash2 } from "lucide-react";

import { requestChatFind } from "@/lib/chat-find";
import { cn } from "@/lib/cn";
import { copyTranscriptToClipboard, downloadMarkdownTranscript, formatTranscriptMarkdown, slugifyTranscriptFilename } from "@/lib/export-transcript";
import { t } from "@/lib/i18n";
import { openSettings } from "@/lib/open-settings";
import { useStore, type Group } from "@/state/store";
import { ConfirmDialog } from "../ConfirmDialog";
import { PRESET_TURN_LIMITS, useConversationTurnLimit } from "../ConversationTurnLimit";
import { roomDeleteCopy } from "../room-delete-copy";
import { SelectPill } from "../ui/SelectPill";
import { Card, ColRow, ItemRow, NavRow, PanelSections, rowCls, RowText } from "../bot-panel/rows";
import { GroupUsageRow, RoomRows, type RoomRowsProps } from "./RoomDetailsTab";

function turnLimitLabel(minutes: number): string {
  if (minutes === 60) return t("room.panel.hour");
  if (minutes % 60 === 0) return t("room.panel.hours", { hours: minutes / 60 });
  return t("room.panel.minutes", { minutes });
}

/** A text field of the room's, shown as a row and edited in place: Enter or leaving saves, Escape drops the draft. */
function EditRow({ field, title, value, placeholder, onSave }: {
  field: string;
  title: string;
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const settled = useRef(false);
  const refocus = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (draft !== null || !refocus.current) return;
    refocus.current = false;
    buttonRef.current?.focus();
  }, [draft]);
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onSave(draft.trim());
    setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    settled.current = true;
    refocus.current = true;
    if (event.key === "Enter") commit();
    else setDraft(null);
  };

  if (draft !== null) {
    return (
      <ColRow data-panel-row={field}>
        <RowText title={title} />
        <input
          autoFocus
          dir="auto"
          aria-label={title}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (!settled.current) commit(); }}
          className="h-8 w-full rounded-lg border border-hairline bg-inset px-2.5 text-[13px] leading-[18px] tracking-[0.015em] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent-border"
        />
      </ColRow>
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      data-panel-edit={field}
      aria-label={`${t("botSettings.simple.edit")}: ${title}`}
      onClick={() => {
        settled.current = false;
        setDraft(value);
      }}
      className={cn(rowCls, "w-full text-left hover:bg-ink/[0.06]")}
    >
      <RowText title={title} />
      <span dir="auto" className="min-w-0 max-w-[60%] shrink-0 truncate text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">{value || placeholder}</span>
      <ChevronRight size={14} className="-mr-0.5 shrink-0 text-ink-tertiary" aria-hidden="true" />
    </button>
  );
}

/** The room's controls in the bot panel's Advanced anatomy: the room itself, its chat, apps, then deleting it. */
export function RoomAdvancedTab(props: RoomRowsProps) {
  const { group } = props;
  const { dispatch } = useStore();
  const limit = useConversationTurnLimit(group);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const hasMessages = group.messages.length > 0;
  const transcript = () => formatTranscriptMarkdown({ title: group.name, messages: group.messages, isGroup: true });
  const patch = (next: Partial<Group>) => dispatch({ type: "patchGroup", groupId: group.id, patch: next });
  const turnOptions = [
    { value: "default", label: t("room.turnLimit.default", { minutes: limit.globalMinutes }) },
    ...PRESET_TURN_LIMITS.map((minutes) => ({ value: String(minutes), label: turnLimitLabel(minutes) })),
  ];

  return (
    <PanelSections data-panel-tabpanel="advanced">
      <Card label={t("room.panel.section.room")} anchor="room">
        <EditRow field="name" title={t("botSettings.simple.name")} value={group.name} onSave={(name) => name && patch({ name })} />
        <EditRow
          field="description"
          title={t("presetShare.description")}
          value={group.description ?? ""}
          placeholder={t("room.panel.descriptionHint")}
          onSave={(description) => patch({ description })}
        />
        <RoomRows {...props} />
      </Card>

      <Card label={t("room.panel.section.chat")} anchor="chat">
        <ItemRow data-panel-row="turn-limit" title={t("room.panel.turnLimit")}>
          <SelectPill
            data-panel-select="turn-limit"
            aria-label={t("room.panel.turnLimit")}
            value={limit.saved === null ? "default" : String(limit.saved)}
            options={turnOptions}
            onChange={(value: string) => limit.save(value === "default" ? null : Number(value))}
          />
        </ItemRow>
        <GroupUsageRow group={group} />
        <NavRow data-panel-row="find" drill={false} title={t("chat.find")} onClick={() => requestChatFind(group.threadId)} />
        <NavRow
          data-panel-row="copy"
          drill={false}
          disabled={!hasMessages}
          title={t("chat.export.copyConversation")}
          value={copied && t(copied === "copied" ? "chat.export.copied" : "chat.export.copyFailed")}
          onClick={() => { void copyTranscriptToClipboard(transcript()).then((ok) => setCopied(ok ? "copied" : "failed")); }}
        />
        <NavRow
          data-panel-row="download"
          drill={false}
          disabled={!hasMessages}
          title={t("chat.export.downloadConversation")}
          onClick={() => downloadMarkdownTranscript(slugifyTranscriptFilename(group.name), transcript())}
        />
      </Card>

      <Card anchor="apps">
        <NavRow data-panel-row="apps" title={t("sidebar.nav.connectedApps")} onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })} />
        <NavRow data-panel-row="advanced-features" title={t("settings.pane.advanced")} onClick={() => dispatch(openSettings("advanced"))} />
      </Card>

      <Card label={t("botPanel.section.actions")} anchor="actions">
        <NavRow ref={deleteRef} data-panel-row="delete" drill={false} danger title={t("sidebar.room.deleteChannel")} onClick={() => setDeleting(true)} />
      </Card>
      <ConfirmDialog
        open={deleting}
        {...roomDeleteCopy(group)}
        icon={<Trash2 size={18} />}
        returnFocusRef={deleteRef}
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          dispatch({ type: "deleteGroup", groupId: group.id });
        }}
      />
    </PanelSections>
  );
}
