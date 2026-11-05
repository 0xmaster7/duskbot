/** One layout for everyone: the Simple one. The Advanced switch is gone from the app; what only Advanced showed opens from
 * Settings instead. The old choice stays in storage untouched, so nothing is lost if a page of an older release reads it. */
export const ADVANCED_MODE_KEY = "omb-advanced-mode";

export function readAdvancedMode(): boolean {
  return false;
}

export function settleAdvancedModeDefault(): void {}

export function setAdvancedMode(_enabled: boolean): void {}

export function useAdvancedMode(): boolean {
  return false;
}
