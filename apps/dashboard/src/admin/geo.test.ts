import { describe, expect, it } from "vitest";
import { COUNTRIES, centroid, countryName } from "./geo.ts";

describe("country geography", () => {
  it.each([
    ["US", "united states", 30, 50, -110, -85],
    ["IN", "india", 15, 30, 70, 90],
    ["DE", "germany", 47, 55, 5, 16],
    ["BR", "brazil", -25, 0, -65, -40],
    ["JP", "japan", 30, 45, 130, 145],
    ["AU", "australia", -35, -15, 120, 145],
  ] as const)("locates %s with its English name", (code, name, minLat, maxLat, minLon, maxLon) => {
    expect(countryName(code)).toBe(name);
    const [lon, lat] = centroid(code)!;
    expect(lat).toBeGreaterThan(minLat);
    expect(lat).toBeLessThan(maxLat);
    expect(lon).toBeGreaterThan(minLon);
    expect(lon).toBeLessThan(maxLon);
    expect(centroid(code.toLowerCase())).toEqual([lon, lat]);
    expect(countryName(code.toLowerCase())).toBe(name);
  });

  it("contains all 249 countries and territories with lowercase names and valid coordinates", () => {
    expect(Object.keys(COUNTRIES)).toHaveLength(249);
    for (const [code, country] of Object.entries(COUNTRIES)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(country.name).toBe(country.name.toLowerCase());
      expect(country.lat).toBeGreaterThanOrEqual(-90);
      expect(country.lat).toBeLessThanOrEqual(90);
      expect(country.lon).toBeGreaterThanOrEqual(-180);
      expect(country.lon).toBeLessThanOrEqual(180);
      expect(Number(country.lat.toFixed(1))).toBe(country.lat);
      expect(Number(country.lon.toFixed(1))).toBe(country.lon);
    }
  });

  it("uses short names and includes small and remote territories", () => {
    expect(countryName("GB")).toBe("united kingdom");
    expect(countryName("KR")).toBe("south korea");
    expect(countryName("CZ")).toBe("czechia");
    for (const code of ["AQ", "AX", "BQ", "BV", "HM", "PN", "SJ", "UM", "VA"]) expect(centroid(code)).not.toBeNull();
  });

  it.each([null, undefined, ""])("handles missing country %s", code => {
    expect(countryName(code)).toBe("unknown");
    expect(centroid(code)).toBeNull();
  });

  it.each(["XX", "zz", "T1", "Unknown", "constructor", "__proto__"])("handles unknown country %s", code => {
    expect(countryName(code)).toBe(code.toLowerCase());
    expect(centroid(code)).toBeNull();
  });
});
