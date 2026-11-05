import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/cn";
import { WIPE } from "@/lib/motion-presets";
import { t } from "@/lib/i18n";
import type { Bot, BotSettingsSection } from "@/state/store";
import { GrokIcon } from "../GrokIcon";
import { useCaptionChrome } from "../DesktopCapabilities";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { AvatarEditorCard } from "./AvatarEditorCard";
import { ComputerTab } from "./ComputerTab";
import { DetailsTab } from "./DetailsTab";
import { LibraryTab, libraryItems } from "./LibraryTab";
import { PANEL_TABS, PAGES, TAB_LABEL, type PanelTab, type PanelTarget, type SimplePageId } from "./page-registry";
import { PageBody, pageSurfaceCls } from "./pages";
import { linkTarget, usePanelLink, type PanelLink } from "./panel-link";
import { PanelHero } from "./PanelHero";
import { PanelShareMenu } from "./PanelShareMenu";
import { roundButtonCls } from "./rows";
import { SegmentedTabs } from "../ui/SegmentedTabs";

function initialTarget(section: BotSettingsSection | null, link: PanelLink | null): PanelTarget {
  return section ? linkTarget(section, link) : { tab: "details" };
}

export function BotPanel({ bot, derived, linkedSection, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  linkedSection: BotSettingsSection | null;
  onClose: () => void;
}) {
  const { dragProps } = useCaptionChrome();
  const link = usePanelLink();
  const [tab, setTab] = useState<PanelTab>(() => initialTarget(linkedSection, link).tab);
  const [stack, setStack] = useState<SimplePageId[]>(() => {
    const page = initialTarget(linkedSection, link).page;
    return page ? [page] : [];
  });
  const [anchor, setAnchor] = useState<string | null>(() => initialTarget(linkedSection, link).anchor ?? null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingInstructions, setEditingInstructions] = useState(() => Boolean(initialTarget(linkedSection, link).editInstructions));
  const bodyRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const page = stack.at(-1) ?? null;

  const scrollTop = () => bodyRef.current?.scrollTo({ top: 0 });
  const go = (target: PanelTarget) => {
    setTab(target.tab);
    setStack(target.page ? [target.page] : []);
    setAnchor(target.anchor ?? null);
    setEditorOpen(false);
    setEditingInstructions(Boolean(target.editInstructions));
    scrollTop();
  };
  const openTab = (next: PanelTab) => go({ tab: next });
  const openPage = (next: SimplePageId) => {
    setStack((current) => [...current, next]);
    setEditorOpen(false);
    setEditingInstructions(false);
    scrollTop();
  };
  const closeEditor = () => {
    setEditorOpen(false);
    // The card held focus: hand it back to the avatar that opened it, before the card goes, not to the page body.
    editorRef.current?.querySelector<HTMLElement>("[data-panel-avatar]")?.focus();
  };
  const back = () => {
    setStack((current) => current.slice(0, -1));
    scrollTop();
  };

  // A new link re-runs this even when it names the section already linked, so a repeated link lands there again.
  useEffect(() => {
    if (linkedSection) go(linkTarget(linkedSection, link));
  }, [linkedSection, link]);

  useEffect(() => {
    if (!anchor) return;
    bodyRef.current?.querySelector(`[data-panel-card="${anchor}"]`)?.scrollIntoView({ block: "start" });
    setAnchor(null);
  }, [anchor, page, tab]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target as Partial<Element> | null;
    const inDialog = typeof target?.closest === "function" ? target.closest('[role="dialog"], [role="alertdialog"]') : null;
    // A dialog of its own (one this panel opened, perhaps portaled) owns its Escape; the settings dialog this panel
    // sits in, and the avatar editor, do not.
    const ownDialog = inDialog && !inDialog.contains(event.currentTarget) && inDialog !== editorRef.current && !editorRef.current?.contains(inDialog);
    if (ownDialog) return;
    if (editorOpen) closeEditor();
    else if (stack.length > 0) back();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const backLabel = stack.length > 1 ? t(PAGES[stack[stack.length - 2]!].title, { name: bot.name }) : t(TAB_LABEL[tab]);

  // grok splits the free height 2:3 between the hero and an empty tab, so its one line of copy sits a third of the way down
  const empty = (tab === "details" && derived.botRoutines.length === 0) || (tab === "library" && libraryEmpty(bot));

  // a deeper page pushes in from the right, a shallower one slides back: Grok's wipe navigation
  const depth = stack.length;
  const nav = useRef({ depth, direction: 1 });
  if (nav.current.depth !== depth) nav.current = { depth, direction: depth > nav.current.depth ? 1 : -1 };
  const direction = nav.current.direction;
  const prefersReduced = useReducedMotion();
  const reduced = prefersReduced || (typeof document !== "undefined" && document.documentElement.dataset.reducedMotion === "true");
  const viewKey = page === null ? "tabs" : `${depth}:${page}`;

  const tabsView = (
    <>
      <div data-panel-head className={empty ? "flex flex-[2_1_0px] flex-col" : "contents"}>
        <div className="relative pb-3 pt-2" ref={editorRef}>
          <PanelHero
            bot={bot}
            activeState={derived.activeState}
            patch={derived.patch}
            editorOpen={editorOpen}
            onToggleEditor={() => setEditorOpen((open) => !open)}
          />
          {editorOpen && (
            <>
              <div className="fixed inset-0 z-20" aria-hidden="true" data-panel-scrim onClick={closeEditor} />
              <AvatarEditorCard bot={bot} activeState={derived.activeState} onPatch={derived.patch} onClose={closeEditor} />
            </>
          )}
        </div>
        <div
          data-panel-tabs
          className="sticky top-0 z-[1] -mx-4 flex justify-center bg-app px-4 pb-2.5 pt-1 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-linear-to-b after:from-app after:to-transparent"
        >
          <SegmentedTabs
            attr="data-panel-tab"
            label={t("botSettings.simple.tabs")}
            value={tab}
            onChange={openTab}
            tabs={PANEL_TABS.map((id) => ({ value: id, label: t(TAB_LABEL[id]) }))}
          />
        </div>
      </div>
      <div role="tabpanel" aria-label={t(TAB_LABEL[tab])} className={cn("pt-2.5", empty && "flex-[3_1_0px]")}>
        {tab === "details" && <DetailsTab bot={bot} derived={derived} onOpen={openPage} />}
        {tab === "library" && <LibraryTab bot={bot} onOpen={openPage} />}
        {tab === "computer" && <ComputerTab bot={bot} derived={derived} onOpen={openPage} />}
      </div>
    </>
  );

  const pageView = page === null ? null : (
    <div data-panel-page-view={page} className="pt-1">
      <span id="bot-settings-title" className="sr-only">{bot.name}</span>
      {PAGES[page].intro && <p className="mx-3 mb-2.5 text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">{t(PAGES[page].intro, { name: bot.name })}</p>}
      <div className={pageSurfaceCls}>
        <PageBody
          page={page}
          bot={bot}
          derived={derived}
          onOpen={openPage}
          editingInstructions={editingInstructions}
          onEditInstructions={setEditingInstructions}
        />
      </div>
    </div>
  );

  const viewCls = "@container absolute inset-0 flex flex-col overflow-y-auto overscroll-contain bg-app px-4 pb-4 [scrollbar-gutter:stable] [scrollbar-width:thin]";
  const setBody = (element: HTMLDivElement | null) => { if (element) bodyRef.current = element; };
  const view = (content: ReactNode) => reduced ? (
    <div key={viewKey} ref={setBody} className={viewCls}>{content}</div>
  ) : (
    <motion.div
      key={viewKey}
      ref={setBody}
      custom={direction}
      variants={WIPE_VARIANTS}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: WIPE.duration, ease: WIPE.ease }}
      className={viewCls}
    >
      {content}
    </motion.div>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <span aria-hidden="true" data-panel-edge className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[0.5px] bg-edge" />
      <div {...dragProps} className="relative flex h-[60px] shrink-0 items-center gap-2 p-3">
        {page === null ? (
          <span className="ms-auto">
            <PanelShareMenu bot={bot} />
          </span>
        ) : (
          <>
            <button
              type="button"
              data-panel-back
              aria-label={t("botPanel.backTo", { place: backLabel })}
              title={backLabel}
              onClick={back}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink/[0.66] transition-[background-color,color] duration-[120ms] ease-[ease-out] hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <GrokIcon name="chevron-left" size={14} />
            </button>
            <span data-panel-page-title className="pointer-events-none absolute left-1/2 top-1/2 max-w-[60%] -translate-x-1/2 -translate-y-1/2 truncate text-[13px] font-medium leading-[18px]">
              {t(PAGES[page].title, { name: bot.name })}
            </span>
            <span className="ms-auto" />
          </>
        )}
        <button type="button" onClick={onClose} aria-label={t("botPanel.close")} className={roundButtonCls}>
          <GrokIcon name="close" size={16} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {reduced ? view(page === null ? tabsView : pageView) : (
          <AnimatePresence initial={false} custom={direction}>
            {view(page === null ? tabsView : pageView)}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

const WIPE_VARIANTS = {
  enter: (direction: number) => ({ x: direction > 0 ? WIPE.pushFrom : WIPE.popFrom, opacity: 1, zIndex: direction > 0 ? 1 : 0 }),
  center: { x: "0%", opacity: 1 },
  exit: (direction: number) => (direction > 0 ? { x: "-30%", opacity: 0, zIndex: 0 } : { x: "100%", opacity: 1, zIndex: 1 }),
};

function libraryEmpty(bot: Bot): boolean {
  const { pages, apps, shared, unshared } = libraryItems(bot);
  return pages.length + apps.length + shared.length + unshared.length === 0;
}
