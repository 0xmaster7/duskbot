import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { ComputerTab } from "../bot-panel/ComputerTab";
import { PanelEmpty, PanelSections } from "../bot-panel/rows";

const stay = () => {};

function MemberComputer({ bot }: { bot: Bot }) {
  const derived = useBotSettingsDerived(bot);
  return (
    <div data-room-screen={bot.id}>
      <ComputerTab bot={bot} derived={derived} onOpen={stay} />
    </div>
  );
}

/** The bot panel's Computer tab for each member, one after another. */
export function RoomComputerTab({ members }: { members: Bot[] }) {
  if (members.length === 0) return <PanelEmpty data-panel-empty="screens">{t("room.panel.computer.empty")}</PanelEmpty>;
  return (
    <PanelSections data-panel-tabpanel="computer">
      {members.map((member) => <MemberComputer key={member.id} bot={member} />)}
    </PanelSections>
  );
}
