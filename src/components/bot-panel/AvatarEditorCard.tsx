import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MASCOT_INK, type MausColor, type MausState } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { wearsBody, type BotBodyId } from "../../../shared/bot-body";
import { MausAvatar } from "../Avatar";
import { AvatarImageGenerator } from "../AvatarImageGenerator";
import { AvatarFraming, OrganizationAvatarIcons, RESET_MASCOT_PATCH, useAvatarImage, type AvatarPatch } from "../avatar-editing";
import { Segmented } from "./rows";

export type AvatarEditorTab = "bot" | "generate" | "upload";

const TABS: ReadonlyArray<readonly [AvatarEditorTab, LocaleKey]> = [
  ["bot", "botPanel.avatar.tabBot"],
  ["generate", "botPanel.avatar.tabGenerate"],
  ["upload", "botPanel.avatar.tabUpload"],
];

const IMAGE_CROPS = ["circle", "rounded", "square"] as const;
const CROP_KEY: Record<(typeof IMAGE_CROPS)[number], LocaleKey> = {
  circle: "botPanel.avatar.circle",
  rounded: "botPanel.avatar.rounded",
  square: "botPanel.avatar.square",
};

/** Grok's thirteen shapes, in its order: rows of five, five and three. */
const SHAPES = ["blob", "cloud", "square", "sparkle", "clover", "heart", "flower", "teardrop", "tablet", "wedge", "house", "star", "hex"] as const satisfies readonly BotBodyId[];
const SHAPE_ROWS = [SHAPES.slice(0, 5), SHAPES.slice(5, 10), SHAPES.slice(10)];

/** Grok's eleven colours, in its order and by its names, each as the mascot colour that paints the same ink. */
const COLORS: ReadonlyArray<readonly [MausColor, string, string]> = [
  ["chrome", "Black", "#000000"], ["brown" as MausColor, "Brown", "#a06b39"], ["red", "Red", MASCOT_INK.red], ["orange", "Orange", MASCOT_INK.orange],
  ["yellow", "Yellow", MASCOT_INK.yellow], ["green", "Green", MASCOT_INK.green], ["teal", "Cyan", MASCOT_INK.teal], ["blue", "Blue", MASCOT_INK.blue],
  ["purple", "Violet", MASCOT_INK.purple], ["pink", "Magenta", MASCOT_INK.pink], ["silver", "Gray", MASCOT_INK.silver],
];

const RING = "rgba(28, 28, 28, 0.24)";
const HOVER_RING = "rgba(28, 28, 28, 0.12)";

