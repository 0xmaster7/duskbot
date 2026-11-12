import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WelcomeBring } from "./WelcomeBring";

const bring = (team: boolean) => renderToStaticMarkup(createElement(WelcomeBring, { name: "Acme", desktop: true, cloudHasWork: false, team,
  headingRef: { current: null }, onFinish: () => {} }));

describe("the first setup step's promise", () => {
  it("on a Team Cloud, never says the bots on this computer move here", () => {
    const html = bring(true);
    expect(html).toContain("Your own bots stay on your computer. Acme starts with bots of its own that everyone in the team can use.");
    expect(html).not.toContain("move here when you say yes");
  });

  it("on My Cloud, says it as before", () => {
    expect(bring(false)).toContain("Bots on your computer move here when you say yes in the Dusk app.");
  });
});
