// app/mascot-clock.ts imports react for a hook the site never calls; this stands in so the bundle has no react
export const useSyncExternalStore = (_subscribe, read) => read();
