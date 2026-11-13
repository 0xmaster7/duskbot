import { createBucket } from "./fair-use.js";
import { QUEUE_BYTES } from "./protocol.js";

/**
 * moves messages to their peer within the tunnel's rate, in arrival order. a message that has to wait queues behind
 * the ones before it; the end-to-end ack window of the direct protocol then slows the sender. a sender that still
 * outruns the queue limit is refused (`refuse` closes its socket).
 * @param {{ bucket?: ReturnType<typeof createBucket>, maxQueue?: number, charge?: (size: number) => void,
 *   setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (timer: any) => void }} [options]
 */
export function createForwarder({ bucket = createBucket(), maxQueue = QUEUE_BYTES, charge = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const queue = [];
  let queued = 0, timer = null, sent = 0, delayed = 0;
  function deliver(item) {
    try { item.send(item.data); } catch { /* the peer closed meanwhile */ }
    sent += item.size;
    charge(item.size);
  }
  function drain() {
    timer = null;
    while (queue.length) {
      const wait = bucket.take(queue[0].size);
      if (wait > 0) { timer = setTimer(drain, wait); return; }
      const item = queue.shift();
      queued -= item.size;
      deliver(item);
    }
  }
  return {
    /** @returns {boolean} false: refused, the sender should be closed */
    forward(send, data, size) {
      if (!queue.length && bucket.take(size) === 0) { deliver({ send, data, size }); return true; }
      if (queued + size > maxQueue) return false;
      queue.push({ send, data, size });
      queued += size;
      delayed += 1;
      if (!timer) drain();
      return true;
    },
    close() { if (timer) clearTimer(timer); timer = null; queue.length = 0; queued = 0; },
    bucket,
    stats: () => ({ queued, sent, delayed, rate: bucket.rate }),
  };
}
