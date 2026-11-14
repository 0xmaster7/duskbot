import { describe, expect, it } from "vitest";
import { readSkillFrontmatter } from "./skill-md";

const md = (front: string) => `---\n${front}\n---\nbody`;

describe("readSkillFrontmatter", () => {
  it("reads a folded description (>-) as one line", () => {
    const parsed = readSkillFrontmatter(md("name: canvas\ndescription: >-\n  Draw a diagram\n  on the canvas.\nlicense: MIT"));
    expect(parsed?.fields.description).toBe("Draw a diagram on the canvas.");
    expect(parsed?.fields.license).toBe("MIT");
  });

  it("keeps a paragraph break in a folded description (>)", () => {
    expect(readSkillFrontmatter(md("description: >\n  One\n  line.\n\n  Second.\nname: x"))?.fields.description).toBe("One line.\nSecond.");
  });

  it("keeps the lines of a literal description (| and |-)", () => {
    expect(readSkillFrontmatter(md("description: |\n  First\n    indented\n  last\nname: x"))?.fields.description).toBe("First\n  indented\nlast");
    expect(readSkillFrontmatter(md("description: |-\n  Only line"))?.fields.description).toBe("Only line");
  });

  it("still reads plain and quoted one-line values", () => {
    const parsed = readSkillFrontmatter(md("name: plain\ndescription: \"Quoted: yes\""));
    expect(parsed?.fields).toEqual({ name: "plain", description: "Quoted: yes" });
  });
});
