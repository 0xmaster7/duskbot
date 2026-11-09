// Also compiled for the server, which has no DOM types: XMLHttpRequest is described structurally.
export type UploadProgress = (loaded: number, total: number) => void;

export type UploadInit = {
  method: string;
  headers: Record<string, string>;
  body: Blob | Uint8Array;
  signal?: AbortSignal;
};

/** A transport that carries the page's API calls elsewhere; null leaves the url to the default path. */
export type UploadRoute = (url: string, init: UploadInit, onProgress: UploadProgress) => Promise<Response> | null;

type XhrProgress = { loaded: number; total: number; lengthComputable: boolean };
type Xhr = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  getAllResponseHeaders(): string;
  send(body: Blob | Uint8Array): void;
  abort(): void;
  responseType: string;
  response: unknown;
  status: number;
  statusText: string;
  upload: { onprogress: ((event: XhrProgress) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
};
type XhrConstructor = new () => Xhr;

let route: UploadRoute | null = null;

export function setUploadRoute(next: UploadRoute | null): () => void {
  const previous = route;
  route = next;
  return () => {
    if (route === next) route = previous;
  };
}

function bodySize(body: Blob | Uint8Array): number {
  return body instanceof Uint8Array ? body.byteLength : body.size;
}

function nativeFunction(value: unknown): boolean {
  return typeof value === "function" && /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(value));
}

/** XHR only where fetch is the platform's own: a patched fetch (a phone transport, a preview, a test) carries the request elsewhere. */
function pageXhr(): XhrConstructor | null {
  const scope = globalThis as { XMLHttpRequest?: unknown; fetch?: unknown };
  return nativeFunction(scope.XMLHttpRequest) && nativeFunction(scope.fetch) ? scope.XMLHttpRequest as XhrConstructor : null;
}

/** fetch for an upload body, reporting bytes sent where the path can see them; one that cannot never calls onProgress. */
export function sendUpload(url: string, init: UploadInit, onProgress: UploadProgress = () => {}): Promise<Response> {
  const routed = route?.(url, init, onProgress);
  if (routed) return routed;
  const Request = pageXhr();
  if (!Request) return fetch(url, { method: init.method, headers: init.headers, body: init.body as NonNullable<RequestInit["body"]>, signal: init.signal });
  return xhrUpload(Request, url, init, onProgress);
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

export function xhrUpload(Request: XhrConstructor, url: string, init: UploadInit, onProgress: UploadProgress): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const { signal } = init;
    const aborted = () => signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const xhr = new Request();
    const onAbort = () => xhr.abort();
    const settle = () => signal?.removeEventListener("abort", onAbort);
    xhr.open(init.method, url);
    for (const [name, value] of Object.entries(init.headers)) xhr.setRequestHeader(name, value);
    xhr.responseType = "arraybuffer";
    const total = bodySize(init.body);
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.lengthComputable && event.total > 0 ? event.total : total);
    xhr.onload = () => {
      settle();
      try {
        resolve(new Response(NULL_BODY.has(xhr.status) ? null : xhr.response as ArrayBuffer, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: responseHeaders(xhr.getAllResponseHeaders()),
        }));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => { settle(); reject(new TypeError("Failed to fetch")); };
    xhr.ontimeout = () => { settle(); reject(new TypeError("Failed to fetch")); };
    xhr.onabort = () => { settle(); reject(aborted()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    onProgress(0, total);
    xhr.send(init.body);
  });
}

function responseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    try {
      headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
    } catch {
    }
  }
  return headers;
}