export function AvatarEditorCard({ bot, onPatch, onClose }: {
  bot: Bot;
  activeState: MausState;
  onPatch: (patch: AvatarPatch) => void;
  onClose: () => void;
}) {
  const image = useAvatarImage(bot, onPatch);
  const { fileRef, crop, uploading, generating, setSavingConnection, busy, error, upload, removeImage, generate } = image;
  const showsImage = crop !== "mascot" && Boolean(bot.avatarUrl);
  const [tab, setTab] = useState<AvatarEditorTab>(showsImage ? "upload" : "bot");
  const tabsRef = useRef<HTMLDivElement>(null);
  // The card is a dialog: focus moves into it, onto the tab it opened on, so Escape and Tab work from the start.
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, []);
  const pickMascot = (patch: AvatarPatch) => onPatch(crop === "mascot" ? patch : { ...patch, avatarCrop: "mascot" });
  const body = bot.mascotBody ?? "cursor";
  const shapeButton = (id: BotBodyId) => {
    const chosen = !showsImage && wearsBody(body, id);
    return (
      <button
        key={id}
        type="button"
        disabled={busy}
        aria-pressed={chosen}
        aria-label={`${id} character shape`}
        title={id}
        onClick={() => pickMascot({ mascotBody: id })}
        className="group/shape relative flex size-12 cursor-pointer items-center justify-center disabled:opacity-50"
      >
        {/* grok rings the chosen shape along its own outline: a grey silhouette, a white one inside it, then the mark */}
        <span aria-hidden="true" className={cn("absolute inset-0 flex items-center justify-center", chosen ? "opacity-100" : "opacity-0 group-hover/shape:opacity-100")}>
          <MausAvatar color={bot.color} bodyId={id} size={chosen ? 50 : 44} gradient={chosen ? [RING, RING, RING] : [HOVER_RING, HOVER_RING, HOVER_RING]} animated={false} trackPointer={false} />
        </span>
        {chosen && (
          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <MausAvatar color={bot.color} bodyId={id} size={47} gradient={["#ffffff", "#ffffff", "#ffffff"]} animated={false} trackPointer={false} />
          </span>
        )}
        <span className="relative flex">
          <MausAvatar color={bot.color} faceColor={bot.mascotFaceColor} bodyId={id} size={36} animated={false} trackPointer={false} />
        </span>
      </button>
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label={t("botPanel.avatar.edit")}
      data-panel-avatar-editor
      onKeyDown={onKeyDown}
      className="popover-surface absolute inset-x-[-5px] top-[78px] z-30 overflow-hidden rounded-2xl border border-ink/[0.08] bg-menu text-left shadow-(--shadow-popover)"
    >
      <div ref={tabsRef} role="tablist" aria-label={t("botPanel.avatar.edit")} className="flex items-center gap-0.5 border-b border-ink/[0.06] p-2">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-avatar-tab={id}
            onClick={() => setTab(id)}
            className={cn(
              "h-[26px] cursor-pointer rounded-full px-2 py-1 text-[13px] leading-[18px] tracking-[0.015em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              tab === id ? "bg-ink/[0.06] text-ink" : "text-ink-secondary hover:bg-ink/[0.06]",
            )}
          >
            {t(label)}
          </button>
        ))}
        <button
          type="button"
          data-avatar-reset
          disabled={busy}
          onClick={() => onPatch(RESET_MASCOT_PATCH)}
          aria-label={t("botPanel.avatar.resetAria")}
          className="ml-auto h-[22px] cursor-pointer rounded-lg border border-transparent px-2 text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary transition-colors duration-[140ms] hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
        >
          {t("botPanel.avatar.reset")}
        </button>
      </div>

      <div className="p-3">
        {tab === "bot" && (
          <div className="flex flex-col gap-3">
            <div aria-label={t("botPanel.avatar.shapes")} className="flex flex-col gap-2 py-1.5">
              {SHAPE_ROWS.map((row, index) => (
                <div key={index} className="flex justify-center gap-2">{row.map(shapeButton)}</div>
              ))}
            </div>
            <div aria-label={t("botPanel.avatar.colors")} className="mx-auto flex w-[232px] flex-wrap justify-center gap-2 py-2">
              {COLORS.map(([color, name, ink]) => (
                <button
                  key={color}
                  type="button"
                  disabled={busy}
                  aria-pressed={bot.color === color}
                  aria-label={`${name} character color`}
                  title={name}
                  onClick={() => pickMascot({ color })}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                >
                  <span
                    className={cn("size-6 rounded-full", bot.color === color && "shadow-[0_0_0_3px_var(--color-menu),0_0_0_4px_rgb(28_28_28/0.24)]")}
                    style={{ background: ink }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "generate" && (
          <div className="[&>div:first-child]:mt-0 [&>div:first-child]:border-0 [&>div:first-child]:pt-0">
            <AvatarImageGenerator
              botLabel={bot.title || bot.name}
              disabled={uploading}
              generating={generating}
              onGenerate={generate}
              onSavingChange={setSavingConnection}
            />
          </div>
        )}

        {tab === "upload" && (
          <>
            <OrganizationAvatarIcons busy={busy} onUpload={(file) => void upload(file)} />
            {showsImage && <AvatarFraming bot={bot} disabled={busy} onPatch={onPatch} />}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              onChange={(event) => void upload(event.target.files?.[0])}
            />
            <button
              type="button"
              data-avatar-drop
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void upload(event.dataTransfer.files?.[0]);
              }}
              className="flex w-full flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-ink/15 px-3 py-6 text-center text-[13px] text-ink-secondary hover:border-ink/25 hover:text-ink disabled:opacity-50"
            >
              {uploading ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
              <span>{t("botPanel.avatar.drop")}</span>
              <span className="text-[12px] text-ink-tertiary">{t("botPanel.avatar.types")}</span>
            </button>
            <div className="mt-2.5 flex items-center gap-2.5">
              <span className="shrink-0 text-[12px] text-ink-secondary">{t("botPanel.avatar.shape")}</span>
              <Segmented
                attr="data-avatar-crop"
                label={t("botPanel.avatar.shape")}
                value={showsImage ? crop : null}
                onChange={(next) => onPatch({ avatarCrop: next })}
                options={IMAGE_CROPS.map((value) => ({ value, label: t(CROP_KEY[value]), disabled: busy || !bot.avatarUrl }))}
              />
              {bot.avatarUrl && (
                <button
                  type="button"
                  onClick={removeImage}
                  disabled={busy}
                  aria-label="Remove custom avatar image"
                  title={t("botPanel.avatar.remove")}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {!showsImage && <p className="mt-2 text-[12px] text-ink-tertiary">{t("botPanel.avatar.uploadHint")}</p>}
          </>
        )}

        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
