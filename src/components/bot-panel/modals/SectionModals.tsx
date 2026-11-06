import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { BOT_PROFILE_LIMITS } from "../../../../shared/bot-profile";
import { PackageProvenance } from "../../bot-settings/PackageProvenance";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { showDefaultBot } from "../../DefaultBotControls";
import { GrokDialog, textAreaCls, textFieldCls } from "../../ui/GrokDialog";
import { PermissionsSheet } from "./PermissionsSheet";
import { FieldRow, Group, LinkRow, Row, SheetBody } from "./sheet-kit";
import { ToolsSheet } from "./ToolsSheet";

type Derived = ReturnType<typeof useBotSettingsDerived>;

function SectionPane({ page, section, title, onClose, children }: {
  page: string;
  section: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <GrokDialog data-panel-modal={page} title={title} onClose={onClose}>
      <div data-bot-settings-section={section} className="contents">
        <SheetBody>{children}</SheetBody>
      </div>
    </GrokDialog>
  );
}

export function ToolsModal({ bot, derived, onClose }: { bot: Bot; derived: Derived; onClose: () => void }) {
  return (
    <SectionPane page="tools" section="access" title={t("botPanel.page.tools")} onClose={onClose}>
      <ToolsSheet bot={bot} derived={derived} />
    </SectionPane>
  );
}

export function PermissionsModal({ bot, derived, onClose }: { bot: Bot; derived: Derived; onClose: () => void }) {
  return (
    <SectionPane page="permissions" section="permissions" title={t("botSettings.sections.permissions")} onClose={onClose}>
      <PermissionsSheet bot={bot} derived={derived} />
    </SectionPane>
  );
}

export function IdentityModal({ bot, derived, onClose }: { bot: Bot; derived: Derived; onClose: () => void }) {
  const { dispatch } = useStore();
  const { patch } = derived;
  return (
    <SectionPane page="identity" section="identity" title={t("botSettings.sections.identity")} onClose={onClose}>
      <Group label={t("botPanel.sheet.profile")} data-sheet-group="profile">
        <Row title={t("botSettings.identity.name")}>
          <input
            aria-label={t("botSettings.identity.name")}
            maxLength={BOT_PROFILE_LIMITS.name}
            value={bot.name}
            onChange={(event) => patch({ name: event.target.value })}
            className={`${textFieldCls} w-56`}
          />
        </Row>
        <Row title={t("botSettings.identity.title")}>
          <input
            aria-label={t("botSettings.identity.title")}
            maxLength={BOT_PROFILE_LIMITS.title}
            placeholder={t("botSettings.identity.titlePlaceholder")}
            value={bot.title}
            onChange={(event) => patch({ title: event.target.value })}
            className={`${textFieldCls} w-56`}
          />
        </Row>
        <FieldRow label={t("botPanel.sheet.blurb")}>
          <textarea
            aria-label={t("botSettings.identity.blurb")}
            rows={3}
            maxLength={BOT_PROFILE_LIMITS.description}
            placeholder={t("botPanel.sheet.blurbHint")}
            value={bot.description}
            onChange={(event) => patch({ description: event.target.value })}
            className={textAreaCls}
          />
        </FieldRow>
        {bot.defaultBot && !bot.sidebarHidden && (
          <LinkRow data-sheet-row="default-bot-hide" title={t("defaultBot.hide")} onClick={() => showDefaultBot(dispatch, bot, false)} />
        )}
      </Group>
      <PackageProvenance bot={bot} />
    </SectionPane>
  );
}

export function SlackModal({ managementUrl, onClose }: { managementUrl: string; onClose: () => void }) {
  return (
    <SectionPane page="slack" section="slack" title={t("botPanel.page.slack")} onClose={onClose}>
      <Group label={t("botPanel.page.slack")} data-sheet-group="slack">
        <Row title={t("botPanel.sheet.slack")} hint={t("botPanel.sheet.slackHint")}>
          <a href={managementUrl} target="_blank" rel="noopener noreferrer" className="ui-button hover:bg-ink/10">{t("botSlack.manage")}</a>
        </Row>
      </Group>
    </SectionPane>
  );
}
