import { useMemo, useState } from "react";
import { drawUserAvatar, userAvatarFace } from "../../shared/user-avatar";
import { cn } from "@/lib/cn";

/** The drawn avatar for a seed, as crisp pixels: the art scales by whole cells and the tile fills what is left. */
export function UserAvatarArt({ seed, size = 32, className }: { seed: string; size?: number; className?: string }) {
  const art = useMemo(() => drawUserAvatar(seed), [seed]);
  // whole cells only, so every pixel lands on the screen's grid
  const scale = Math.max(1, Math.floor(size / art.size));
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
    <svg aria-hidden="true" data-user-avatar={seed} width={size} height={size} viewBox={`${-pad} ${-pad} ${view} ${view}`} shapeRendering="crispEdges"
      className={cn("shrink-0 rounded-full", className)}>
      <rect x={-pad} y={-pad} width={view} height={view} fill={art.tile} />
      {runs.map((run) => <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={run.c} />)}
    </svg>
  );
}

/** A person's face: the photo they chose or signed in with, else their drawn avatar. A photo that fails to load falls back
 * to the drawing seeded from their account. */
export function UserFace({ account, size = 32, className }: { account: { id: string; avatarUrl?: string; avatar?: string }; size?: number; className?: string }) {
  const face = userAvatarFace(account);
  const [failed, setFailed] = useState<string | null>(null);
  if (face.kind === "photo" && failed !== face.url) {
    return <img src={face.url} alt="" onError={() => setFailed(face.url)} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return <UserAvatarArt seed={face.kind === "drawn" ? face.seed : account.id} size={size} className={className} />;
}
