import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { defaultResponderName, effectiveDefaultResponder, jevRoomRoutingOn } from "@/lib/group-routing";
import { t } from "@/lib/i18n";
import { normalizeState } from "@/lib/mascot";
import { chosenResponder, responderChoice, type ResponderChoice } from "@/lib/room-responder";
import { shortPath } from "@/lib/short-path";
import { api, useStore, type Bot, type Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { GrokIcon, type GrokIconName } from "../GrokIcon";
import {
  DialogChoice, DialogSection, fieldLabelCls, footnoteCls, GrokDialog, mdPrimaryCls, rowButtonCls, rowHintCls, rowTitleCls, textFieldCls,
} from "../ui/GrokDialog";

export type RoomDialog = "responder" | "folder" | "instructions" | "about";

// unsaved instructions per room, kept until saved or the app reloads, as the bot's are
const drafts = new Map<string, string>();

/** The room's instructions in the bot Instructions card: a draft until Save, kept for the session when it closes. */
export function RoomInstructionsModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { dispatch } = useStore();
  const saved = group.bulletin;
  const [draft, setDraftState] = useState(() => drafts.get(group.id) ?? saved);
  const [justSaved, setJustSaved] = useState(false);
  const canSave = draft !== saved;
  const prompt = t("room.panel.instructionsHint");

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
    <GrokDialog data-panel-modal="instructions" title={t("room.panel.instructions")} onClose={onClose}>
      <DialogSection bare label={prompt} className="min-h-0 flex-1">
        <div data-instructions-card className="flex min-h-[240px] flex-1 flex-col rounded-[14px] bg-menu outline-1 -outline-offset-1 outline-ink/8 [outline-style:solid] transition-[outline-color] duration-[120ms] ease-[ease] focus-within:outline-ink/20">
          <textarea
            data-autofocus
            dir="auto"
            value={draft}
            aria-label={prompt}
            placeholder={t("room.bulletin.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                save();
              }
            }}
            className="block min-h-0 w-full flex-1 resize-none rounded-t-[14px] bg-transparent px-3.5 pb-2 pt-3 text-[13px] leading-[18px] tracking-[0.195px] text-ink outline-none [scrollbar-width:thin] placeholder:text-ink/40"
          />
          <div className="flex min-h-12 shrink-0 items-center justify-end gap-3 py-2 pl-3.5 pr-2">
            <button type="button" data-modal-action="save" disabled={!canSave} onClick={save} className={mdPrimaryCls}>
              {justSaved && !canSave ? t("common.saved") : t("common.save")}
            </button>
          </div>
        </div>
      </DialogSection>
    </GrokDialog>
  );
}

/** Where every bot in the room runs its shell and file tools, in the bot Working folder dialog's rows. The server checks
 * the path, so a folder is saved straight to it and only lands here once accepted. */
export function RoomFolderModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host?.homeDir;
  const canPick = typeof window !== "undefined" && Boolean(window.ogb?.pickFolder);
  const locked = group.pinnedCwd !== undefined;
  const cwd = locked ? group.pinnedCwd ?? undefined : group.cwd;
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const chosen = Boolean(cwd) || choosing;

  const save = async (next: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ cwd: next }) });
      setDraft(null);
      if (!next) setChoosing(false);
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
    <GrokDialog data-panel-modal="folder" title={t("room.folder.title")} description={t("room.folder.detail")} onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        <DialogSection label={t("room.panel.folder.files")}>
          <div role="radiogroup" aria-label={t("room.folder.title")} className="flex flex-col">
            <DialogChoice
              data-panel-choice="own"
              icon="lock"
              title={t("room.folder.own")}
              hint={t("room.panel.folder.ownHint")}
              checked={!chosen}
              disabled={saving || locked}
              onSelect={() => {
                setChoosing(false);
                if (group.cwd) void save(null);
              }}
            />
            <DialogChoice
              data-panel-choice="pick"
              icon="folder"
              title={t("room.panel.folder.pick")}
              hint={cwd ? <span title={cwd}>{shortPath(cwd, home)}</span> : t("botPanel.folder.pickHint")}
              checked={chosen}
              disabled={saving || locked}
              onSelect={() => {
                if (canPick) void pick();
                else setChoosing(true);
              }}
            >
              {chosen && !locked && !canPick && (
                <form
                  data-panel-form="folder-path"
                  className="flex items-center gap-2 pb-2 pl-[46px] pr-3.5 pt-0.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const path = (draft ?? group.cwd ?? "").trim();
                    if (path) void save(path);
                  }}
                >
                  <input
                    dir="auto"
                    value={draft ?? group.cwd ?? ""}
                    placeholder={t("botAccess.folder.placeholder")}
                    aria-label={t("room.folder.title")}
                    onChange={(event) => setDraft(event.target.value)}
                    className={textFieldCls}
                  />
                  <button type="submit" disabled={saving || draft === null} className={rowButtonCls}>{t("common.save")}</button>
                </form>
              )}
            </DialogChoice>
          </div>
        </DialogSection>
        {locked && <p data-folder-locked className={footnoteCls}>{t("room.folder.lockedChat")}</p>}
        {error && <p role="alert" className={cn(footnoteCls, "text-warning")}>{error}</p>}
      </div>
    </GrokDialog>
  );
}

