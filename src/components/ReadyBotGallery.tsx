import { useState } from "react";
import { createPortal } from "react-dom";
import { stoppedAtBotLimit } from "@/lib/bot-limit";
import { MausAvatar } from "./Avatar";
import { NewBotDialog } from "./lazy-screens";
import { READY_BOT_CATEGORIES, READY_BOTS, matchesReadyBot, type ReadyBotCategory } from "@/lib/ready-bots";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore, type Bot } from "@/state/store";

const CATEGORY_KEYS: Record<ReadyBotCategory, LocaleKey> = {
  everyday: "readyBots.category.everyday", work: "readyBots.category.work", writing: "readyBots.category.writing",
  design: "readyBots.category.design", sales: "readyBots.category.sales", personal: "readyBots.category.personal",
};

export function ReadyBotGallery({ search, onDialog, onAdded }: {
  search: string;
  /** The New bot dialog is open over Templates, so Templates must leave its keys alone. */
  onDialog: (open: boolean) => void;
  onAdded: (bot: Bot) => void;
}) {
  const [category, setCategory] = useState<ReadyBotCategory | null>(null);
  const { state, dispatch } = useStore();
  const [adding, setAdding] = useState<string | null>(null);
  const open = (id: string | null) => {
    if (id !== null && stoppedAtBotLimit(state)) return;
    // A paired device may not read the host's New bot defaults that the review is filled from.
    if (id !== null && window.ogb?.remoteClient?.active) { dispatch({ type: "newBot", onCreated: onAdded }); return; }
    setAdding(id); onDialog(id !== null);
  };
  const visible = READY_BOTS.filter((bot) => (!category || bot.category === category) && matchesReadyBot(bot, search));
  if (search.trim() && visible.length === 0) return null;
  return <section className="mb-8" aria-labelledby="ready-bots-title">
    <div className="flex flex-wrap items-baseline justify-between gap-2 pb-1.5 pl-3 pr-1 pt-2">
      <h3 id="ready-bots-title" className="m-0 text-[12px] font-normal leading-4 text-ink/56">{t("readyBots.title")}</h3>
    </div>
    <div className="mb-2 mt-1 flex flex-wrap gap-2" role="group" aria-label={t("readyBots.categories")}>
      {[null, ...READY_BOT_CATEGORIES].map((value) => <button key={value ?? "all"} type="button" aria-pressed={category === value}
        onClick={() => setCategory(value)}
        className={cn("inline-flex h-7 items-center rounded-full px-2.5 text-[13px] leading-[18px] tracking-[0.015em] transition-[background-color,color] duration-[120ms] ease-[ease] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
          category === value ? "bg-ink text-app hover:bg-[color-mix(in_srgb,var(--color-ink)_88.5%,var(--color-menu))]" : "bg-ink/6 text-ink hover:bg-ink/10")}>
        {value ? t(CATEGORY_KEYS[value]) : t("readyBots.all")}
      </button>)}
    </div>
    <div className="-mx-3 grid grid-cols-1 md:grid-cols-2">
      {visible.map((bot) => <article key={bot.id} data-ready-bot={bot.id} title={bot.description} className="flex min-w-0 items-center gap-3 rounded-[16px] p-3 transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5">
        <MausAvatar color={bot.look.color} bodyId={bot.look.mascotBody} size={32} animated={false} label={bot.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <h4 className="m-0 truncate text-[13px] font-medium leading-[18px] text-ink">{bot.name}</h4>
          <p className="m-0 truncate text-[13px] leading-[18px] text-ink/68">{bot.title} · {t(CATEGORY_KEYS[bot.category])}</p>
        </div>
        <button type="button" onClick={() => open(bot.id)} aria-label={t("readyBots.addAria", { name: bot.name, title: bot.title })}
          className="inline-flex h-[26px] shrink-0 items-center rounded-[13px] bg-ink/6 px-2.5 text-[12px] leading-4 tracking-[0.015em] text-ink transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
          {t("readyBots.add")}
        </button>
      </article>)}
    </div>
    {adding && createPortal(<NewBotDialog readyBotId={adding} onClose={() => open(null)} onCreated={(bot) => { onDialog(false); onAdded(bot); }} />, document.body)}
  </section>;
}
