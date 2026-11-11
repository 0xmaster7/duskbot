import { describe, expect, it } from "vitest";
import { clampPhi, decodeDots, equirect, orthographic, wrapLambda } from "./project";

describe("orthographic", () => {
  it.each([{ lambda: 0, phi: 0 }, { lambda: 30, phi: 25 }])("projects the view centre for %o", rot => {
    const point = orthographic(-rot.lambda, -rot.phi, rot, 100, 120, 140);
    expect(point.x).toBeCloseTo(120);
    expect(point.y).toBeCloseTo(140);
    expect(point.z).toBeCloseTo(1);
  });

  it("places the horizon and antipode at their expected depths", () => {
    expect(orthographic(90, 0, { lambda: 0, phi: 0 }, 100, 0, 0).z).toBeCloseTo(0);
    expect(orthographic(180, 0, { lambda: 0, phi: 0 }, 100, 0, 0).z).toBeCloseTo(-1);
  });

  it("rotates longitude -30 to the centre with lambda 30", () => {
    expect(orthographic(-30, 0, { lambda: 30, phi: 0 }, 100, 50, 60)).toEqual({ x: 50, y: 60, z: 1 });
  });

  it("projects east rightward and north upward", () => {
    expect(orthographic(30, 0, { lambda: 0, phi: 0 }, 100, 0, 0).x).toBeCloseTo(50);
    expect(orthographic(0, 30, { lambda: 0, phi: 0 }, 100, 0, 0).y).toBeCloseTo(-50);
  });
});

describe("equirect", () => {
  it.each([
    [-180, 90, 0, 0], [180, 90, 400, 0],
    [-180, -90, 0, 200], [180, -90, 400, 200], [0, 0, 200, 100],
  ])("projects %s, %s", (lon, lat, x, y) => {
    expect(equirect(lon, lat, 400, 200)).toEqual({ x, y });
  });
});

describe("rotation bounds", () => {
  it.each([[-100, -80], [-80, -80], [0, 0], [35, 35], [80, 80], [100, 80]])("clamps tilt %s", (phi, expected) => {
    expect(clampPhi(phi)).toBe(expected);
  });

  it.each([[-540, 180], [-360, 0], [-180, 180], [-181, 179], [0, 0], [180, 180], [181, -179], [540, 180], [750, 30]])("wraps longitude %s", (lambda, expected) => {
    expect(wrapLambda(lambda)).toBe(expected);
  });
});

describe("decodeDots", () => {
  it("decodes tenths of degrees without changing the source", () => {
    const flat = [-1234, 456, 0, -900, 1800, 125];
    const dots = decodeDots(flat);
    expect(dots).toBeInstanceOf(Float32Array);
    expect(dots).toHaveLength(flat.length);
    flat.forEach((value, index) => expect(dots[index]).toBeCloseTo(value / 10, 4));
    expect(flat).toEqual([-1234, 456, 0, -900, 1800, 125]);
    expect(decodeDots([])).toHaveLength(0);
  });
});
