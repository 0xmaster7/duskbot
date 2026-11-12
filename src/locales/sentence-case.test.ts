import { expect, it } from "vitest";

import en from "./en.json";

const copy = en as Record<string, string>;
// a sentence may open with the product's own lowercase name, an abbreviation or code
const NAME_OR_CODE = /^(?:dusk\b|e\.g\.|i\.e\.|i(?:OS|Pad|Phone|Cloud)\b|macOS\b|npm\b|native:|mcp:)/;

it("every sentence inside a string starts with a capital letter", () => {
  const offending = Object.entries(copy)
    .filter(([, value]) => [...value.matchAll(/(?<!\be\.g|\bi\.e|\bvs)[.!?] ([a-z]\S*)/g)].some((match) => !NAME_OR_CODE.test(value.slice(match.index + 2))))
    .map(([key, value]) => `${key}: "${value}"`);
  expect(offending, "write English copy in sentence case").toEqual([]);
});

it("settings and phone headings, hints and labels start with a capital letter", () => {
  const offending = Object.entries(copy)
    .filter(([key]) => /^(?:settings\.docs|mobile)\./.test(key))
    .filter(([key, value]) => /^[a-z]/.test(value) && !NAME_OR_CODE.test(value) && !/(?:Placeholder|legalAnd)$/.test(key))
    .map(([key, value]) => `${key}: "${value}"`);
  expect(offending, "write English copy in sentence case").toEqual([]);
});

it("the product's name stays lowercase", () => {
  const offending = Object.entries(copy).filter(([, value]) => /\bDusk (?:bot|cloud|Cloud)\b/.test(value)).map(([key, value]) => `${key}: "${value}"`);
  expect(offending).toEqual([]);
});
