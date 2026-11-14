import { useMemo, useState } from "react";
import { drawUserAvatar, userAvatarFace } from "../../../../shared/user-avatar";
import { cx } from "./kit";

/** The drawn head for a seed, as crisp pixels: the art scales by whole cells and the tile fills what is left. */
export function UserAvatarArt({ seed, size = 32, className }: { seed: string; size?: number; className?: string }) {
  const art = useMemo(() => drawUserAvatar(seed), [seed]);
  // whole device pixels per cell, so every cell lands on the screen's grid and small sizes still fill the circle
  const dpr = typeof window === "undefined" ? 1 : Math.max(1, Math.round(window.devicePixelRatio || 1));
  const scale = Math.max(1, Math.floor((size * dpr) / art.size)) / dpr;
  const view = size / scale, pad = (view - art.size) / 2;
  const runs: { x: number; y: number; w: number; c: string }[] = [];
  for (let y = 0; y < art.size; y++) {
    for (let x = 0; x < art.size;) {
      const c = art.cells[y * art.size + x]!;
      let w = 1;
      while (x + w < art.size && art.cells[y * art.size + x + w] === c) w++;
      if (c !== art.tile) runs.push({ x, y, w, c });
      x += w;
    }
  }
  return (
    <svg aria-hidden="true" data-user-avatar={seed} width={size} height={size} viewBox={`${-pad} ${-pad} ${view} ${view}`} shapeRendering="crispEdges" className={cx("shrink-0 rounded-full", className)}>
      <rect x={-pad} y={-pad} width={view} height={view} fill={art.tile} />
      {runs.map((run) => <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={run.c} />)}
    </svg>
  );
}

/** A person's face: their photo unless they chose a drawn head, else the head drawn from their account id. */
export function UserFace({ account, size = 32, className }: { account: { id: string; avatarUrl?: string | null; avatar?: string }; size?: number; className?: string }) {
  const face = userAvatarFace({ id: account.id, ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}), ...(account.avatar ? { avatar: account.avatar } : {}) });
  const [failed, setFailed] = useState<string | null>(null);
  if (face.kind === "photo" && failed !== face.url) {
    return <img src={face.url} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(face.url)} aria-hidden className={cx("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return <UserAvatarArt seed={face.kind === "drawn" ? face.seed : account.id} size={size} className={className} />;
}
