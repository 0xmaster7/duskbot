/** What `GET /api/link-preview?url=` answers for a link in chat. Every field is plain text, never markup. */
export interface LinkPreview {
  /** The page the preview describes, after redirects. */
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Served by this server (`/api/link-preview/image/<id>`), never the site's own address. */
  image: { src: string; width: number | null; height: number | null } | null;
  /** The page is a video, so the image is its poster. */
  video: boolean;
}

export const LINK_PREVIEW_IMAGE_PATH = "/api/link-preview/image/";