function MemberChoice({ bot, checked, onSelect }: { bot: Bot; checked: boolean; onSelect: () => void }) {
  return (
    <ChoiceRow choice={`member:${bot.id}`} checked={checked} onSelect={onSelect} title={bot.name}
      lead={<BotAvatar bot={bot} state={normalizeState(bot.mascotExpression) ?? "happy"} size={20} animated={false} />} />
  );
}

/** DialogChoice's row with any leading mark, so a member shows their face. */
function ChoiceRow({ choice, lead, title, hint, checked, onSelect }: {
  choice: string;
  lead: ReactNode;
  title: string;
  hint?: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      data-panel-choice={choice}
      aria-checked={checked}
      onClick={onSelect}
      className="mx-1.5 flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2.5 text-left outline-none transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
    >
      <span aria-hidden="true" className={cn("flex size-5 shrink-0 items-center justify-center", checked ? "text-ink" : "text-ink/68")}>{lead}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn(rowTitleCls, "truncate")}>{title}</span>
        {hint && <span className={cn(rowHintCls, "text-pretty")}>{hint}</span>}
      </span>
      <span aria-hidden="true" className={cn("flex w-4 shrink-0 justify-center text-ink", !checked && "invisible")}>
        <GrokIcon name="check" size={14} />
      </span>
    </button>
  );
}

const BEHAVIOUR_ICON: Record<"auto" | "everyone" | "mentions", GrokIconName> = { auto: "sparkle", everyone: "people", mentions: "at" };

/** Who answers a message that @mentions nobody: one member, MausBot choosing, everyone, or only who is mentioned. */
export function RoomResponderModal({ group, members, onClose }: { group: Group; members: Bot[]; onClose: () => void }) {
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
    <GrokDialog data-panel-modal="responder" title={t("room.panel.whoResponds")} description={t("room.panel.responder.intro")} onClose={onClose}>
      <div role="radiogroup" aria-label={t("room.panel.whoResponds")} className="flex flex-col gap-2.5">
        <DialogSection>
          {members.map((member) => (
            <MemberChoice key={member.id} bot={member} checked={current === `member:${member.id}`} onSelect={() => choose(`member:${member.id}`)} />
          ))}
        </DialogSection>
        <DialogSection>
          {behaviours.map(({ choice, title, hint }) => (
            <ChoiceRow key={choice} choice={choice} title={title} hint={hint} checked={current === choice} onSelect={() => choose(choice)}
              lead={<GrokIcon name={BEHAVIOUR_ICON[choice]} size={16} />} />
          ))}
        </DialogSection>
      </div>
    </GrokDialog>
  );
}

/** The room's name and short description as one small form. */
export function RoomAboutModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const trimmed = { name: name.trim(), description: description.trim() };
  const changed = trimmed.name !== group.name || trimmed.description !== (group.description ?? "");
  const canSave = Boolean(trimmed.name) && changed;
  const [justSaved, setJustSaved] = useState(false);
  const save = () => {
    if (!canSave) return;
    dispatch({ type: "patchGroup", groupId: group.id, patch: trimmed });
    setJustSaved(true);
  };
  return (
    <GrokDialog
      data-panel-modal="about"
      title={t("room.panel.about")}
      onClose={onClose}
      footer={<button type="button" data-modal-action="save" disabled={!canSave} onClick={save} className={mdPrimaryCls}>{justSaved && !canSave ? t("common.saved") : t("common.save")}</button>}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelCls}>{t("botSettings.simple.name")}</span>
          <input data-autofocus dir="auto" value={name} onChange={(event) => { setName(event.target.value); setJustSaved(false); }} className={textFieldCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelCls}>{t("presetShare.description")}</span>
          <input dir="auto" value={description} placeholder={t("room.panel.descriptionHint")} onChange={(event) => { setDescription(event.target.value); setJustSaved(false); }} className={textFieldCls} />
        </label>
        <button type="submit" hidden />
      </form>
    </GrokDialog>
  );
}
