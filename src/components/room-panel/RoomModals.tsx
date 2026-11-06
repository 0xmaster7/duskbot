import { useState } from "react";

import { defaultResponderName, effectiveDefaultResponder, jevRoomRoutingOn } from "@/lib/group-routing";
import { t } from "@/lib/i18n";
import { normalizeState } from "@/lib/mascot";
import { chosenResponder, responderChoice, type ResponderChoice } from "@/lib/room-responder";
import { shortPath } from "@/lib/short-path";
import { api, useStore, type Bot, type Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { FolderPathDialog } from "../bot-panel/modals/FolderModal";
import { InstructionsCard } from "../bot-panel/modals/InstructionsModal";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { Card, CheckRow, FormDialog, FormField, NavRow, NoteRow, SheetPane } from "../ListRows";
import { textFieldCls } from "../ui/GrokDialog";

export type RoomDialog = "responder" | "folder" | "instructions" | "about";

// unsaved instructions per room, kept until saved or the app reloads, as the bot's are
const drafts = new Map<string, string>();

/** The room's instructions in the bot Instructions card: a draft until Save, kept for the session when it closes. */
export function RoomInstructionsModal({ group }: { group: Group; onClose: () => void }) {
  const { dispatch } = useStore();
  const saved = group.bulletin;
  const [draft, setDraftState] = useState(() => drafts.get(group.id) ?? saved);
  const [justSaved, setJustSaved] = useState(false);
  const canSave = draft !== saved;

  const setDraft = (value: string) => {
    if (value === saved) drafts.delete(group.id);
    else drafts.set(group.id, value);
    setDraftState(value);
    setJustSaved(false);
  };
  const save = () => {
    if (!canSave) return;
    dispatch({ type: "patchGroup", groupId: group.id, patch: { bulletin: draft } });
    drafts.delete(group.id);
    setJustSaved(true);
  };

  return (
    <SheetPane data-panel-modal="instructions" title={t("room.panel.instructions")}>
      <InstructionsCard
        label={t("room.panel.instructionsHint")}
        placeholder={t("room.bulletin.placeholder")}
        dir="auto"
        value={draft}
        onChange={setDraft}
        onSave={save}
        canSave={canSave}
        saved={justSaved && !canSave}
      />
    </SheetPane>
  );
}

/** Where every bot in the room runs its shell and file tools, as the bot's Working folder page. The server checks the
 * path, so a folder is saved straight to it and only lands here once accepted. */
export function RoomFolderModal({ group }: { group: Group; onClose: () => void }) {
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host?.homeDir;
  const canPick = typeof window !== "undefined" && Boolean(window.ogb?.pickFolder);
  const locked = group.pinnedCwd !== undefined;
  const cwd = locked ? group.pinnedCwd ?? undefined : group.cwd;
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (next: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ cwd: next }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const pick = async () => {
    const path = await window.ogb?.pickFolder?.(group.cwd);
    if (path) void save(path);
  };

  return (
    <SheetPane data-panel-modal="folder" title={t("room.folder.title")}>
      <Card data-sheet-group="folder" footnote={locked ? <span data-folder-locked>{t("room.folder.lockedChat")}</span> : undefined}>
        <div role="radiogroup" aria-label={t("room.folder.title")} className="contents">
          <CheckRow
            role="radio"
            data-panel-choice="own"
            title={t("room.folder.own")}
            hint={t("room.panel.folder.ownHint")}
            checked={!cwd}
            disabled={saving || locked}
            onClick={() => { if (group.cwd) void save(null); }}
          />
          <CheckRow
            role="radio"
            data-panel-choice="pick"
            title={t("room.panel.folder.pick")}
            hint={cwd ? <span title={cwd}>{shortPath(cwd, home)}</span> : t("botPanel.folder.pickHint")}
            checked={Boolean(cwd)}
            disabled={saving || locked}
            onClick={() => (canPick ? void pick() : setTyping(true))}
          />
        </div>
        {error && !typing && <NoteRow tone="warn">{error}</NoteRow>}
      </Card>
      {typing && <FolderPathDialog title={t("room.folder.title")} initial={group.cwd ?? ""} saving={saving} error={error} onSave={save} onClose={() => setTyping(false)} />}
    </SheetPane>
  );
}

/** Who answers a message that @mentions nobody: one member, MausBot choosing, everyone, or only who is mentioned. */
export function RoomResponderModal({ group, members }: { group: Group; members: Bot[]; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const jevOn = jevRoomRoutingOn(state.config);
  const responder = effectiveDefaultResponder(group, members);
  const current = responderChoice(responder);
  const choose = (choice: ResponderChoice) => {
    if (choice === current) return;
    dispatch({ type: "patchGroup", groupId: group.id, patch: { defaultResponder: chosenResponder(choice, responder) } });
  };
  const behaviours: { choice: "auto" | "everyone" | "mentions"; title: string; hint?: string }[] = [
    {
      choice: "auto",
      title: t("room.panel.responder.autoOption"),
      hint: jevOn ? undefined : t("room.responder.autoOff", { name: defaultResponderName(group, members) ?? t("room.responder.leadFallback") }),
    },
    { choice: "everyone", title: t("room.panel.responder.everyone") },
    { choice: "mentions", title: t("room.panel.responder.mentions") },
  ];
  return (
    <SheetPane data-panel-modal="responder" title={t("room.panel.whoResponds")}>
      <div role="radiogroup" aria-label={t("room.panel.whoResponds")} className="contents">
        <Card data-sheet-group="members">
          {members.map((member) => (
            <CheckRow
              key={member.id}
              role="radio"
              data-panel-choice={`member:${member.id}`}
              leading={<BotAvatar bot={member} state={normalizeState(member.mascotExpression) ?? "happy"} size={20} animated={false} />}
              title={member.name}
              checked={current === `member:${member.id}`}
              onClick={() => choose(`member:${member.id}`)}
            />
          ))}
        </Card>
        <Card data-sheet-group="behaviours">
          {behaviours.map(({ choice, title, hint }) => (
            <CheckRow key={choice} role="radio" data-panel-choice={choice} title={title} hint={hint} checked={current === choice} onClick={() => choose(choice)} />
          ))}
        </Card>
      </div>
    </SheetPane>
  );
}

/** The room's name and short description as rows, edited together in one small form. */
export function RoomAboutModal({ group }: { group: Group; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <SheetPane data-panel-modal="about" title={t("room.panel.about")}>
      <Card data-sheet-group="about">
        <NavRow data-sheet-row="name" title={t("botSettings.simple.name")} value={group.name} onClick={() => setEditing(true)} />
        <NavRow data-sheet-row="description" title={t("presetShare.description")} value={group.description || t("room.panel.descriptionHint")} onClick={() => setEditing(true)} />
      </Card>
      {editing && <RoomAboutDialog group={group} onClose={() => setEditing(false)} />}
    </SheetPane>
  );
}

function RoomAboutDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const trimmed = { name: name.trim(), description: description.trim() };
  const changed = trimmed.name !== group.name || trimmed.description !== (group.description ?? "");
  return (
    <FormDialog
      data-panel-modal="room-about-form"
      title={t("room.panel.about")}
      canSave={Boolean(trimmed.name) && changed}
      onSave={() => {
        dispatch({ type: "patchGroup", groupId: group.id, patch: trimmed });
        onClose();
      }}
      onClose={onClose}
    >
      <FormField label={t("botSettings.simple.name")}>
        <input data-autofocus dir="auto" value={name} onChange={(event) => setName(event.target.value)} className={textFieldCls} />
      </FormField>
      <FormField label={t("presetShare.description")}>
        <input dir="auto" value={description} placeholder={t("room.panel.descriptionHint")} onChange={(event) => setDescription(event.target.value)} className={textFieldCls} />
      </FormField>
    </FormDialog>
  );
}
