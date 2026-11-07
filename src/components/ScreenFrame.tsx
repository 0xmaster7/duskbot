import { useState } from "react";

import { AttachmentPreviewDialog, AttachmentThumbnail, type MessageAttachmentContext, type PreviewImage } from "@/components/AttachmentPreview";
import { IMAGE_ROW } from "@/components/ImageRow";
import { reservedAspect } from "@/lib/image-cache";
import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";

export function screenFramePreview(message: MessageAttachmentContext, mime = "image/png"): PreviewImage {
  const src = `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/image`;
  return {
    src,
    name: t("chat.botScreen"),
    downloadUrl: src,
    downloadName: mime === "image/jpeg" ? "screen.jpg" : "screen.png",
  };
}

/** A bot's computer screen as one row tile: never taller than the image row, its box reserved before it loads. */
export function ScreenFrame({ threadId, message }: { threadId: string; message: Message }) {
  const [open, setOpen] = useState(false);
  if (!message.hasImage && !message.png) return null;
  const size = message.media?.screen;
  const image: PreviewImage = { ...screenFramePreview({ threadId, messageId: message.id }, message.mime), ...(size ? { size } : {}) };
  const box = reservedAspect(size);
  return (
    <div className="flex justify-start">
      <div data-screen-frame style={{ width: `min(100%, ${Math.round(IMAGE_ROW.height * box.ratio)}px)` }}>
        <AttachmentThumbnail image={image} onPreview={() => setOpen(true)} label={t("attach.openFullScreen")} className="rounded-[12px] border-0" />
      </div>
      {open && <AttachmentPreviewDialog image={image} onClose={() => setOpen(false)} />}
    </div>
  );
}
