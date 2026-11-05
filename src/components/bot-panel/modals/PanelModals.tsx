import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { BackupsModal } from "./BackupsModal";
import { FolderModal } from "./FolderModal";
import { InstructionsModal } from "./InstructionsModal";
import { MemoryModal } from "./MemoryModal";
import type { ModalPage } from "./panel-modal";
import { SkillsModal } from "./SkillsModal";
import { WhereModal } from "./WhereModal";

export function PanelModal({ page, bot, derived, onClose }: {
  page: ModalPage;
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  switch (page) {
    case "instructions":
      return <InstructionsModal bot={bot} derived={derived} onClose={onClose} />;
    case "memory":
      return <MemoryModal bot={bot} derived={derived} onClose={onClose} />;
    case "skills":
      return <SkillsModal bot={bot} onClose={onClose} />;
    case "folder":
      return <FolderModal bot={bot} onClose={onClose} />;
    case "where":
      return <WhereModal bot={bot} derived={derived} onClose={onClose} />;
    case "backups":
      return <BackupsModal bot={bot} derived={derived} onClose={onClose} />;
  }
}
