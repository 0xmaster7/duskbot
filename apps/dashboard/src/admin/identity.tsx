import { Mascot } from "../ui/Mascot";
import { UserFace } from "../ui/UserAvatar";
import { avatarOf, friendlyName } from "./names";

const PLACEHOLDER = /^(account|user|customer|unknown|anonymous|null|undefined|-)$/i;
const real = (value: string | null | undefined) => {
  const text = value?.trim();
  return text && !PLACEHOLDER.test(text) ? text : null;
};

/** the best words for someone: their own name, else their email, else the stable animal name a visitor gets */
export function identity(who: { id: string; name?: string | null; email?: string | null }): { name: string; sub: string | null; anonymous: boolean } {
  const name = real(who.name), email = real(who.email);
  if (name) return { name, sub: email, anonymous: false };
  if (email) return { name: email, sub: null, anonymous: false };
  return { name: friendlyName(who.id), sub: null, anonymous: true };
}

/** an account's round face (photo or drawn head); an anonymous visitor gets their pixel mascot on a square tile instead */
export function PersonFace({ id, size = 32, anonymous, avatarUrl, avatar }: { id: string; size?: number; anonymous?: boolean; avatarUrl?: string | null; avatar?: string }) {
  if (anonymous) {
    const { body, ink } = avatarOf(id);
    return (
      <span className="grid shrink-0 place-items-center rounded-[10px] bg-card-2" style={{ width: size, height: size }} aria-hidden>
        <Mascot body={body} color={ink} size={Math.round(size * 0.72)} still />
      </span>
    );
  }
  return <UserFace account={{ id, ...(avatarUrl ? { avatarUrl } : {}), ...(avatar ? { avatar } : {}) }} size={size} />;
}
