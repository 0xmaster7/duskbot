import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addressClass } from "./browser/egress/policy.ts";
import { readableText, readPage } from "./page-reader.ts";

const base = new URL("https://example.org/docs/");

describe("readableText", () => {
  it("keeps headings, lists, links and paragraphs, and drops scripts, styles and page chrome", () => {
    const html = `<html><head><title>Guide &amp; notes</title><style>p{color:red}</style></head><body>
      <nav><a href="/">Home</a> <a href="/about">About</a></nav>
      <h1>Getting started</h1><p>Install it with <a href="install">the installer</a>.</p>
      <script>alert("<p>no</p>")</script>
      <ul><li>One</li><li>Two &lt;three&gt;</li></ul>
      <h2>More</h2><p>See <a href="https://other.example/x">other</a> and <a href="javascript:void(0)">nothing</a>.</p>
      <footer>Copyright</footer></body></html>`;
    const { title, text } = readableText(html, base);
    expect(title).toBe("Guide & notes");
    expect(text).toContain("# Getting started");
    expect(text).toContain("Install it with [the installer](https://example.org/docs/install).");
    expect(text).toContain("- One\n- Two <three>");
    expect(text).toContain("## More");
    expect(text).toContain("[other](https://other.example/x)");
    expect(text).toContain("nothing");
    expect(text).not.toContain("javascript");
    expect(text).not.toMatch(/alert|color:red|Copyright|About/);
  });

  it("reads only <main> when it holds the article", () => {
    const article = "Real article text. ".repeat(20);
    const { text } = readableText(`<div>Sidebar junk</div><main><p>${article}</p></main><div>More junk</div>`, base);
    expect(text).toContain("Real article text.");
    expect(text).not.toContain("junk");
  });

  it("stays fast on hostile markup", () => {
    const started = performance.now();
    readableText("<".repeat(200_000) + "<a href='".repeat(50_000) + "<div".repeat(50_000), base);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("readPage refuses anything but the public web", () => {
  const neverAsked = async () => { throw new Error("resolver must not run"); };

  it.each([
    "http://127.0.0.1/", "http://127.1.2.3:8080/", "http://10.0.0.5/", "http://192.168.1.1/admin", "http://172.16.0.1/",
    "http://100.64.0.1/", "http://169.254.169.254/latest/meta-data/", "http://100.100.100.200/", "http://[::1]/",
    "http://[::ffff:127.0.0.1]/", "http://[fd00:ec2::254]/", "http://[fe80::1]/", "http://0.0.0.0/", "http://localhost:8799/",
  ])("refuses %s", async (url) => {
    const page = await readPage(url, { lookup: url.includes("localhost") ? undefined : neverAsked });
    expect(page).toMatchObject({ ok: false });
    if (!page.ok) expect(page.error).toMatch(/private network|this computer/);
  });

  it("refuses a name that resolves to a private address, or to any private address among public ones", async () => {
    expect(await readPage("https://intranet.example/", { lookup: async () => [{ address: "10.1.2.3", family: 4 }] })).toMatchObject({ ok: false });
    expect(await readPage("https://mixed.example/", { lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }] })).toMatchObject({ ok: false });
  });

  it("refuses other schemes and addresses carrying credentials", async () => {
    for (const url of ["file:///etc/passwd", "ftp://example.org/", "https://user:pass@example.org/", "not a url"]) {
      expect(await readPage(url, { lookup: neverAsked })).toMatchObject({ ok: false });
    }
  });
});

describe("readPage against a test server", () => {
  let server: Server;
  let port = 0;
  const hits: string[] = [];
  // the test server stands in for a public site: only its own address passes besides real public ones
  const allow = ({ address }: { address: string }) => address === "127.0.0.1" || addressClass(address) === "public";

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(`${req.headers.host} ${req.url}`);
      if (req.url === "/page") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<title>Hi</title><h1>Hello</h1><p>World</p>"); return; }
      if (req.url === "/to-metadata") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); res.end(); return; }
      if (req.url === "/to-loopback") { res.writeHead(301, { location: "http://127.0.0.1:1/" }); res.end(); return; }
      if (req.url === "/to-intranet") { res.writeHead(302, { location: `http://intranet.test:${port}/page` }); res.end(); return; }
      if (req.url === "/to-self") { res.writeHead(302, { location: "/page" }); res.end(); return; }
      if (req.url === "/big") { res.writeHead(200, { "content-type": "text/plain" }); res.end("x".repeat(50_000)); return; }
      if (req.url === "/slow") { setTimeout(() => res.end("late"), 3_000).unref(); return; }
      if (req.url === "/pdf") { res.writeHead(200, { "content-type": "application/pdf" }); res.end("%PDF"); return; }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("reads a page as text", async () => {
    expect(await readPage(`http://127.0.0.1:${port}/page`, { allow })).toMatchObject({ ok: true, title: "Hi", text: "# Hello\n\nWorld" });
  });

  it("refuses a redirect to the metadata service, to loopback, or to a name that resolves privately", async () => {
    const lookup = async (host: string) => host === "intranet.test" ? [{ address: "10.0.0.9", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
    const strict = ({ address }: { address: string }) => addressClass(address) === "public";
    expect(await readPage(`http://127.0.0.1:${port}/to-metadata`, { allow })).toMatchObject({ ok: false });
    expect(await readPage(`http://127.0.0.1:${port}/to-intranet`, { allow, lookup })).toMatchObject({ ok: false });
    // loopback passes only as the test server's first hop; a strict check refuses even that
    expect(await readPage(`http://127.0.0.1:${port}/to-loopback`, { allow: strict })).toMatchObject({ ok: false });
    expect(hits.some((hit) => hit.includes("intranet.test"))).toBe(false);
  });

  it("pins each request to the address it checked, and checks again on every redirect (DNS rebinding)", async () => {
    // rebind.test resolves nowhere for real, so reaching the server proves the socket used the checked address
    const answers = [[{ address: "127.0.0.1", family: 4 }], [{ address: "10.0.0.7", family: 4 }]];
    const asked: string[] = [];
    const rebinding = async (host: string) => { asked.push(host); return answers.shift() ?? []; };
    const page = await readPage(`http://rebind.test:${port}/to-self`, { allow, lookup: rebinding });
    expect(page).toMatchObject({ ok: false });
    if (!page.ok) expect(page.error).toMatch(/private network/);
    expect(asked).toEqual(["rebind.test", "rebind.test"]);
    expect(hits).toContain(`rebind.test:${port} /to-self`);
    expect(hits).not.toContain(`rebind.test:${port} /page`);
  });

  it("caps size and time, and refuses files that are not text", async () => {
    const big = await readPage(`http://127.0.0.1:${port}/big`, { allow, maxBytes: 1_000 });
    expect(big).toMatchObject({ ok: true, cut: true });
    if (big.ok) expect(big.text.length).toBe(1_000);
    expect(await readPage(`http://127.0.0.1:${port}/slow`, { allow, timeoutMs: 200 })).toMatchObject({ ok: false, error: "The page took too long to answer." });
    expect(await readPage(`http://127.0.0.1:${port}/pdf`, { allow })).toMatchObject({ ok: false, error: expect.stringContaining("application/pdf") });
  });
});
