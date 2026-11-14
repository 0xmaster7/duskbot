// ⌘⇧D on a Mac, Ctrl+Shift+D elsewhere: starts voice input in the open chat, and lands the words when pressed again.
import { isMacPlatform } from "../keyboard-shortcuts";

export function voiceShortcut(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "key" | "code" | "repeat">, mac = isMacPlatform()): boolean {
  if (event.repeat || event.altKey || !event.shiftKey) return false;
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
  return event.code === "KeyD" || event.key.toLowerCase() === "d";
}

export function voiceShortcutLabel(mac = isMacPlatform()): string {
  return mac ? "⌘⇧D" : "Ctrl+Shift+D";
}
