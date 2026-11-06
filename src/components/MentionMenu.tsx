import type { RefObject } from "react";
import { Bug, Users } from "lucide-react";
import type { Bot } from "@/state/store";
import type { TeamPerson } from "@/state/team-people";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { normalizeState } from "@/lib/mascot";
import { mentionRowDescription } from "@/lib/mentions";
import { BotAvatar } from "./Avatar";
import { ComposerMenuRow } from "./ComposerMenuRow";
import type { MenuMotion } from "./MenuMotion";
import { PersonFace } from "./TeamOwner";
import { DEVS_TAG } from "../../shared/devs-mention";
import "@/styles/composer.css";

/** One row of the @ list: a bot, a teammate on a Team Cloud, a whole team, everyone, or the MausBot team (@devs). */
export type MentionChoice = { id: string; name: string; bot?: Bot; person?: TeamPerson; team?: { count: number }; all?: { count: number }; devs?: true };

/** The last row of every @ list: a message that tags it is a bug report the app sends to the MausBot team. */
export const DEVS_CHOICE: MentionChoice = { id: "__devs__", name: DEVS_TAG, devs: true };

/** The @ list's rows for a Team Cloud's teammates, after the bots. */
export function teammateChoices(people: readonly TeamPerson[]): MentionChoice[] {
  return people.map((person) => ({ id: `person:${person.email}`, name: person.name, person }));
}

// grok's round @ for everyone: a 16px ink-wash disc with the mark in 11px semibold
const MENU_GLYPH = "flex size-4 items-center justify-center rounded-full bg-[var(--composer-control)] text-[11px] leading-none font-semibold text-[color:var(--composer-muted)]";

/** The @ and / lists' surface, as grok's @ list: 360px, a 12px corner, one 1px hairline, 6px in and 2px between rows. */
export const COMPOSER_LIST = "popover-surface absolute bottom-full start-2 z-20 mb-2 flex w-[360px] max-w-[calc(100%-1rem)] origin-bottom-left flex-col gap-0.5 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[12px] border border-[color:var(--composer-menu-line)] p-1.5";

/** The composer's @ list, shared by every composer that tags bots. */
export function MentionMenu({ listRef, motion, choices, highlight, everyoneCount, onPick, onHighlight, className }: {
  listRef: RefObject<HTMLDivElement | null>;
  motion: MenuMotion;
  choices: MentionChoice[];
  highlight: number;
  everyoneCount: number;
  onPick: (choice: MentionChoice) => void;
  onHighlight: (index: number) => void;
  className?: string;
}) {
  if (!motion.shown) return null;
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("composer.mention.aria")}
      className={cn(COMPOSER_LIST, "max-h-72", motion.className, className)} {...motion.exitProps}
    >
      {choices.map((choice, i) => {
        const description = choice.person ? "" : choice.devs ? t("composer.mention.devsDesc") : mentionRowDescription(choice.bot ? { kind: "bot", title: choice.bot.title.trim() || (choice.bot.chiefOfStaff ? t("chat.chiefOfStaff") : "") }
          : choice.team ? { kind: "team", count: choice.team.count }
            : choice.all ? { kind: "all", count: choice.all.count } : { kind: "everyone", count: everyoneCount });
        return (
          <ComposerMenuRow
            key={choice.id}
            id={`composer-mention-${choice.id}`}
            data-mention-index={i}
            role="option"
            aria-selected={i === highlight}
            onClick={() => onPick(choice)}
            onMouseEnter={() => onHighlight(i)}
            selected={i === highlight}
            icon={choice.bot ? (
              <BotAvatar
                bot={choice.bot}
                state={normalizeState(choice.bot.mascotExpression) ?? "happy"}
                size={16}
                animated={i === highlight}
              />
            ) : choice.person ? <PersonFace person={choice.person} size={16} /> : (
              <span className={MENU_GLYPH}>
                {choice.devs ? <Bug size={10} strokeWidth={2.25} aria-hidden="true" /> : choice.team ? <Users size={10} strokeWidth={2.25} aria-hidden="true" /> : "@"}
              </span>
            )}
            name={choice.name}
            description={description || undefined}
            kind={choice.bot ? t("composer.mention.agent") : choice.person ? t("composer.mention.person") : choice.devs ? t("composer.mention.devs") : choice.team ? t("composer.mention.team") : t("composer.mention.channel")}
          />
        );
      })}
    </div>
  );
}
