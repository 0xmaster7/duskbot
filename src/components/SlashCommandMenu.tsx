import type { RefObject } from "react";
import { BookOpen, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/cn";
import { ComposerMenuRow } from "./ComposerMenuRow";
import { t } from "@/lib/i18n";
import type { ComposerSlashCommand } from "@/lib/composer-commands";
import type { MenuMotion } from "./MenuMotion";
import { COMPOSER_LIST } from "./MentionMenu";

/** The composer's / list: room commands like /goal, then the bot's skills. */
export function SlashCommandMenu({ listRef, motion, commands, highlight, onPick, onHighlight }: {
  listRef: RefObject<HTMLDivElement | null>;
  motion: MenuMotion;
  commands: ComposerSlashCommand[];
  highlight: number;
  onPick: (command: ComposerSlashCommand) => void;
  onHighlight: (index: number) => void;
}) {
  if (!motion.shown) return null;
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("composer.commands.aria")}
      className={cn(COMPOSER_LIST, "max-h-80", motion.className)} {...motion.exitProps}
    >
      <div className="shrink-0 px-2 pb-0.5 pt-0.5 text-[12px] leading-4 font-medium text-[color:var(--composer-muted)]">
        {t("composer.commands.title")}
      </div>
      {commands.map((command, index) => {
        const Icon = command.kind === "skill" ? Sparkles : command.id === "goal" ? Target : BookOpen;
        return (
          <ComposerMenuRow
            key={`${command.kind}:${command.id}`}
            data-command-index={index}
            role="option"
            aria-selected={index === highlight}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(command)}
            onMouseEnter={() => onHighlight(index)}
            selected={index === highlight}
            icon={<Icon size={14} className="text-[color:var(--composer-muted)]" aria-hidden="true" />}
            name={command.label}
            description={command.description}
            kind={command.kind === "skill" ? t("composer.command.skillTag") : ""}
          />
        );
      })}
    </div>
  );
}
