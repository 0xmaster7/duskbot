// The gallery runs' one DevTools connection: requests by id, and every event to the listeners (console errors, crashes).
export async function connect(url: string) {
  const socket = new WebSocket(url);
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const listeners: Array<(method: string, params: any) => void> = [];
  let next = 0;
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data));
    if (value.method) for (const listener of listeners) listener(value.method, value.params);
    const waiting = pending.get(value.id);
    if (!waiting) return;
    pending.delete(value.id);
    if (value.error) waiting.reject(new Error(value.error.message)); else waiting.resolve(value.result);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("gallery Chrome connection failed")), { once: true });
  });
  return {
    on(listener: (method: string, params: any) => void) { listeners.push(listener); },
    close() { socket.close(); },
    request(method: string, params: unknown = {}, sessionId?: string): Promise<any> {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`gallery Chrome ${method} timed out`)); }, 60_000);
        pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}
