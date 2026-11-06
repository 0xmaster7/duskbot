// a site's own icon, fetched by the app (server/site-icons.ts) so no icon service learns which sites appear here
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The app's address for a site's icon, or null for anything that is not a public site name. */
export function siteIconUrl(domain: string | null | undefined): string | null {
  const name = String(domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  return DOMAIN.test(name) ? `/api/site-icon?domain=${encodeURIComponent(name)}` : null;
}
