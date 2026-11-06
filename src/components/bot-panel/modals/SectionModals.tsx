import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { AccessSection, type AccessPart } from "../../bot-settings/AccessSection";
import { IdentitySection, type IdentityPart } from "../../bot-settings/IdentitySection";
import { PermissionsSection } from "../../bot-settings/PermissionsSection";
import { SheetGroup, SheetLook } from "../../bot-settings/sheet-look";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { cn } from "@/lib/cn";
import { GrokIcon } from "../../GrokIcon";
import { GrokDialog, listCardCls, listRowCls, rowButtonCls, rowHintCls } from "../../ui/GrokDialog";

type Derived = ReturnType<typeof useBotSettingsDerived>;

// where the bot works and its working folder have pages of their own
const TOOL_PARTS: readonly AccessPart[] = ["apps", "mcp", "tools", "xResearch", "always"];
// the avatar is edited from the panel's hero
const IDENTITY_PARTS: readonly IdentityPart[] = ["provenance", "name", "title", "blurb"];

/** A section of the bot's settings drawn as a pane of its sheet: each card under its label, and bot-sheet.css gives the
 * cards Grok's anatomy. */
function SectionPane({ page, section, title, onClose, children }: {
  page: string;
  section: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <GrokDialog data-panel-modal={page} title={title} onClose={onClose}>
      <SheetLook.Provider value>
        <div className="bot-sheet-section" data-settings-look="simple" data-bot-settings-section={section}>
          <div className="flex flex-col gap-7">{children}</div>
        </div>
      </SheetLook.Provider>
    </GrokDialog>
  );
}

export function ToolsModal({ bot, derived, onClose }: { bot: Bot; derived: Derived; onClose: () => void }) {
  return (
    <SectionPane page="tools" section="access" title={t("botPanel.page.tools")} onClose={onClose}>
      <AccessSection bot={bot} derived={derived} parts={TOOL_PARTS} />
    </SectionPane>
  );
}

export function PermissionsModal({ bot, derived, onClose }: { bot: Bot; derived: Derived; onClose: () => void }) {
  return (
    <SectionPane page="permissions" section="permissions" title={t("botSettings.sections.permissions")} onClose={onClose}>
      <PermissionsSection bot={bot} derived={derived} />
    </SectionPane>
  );
}

export function IdentityModal({ bot, derived, onClose }: { bot: Bot; derived: Derived; onClose: () => void }) {
  return (
    <SectionPane page="identity" section="identity" title={t("botSettings.sections.identity")} onClose={onClose}>
      <IdentitySection bot={bot} patch={derived.patch} activeState={derived.activeState} mascotMotion={derived.mascotMotion} parts={IDENTITY_PARTS} />
    </SectionPane>
  );
}

export function SlackModal({ managementUrl, onClose }: { managementUrl: string; onClose: () => void }) {
  return (
    <SectionPane page="slack" section="slack" title={t("botPanel.page.slack")} onClose={onClose}>
      <SheetGroup label={t("botPanel.sheet.slack")}>
        <div className={listCardCls}>
          <div className={cn(listRowCls, "gap-x-4")}>
            <p className={cn(rowHintCls, "m-0 min-w-0 flex-1")}>{t("botPanel.sheet.slackHint")}</p>
            <a href={managementUrl} target="_blank" rel="noopener noreferrer" className={cn(rowButtonCls, "hover:bg-ink/10")}>
              {t("botSlack.manage")} <GrokIcon name="link-external" size={12} />
            </a>
          </div>
        </div>
      </SheetGroup>
    </SectionPane>
  );
}
