export type Rotation = { lambda: number; phi: number };

const radians = Math.PI / 180;

export function orthographic(lon: number, lat: number, rot: Rotation, radius: number, cx: number, cy: number): { x: number; y: number; z: number } {
  const lambda = (lon + rot.lambda) * radians;
  const latitude = lat * radians;
  const phi = rot.phi * radians;
  const x = Math.cos(latitude) * Math.cos(lambda);
  const y = Math.cos(latitude) * Math.sin(lambda);
  const z = Math.sin(latitude);
  return {
    x: cx + radius * y,
    y: cy - radius * (z * Math.cos(phi) + x * Math.sin(phi)),
    z: x * Math.cos(phi) - z * Math.sin(phi),
  };
}

export function equirect(lon: number, lat: number, width: number, height: number): { x: number; y: number } {
  return { x: (lon + 180) / 360 * width, y: (90 - lat) / 180 * height };
}

export function clampPhi(phi: number): number {
  return Math.max(-80, Math.min(80, phi));
}

export function wrapLambda(l: number): number {
  const wrapped = ((l % 360 + 540) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export function decodeDots(flat: number[]): Float32Array {
  return Float32Array.from(flat, value => value / 10);
}
