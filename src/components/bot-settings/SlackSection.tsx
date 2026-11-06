import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { GrokIcon } from "../GrokIcon";
import { listCardCls, listRowCls, rowButtonCls, rowHintCls } from "../ui/GrokDialog";

export function SlackSection({ managementUrl }: { managementUrl: string }) {
  return (
    <div className={listCardCls}>
      <div className={cn(listRowCls, "gap-x-4")}>
        <p className={cn(rowHintCls, "m-0 min-w-0 flex-1 text-pretty")}>{t("botSlack.body")}</p>
        <a href={managementUrl} target="_blank" rel="noopener noreferrer" className={cn(rowButtonCls, "hover:bg-ink/10")}>
          {t("botSlack.manage")} <GrokIcon name="link-external" size={12} />
        </a>
      </div>
    </div>
  );
}
