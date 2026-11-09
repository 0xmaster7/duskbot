import { afterEach, describe, expect, it, vi } from "vitest";
import { sendUpload, setUploadRoute, xhrUpload } from "./upload-request";

type Listener = (() => void) | null;

class FakeXhr {
  static last: FakeXhr | null = null;
  opened: [string, string] | null = null;
  headers: Record<string, string> = {};
  sent: unknown = null;
  responseType = "";
  response: unknown = null;
  status = 0;
  statusText = "";
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: Listener = null;
  onerror: Listener = null;
  onabort: Listener = null;
  ontimeout: Listener = null;
  constructor() { FakeXhr.last = this; }
  open(method: string, url: string) { this.opened = [method, url]; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  getAllResponseHeaders() { return "content-type: application/json\r\nx-upload: yes\r\n"; }
  send(body: unknown) { this.sent = body; }
  abort() { this.onabort?.(); }
  progress(loaded: number, total: number) { this.upload.onprogress?.({ loaded, total, lengthComputable: true }); }
  answer(status: number, body: string) {
    this.status = status;
    this.response = new TextEncoder().encode(body).buffer;
    this.onload?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.last = null;
});

describe("xhrUpload", () => {
  it("reports bytes sent from zero and answers with the server's response", async () => {
    const reports: Array<[number, number]> = [];
    const body = new Uint8Array(1000);
    const response = xhrUpload(FakeXhr, "/api/files?name=a.pdf", { method: "POST", headers: { "content-type": "application/pdf" }, body }, (loaded, total) => reports.push([loaded, total]));
    const xhr = FakeXhr.last!;
    expect(xhr.opened).toEqual(["POST", "/api/files?name=a.pdf"]);
    expect(xhr.headers).toEqual({ "content-type": "application/pdf" });
    expect(xhr.sent).toBe(body);
    xhr.progress(400, 1000);
    xhr.progress(1000, 1000);
    xhr.answer(201, '{"path":"a.pdf"}');
    const settled = await response;
    expect(reports).toEqual([[0, 1000], [400, 1000], [1000, 1000]]);
    expect(settled.status).toBe(201);
    expect(settled.headers.get("x-upload")).toBe("yes");
    expect(await settled.json()).toEqual({ path: "a.pdf" });
  });

  it("rejects like fetch on a network error and on abort", async () => {
    const failed = xhrUpload(FakeXhr, "/api/files", { method: "POST", headers: {}, body: new Uint8Array(1) }, () => {});
    FakeXhr.last!.onerror?.();
    await expect(failed).rejects.toBeInstanceOf(TypeError);

    const controller = new AbortController();
    const aborted = xhrUpload(FakeXhr, "/api/files", { method: "POST", headers: {}, body: new Uint8Array(1), signal: controller.signal }, () => {});
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("sendUpload", () => {
  it("leaves a patched fetch to carry the upload, with no progress to report", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const onProgress = vi.fn();
    await sendUpload("/api/attachments", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(3) }, onProgress);
    expect(fetcher).toHaveBeenCalledWith("/api/attachments", expect.objectContaining({ method: "POST" }));
    expect(FakeXhr.last).toBeNull();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("goes through a registered route, and back to the default once it is removed", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    const routed = vi.fn((_url: string, _init: unknown, onProgress: (loaded: number, total: number) => void) => {
      onProgress(5, 10);
      return Promise.resolve(new Response("{}", { status: 201 }));
    });
    const stop = setUploadRoute(routed);
    const onProgress = vi.fn();
    await sendUpload("/api/files", { method: "POST", headers: {}, body: new Uint8Array(10) }, onProgress);
    expect(routed).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(5, 10);
    expect(fetcher).not.toHaveBeenCalled();
    stop();
    await sendUpload("/api/files", { method: "POST", headers: {}, body: new Uint8Array(10) });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
