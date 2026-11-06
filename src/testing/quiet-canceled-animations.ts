// happy-dom 21 rejects an Animation's `finished` when it is cancelled and nothing awaits it; a browser reports nothing.
// motion cancels its animations whenever a value is retargeted, so a test of a crossfade would fail on that noise.
const proto = (globalThis as { Animation?: { prototype: { cancel(): void; finished?: Promise<unknown> } } }).Animation?.prototype;
if (proto) {
  const cancel = proto.cancel;
  proto.cancel = function (this: { finished?: Promise<unknown> }) {
    this.finished?.catch(() => {});
    return cancel.call(this);
  };
}
