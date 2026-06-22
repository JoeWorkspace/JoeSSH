type KeyboardShortcutEvent = {
  code?: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
};

export function isKeyboardShortcutsToggle(event: KeyboardShortcutEvent): boolean {
  const isShortcutKey = event.key === "?" || event.key === "/" || event.code === "Slash";
  return (event.ctrlKey || event.metaKey) && event.shiftKey && isShortcutKey;
}
